"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle } from "@/components/Card";
import { SelectField, TextField } from "@/components/Field";
import type { AccountProfile, AccountProfileOptions } from "@/lib/types";
import styles from "./profile.module.css";

/* 한 사람의 자격 · 사원증 · 얼굴등록 · 작업배정 편집기.
 *
 * 얼굴은 젯슨이 만든 **특징 벡터 파일**을 올려 등록합니다 (2026-10-06 부터).
 * 사진은 올리지 않습니다. 올린 벡터는 서버가 암호화해 보관하고 게이트 기기만
 * 내려받습니다 — 이 화면도 올린 뒤에는 "몇 차원 · 몇 개 · 언제"만 볼 수 있고,
 * 벡터를 다시 내려받지 못합니다. */

interface Props {
  empNo: string;
  headers: () => Promise<HeadersInit>;
  onSaved: (message: string) => void;
  onClose: () => void;
  /** 얼굴 등록 상태가 이 창 안에서 바뀌었을 때 (젯슨이 알렸거나, 파일을 올렸거나).
   *  목록의 배지를 다시 불러오지 않고 맞추는 데 씁니다. */
  onFaceChanged?: (empNo: string, enrolled: boolean) => void;
}

/** 젯슨에서 등록이 끝났는지 묻는 간격과, 묻기를 그만두는 시간.
 *  창을 열어둔 채 잊어도 읽기 한도를 쓰지 않게 끝을 둡니다. */
const FACE_POLL_MS = 4_000;
const FACE_POLL_LIMIT_MS = 10 * 60_000;

/** `gate:gate-a1` → "젯슨(gate-a1)". 그 밖은 관리자의 사번입니다. */
function enrolledByLabel(by: string | null): string {
  if (!by) return "";
  return by.startsWith("gate:") ? `젯슨(${by.slice(5)})에서 등록` : "관리자가 등록";
}

export function AccountProfilePanel({
  empNo,
  headers,
  onSaved,
  onClose,
  onFaceChanged,
}: Props) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [options, setOptions] = useState<AccountProfileOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 편집 중인 값들
  const [quals, setQuals] = useState<{ code: string; expiresOn: string }[]>([]);
  const [cardUid, setCardUid] = useState("");
  const [faceEnrolled, setFaceEnrolled] = useState(false);
  const [restrict, setRestrict] = useState(false);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [newQual, setNewQual] = useState("");
  const [template, setTemplate] = useState<AccountProfile["faceTemplate"]>(null);
  const [faceBusy, setFaceBusy] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** 서버가 알고 있는 등록 상태. 화면에서 손으로 바꾼 값(faceEnrolled)과 따로 둡니다. */
  const [faceServer, setFaceServer] = useState<{
    enrolled: boolean;
    at: string | null;
    by: string | null;
  } | null>(null);
  /** 관리자가 「파일 없이 등록됨으로 표시」를 직접 눌렀는가. 누른 적이 없으면
   *  저장할 때 얼굴 값을 보내지 않습니다 — 창을 열어둔 사이 젯슨이 등록했는데
   *  옛 값("미등록")을 같이 보내 도로 지우는 일을 막습니다. */
  const [faceTouched, setFaceTouched] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [pollRound, setPollRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/admin/accounts/${empNo}/profile`, {
        headers: await headers(),
      });
      if (!res.ok || !alive) return;
      const data = (await res.json()) as {
        profile: AccountProfile;
        options: AccountProfileOptions;
      };
      if (!alive) return;
      setProfile(data.profile);
      setOptions(data.options);
      setQuals(
        data.profile.qualifications.map((q) => ({
          code: q.code,
          expiresOn: q.expiresOn,
        })),
      );
      setCardUid(data.profile.card?.cardUid ?? "");
      setFaceEnrolled(data.profile.faceEnrolled);
      setFaceServer({
        enrolled: data.profile.faceEnrolled,
        at: data.profile.faceEnrolledAt,
        by: data.profile.faceEnrolledBy,
      });
      setTemplate(data.profile.faceTemplate);
      setRestrict(data.profile.allowedWorkCodes !== null);
      setAllowed(data.profile.allowedWorkCodes ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [empNo, headers]);

  /* 젯슨의 얼굴 등록 프로그램에서 등록이 끝나기를 기다립니다. 끝나면 서버의
     등록 여부가 바뀌므로, 미등록인 동안만 몇 초마다 그 값 하나를 묻습니다.
     탭이 가려져 있으면 쉬고, 10분이 지나면 멈춥니다 (다시 확인 버튼). */
  const waiting = faceServer !== null && !faceServer.enrolled && !pollStopped;
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (document.hidden) return;
      if (Date.now() - startedAt > FACE_POLL_LIMIT_MS) {
        setPollStopped(true);
        return;
      }
      const { authorization } = (await headers()) as Record<string, string>;
      const res = await fetch(`/api/admin/accounts/${empNo}/face-template`, {
        headers: authorization ? { authorization } : undefined,
      }).catch(() => null);
      if (!alive || !res?.ok) return;
      const st = (await res.json()) as {
        faceEnrolled: boolean;
        faceEnrolledAt: string | null;
        faceEnrolledBy: string | null;
        faceTemplate: AccountProfile["faceTemplate"];
      };
      if (!alive || !st.faceEnrolled) return;
      setFaceServer({ enrolled: true, at: st.faceEnrolledAt, by: st.faceEnrolledBy });
      setFaceEnrolled(true);
      setFaceTouched(false);
      setTemplate(st.faceTemplate);
      onFaceChanged?.(empNo, true);
    }, FACE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [waiting, pollRound, empNo, headers, onFaceChanged]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/accounts/${empNo}/profile`, {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify({
        qualifications: quals,
        cardUid: cardUid.trim() || null,
        // 손으로 바꿨을 때만 보냅니다 (위 faceTouched 설명).
        faceEnrolled: faceTouched ? faceEnrolled : undefined,
        allowedWorkCodes: restrict ? allowed : null,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    setBusy(false);
    if (!res.ok) {
      setError(body?.error ?? "저장하지 못했어요.");
      return;
    }
    onSaved(`${profile?.name ?? ""} 님 정보를 저장했어요.`);
  }

  /* 벡터 파일 올리기 · 지우기. 아래 「저장」과 **따로** 바로 반영됩니다 —
     파일을 고른 뒤 저장을 안 누르고 닫으면 등록이 안 된 줄 모르기 쉽습니다. */
  async function uploadTemplate(file: File) {
    setFaceBusy(true);
    setFaceError(null);
    const form = new FormData();
    form.append("file", file);
    // 파일을 보낼 때는 content-type 을 직접 정하지 않습니다 (브라우저가 경계값을 붙입니다).
    const { authorization } = (await headers()) as Record<string, string>;
    const res = await fetch(`/api/admin/accounts/${empNo}/face-template`, {
      method: "PUT",
      headers: authorization ? { authorization } : undefined,
      body: form,
    });
    const body = (await res.json().catch(() => null)) as
      | (NonNullable<AccountProfile["faceTemplate"]> & { error?: string })
      | null;
    setFaceBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!res.ok || !body) {
      setFaceError(body?.error ?? "올리지 못했어요.");
      return;
    }
    setTemplate({
      dim: body.dim,
      count: body.count,
      model: body.model,
      fileName: body.fileName,
      uploadedAt: body.uploadedAt,
    });
    setFaceEnrolled(true);
    setFaceTouched(false);
    setFaceServer({ enrolled: true, at: body.uploadedAt, by: "admin" });
    onFaceChanged?.(empNo, true);
  }

  async function removeTemplate() {
    setFaceBusy(true);
    setFaceError(null);
    const { authorization } = (await headers()) as Record<string, string>;
    const res = await fetch(`/api/admin/accounts/${empNo}/face-template`, {
      method: "DELETE",
      headers: authorization ? { authorization } : undefined,
    });
    setFaceBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setFaceError(body?.error ?? "지우지 못했어요.");
      return;
    }
    setTemplate(null);
    setFaceEnrolled(false);
    setFaceTouched(false);
    setFaceServer({ enrolled: false, at: null, by: null });
    setPollStopped(false);
    onFaceChanged?.(empNo, false);
  }

  if (!profile || !options) {
    return (
      <Card padding={24} gap={16}>
        <p className={styles.lead}>불러오는 중이에요.</p>
      </Card>
    );
  }

  const qualName = (code: string) =>
    options.qualifications.find((q) => q.code === code)?.name ?? code;

  const unusedQuals = options.qualifications.filter(
    (q) => !quals.some((x) => x.code === q.code),
  );

  return (
    <Card padding={24} gap={24}>
      <CardHeader>
        <CardTitle>
          {profile.name} · {profile.empNo}
        </CardTitle>
        <Button size="small" variant="outlined" color="assistive" onClick={onClose}>
          닫기
        </Button>
      </CardHeader>

      {error ? <p className={styles.error}>{error}</p> : null}

      {/* ── 자격증 ───────────────────────────────────────────── */}
      <section className={styles.section}>
        <span className={styles.sectionTitle}>자격증</span>
        <p className={styles.lead}>
          만료되면 게이트가 검증 단계 전에 막아요. 유효·임박은 만료일에서
          자동으로 계산돼요.
        </p>

        {quals.length === 0 ? (
          <p className={styles.none}>등록된 자격이 없어요.</p>
        ) : (
          <div className={styles.qualList}>
            {quals.map((q, i) => (
              <div key={q.code} className={styles.qualRow}>
                <span className={styles.qualName}>{qualName(q.code)}</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={q.expiresOn}
                  aria-label={`${qualName(q.code)} 만료일`}
                  onChange={(e) => {
                    const next = [...quals];
                    next[i] = { ...q, expiresOn: e.target.value };
                    setQuals(next);
                  }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  color="assistive"
                  onClick={() => setQuals(quals.filter((_, j) => j !== i))}
                >
                  삭제
                </Button>
              </div>
            ))}
          </div>
        )}

        {unusedQuals.length > 0 ? (
          <div className={styles.addRow}>
            <SelectField
              label="자격 추가"
              value={newQual}
              onChange={(e) => setNewQual(e.target.value)}
              options={[
                { value: "", label: "고르세요" },
                ...unusedQuals.map((q) => ({ value: q.code, label: q.name })),
              ]}
            />
            <Button
              size="medium"
              disabled={!newQual}
              onClick={() => {
                // 기본 만료일은 1년 뒤. 대부분 갱신 주기가 1년입니다.
                const d = new Date();
                d.setFullYear(d.getFullYear() + 1);
                setQuals([
                  ...quals,
                  { code: newQual, expiresOn: d.toISOString().slice(0, 10) },
                ]);
                setNewQual("");
              }}
            >
              추가
            </Button>
          </div>
        ) : null}
      </section>

      {/* ── 사원증 ───────────────────────────────────────────── */}
      <section className={styles.section}>
        <span className={styles.sectionTitle}>사원증</span>
        <p className={styles.lead}>
          게이트가 카드를 읽었을 때 이 UID 로 사람을 찾아요. 바꾸면 옛 카드는
          지워지지 않고 폐기 처리돼요 — 분실 카드로 찍힌 과거 기록을 추적할 수
          있어야 하니까요.
        </p>
        <div className={styles.cardRow}>
          <TextField
            label="카드 UID"
            placeholder="04A2B3C4"
            value={cardUid}
            onChange={(e) => setCardUid(e.target.value)}
          />
          {profile.card?.pending ? (
            <Badge tone="warning">임시 UID</Badge>
          ) : profile.card ? (
            <Badge tone="success">발급됨</Badge>
          ) : (
            <Badge tone="neutral">미발급</Badge>
          )}
        </div>
      </section>

      {/* ── 얼굴 등록 ────────────────────────────────────────── */}
      <section className={styles.section}>
        <span className={styles.sectionTitle}>얼굴 등록</span>
        <p className={styles.lead}>
          젯슨의 <strong>얼굴 등록 프로그램</strong>에서 사번{" "}
          <strong>{profile.empNo}</strong> 으로 등록하면, 여기가 자동으로
          &ldquo;등록됨&rdquo;으로 바뀌어요. 따로 누를 것은 없어요.
        </p>

        <div className={styles.faceRow}>
          <Badge tone={faceEnrolled ? "success" : "neutral"}>
            {faceEnrolled ? "등록됨" : "미등록"}
          </Badge>
          {template ? (
            <span className={styles.faceMeta}>
              파일로 등록 · 벡터 {template.count}개 · {template.dim}차원
              {template.model ? ` · ${template.model}` : ""} ·{" "}
              {new Date(template.uploadedAt).toLocaleDateString("ko-KR")}
              {template.fileName ? ` (${template.fileName})` : ""}
            </span>
          ) : faceEnrolled && faceServer?.enrolled ? (
            <span className={styles.faceMeta}>
              {enrolledByLabel(faceServer.by)}
              {faceServer.at
                ? ` · ${new Date(faceServer.at).toLocaleString("ko-KR", {
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </span>
          ) : faceEnrolled ? (
            <span className={styles.faceMeta}>
              아래 「저장」을 누르면 등록됨으로 표시돼요
            </span>
          ) : waiting ? (
            <span className={styles.faceWaiting} role="status">
              <span className={styles.faceDot} aria-hidden="true" />
              젯슨에서 등록하기를 기다리는 중이에요
            </span>
          ) : pollStopped ? (
            <>
              <span className={styles.faceMeta}>
                한동안 소식이 없어 확인을 멈췄어요
              </span>
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                onClick={() => {
                  setPollStopped(false);
                  setPollRound((n) => n + 1);
                }}
              >
                다시 확인
              </Button>
            </>
          ) : null}
        </div>

        {faceError ? <p className={styles.error}>{faceError}</p> : null}

        {/* 젯슨을 거치지 않는 길. 등록 프로그램이 내보낸 파일이 있을 때나, 등록은
            했는데 알림이 오지 않았을 때 씁니다. */}
        <div className={styles.faceRow}>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.npy,.txt,.csv,application/json,text/plain"
            className={styles.fileInput}
            aria-label="얼굴 등록 파일"
            disabled={faceBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadTemplate(f);
            }}
          />
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            disabled={faceBusy}
            onClick={() => fileInput.current?.click()}
          >
            {faceBusy ? "처리 중" : template ? "파일 바꾸기" : "파일로 등록하기"}
          </Button>
          {template ? (
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={faceBusy}
              onClick={removeTemplate}
            >
              얼굴 등록 삭제
            </Button>
          ) : (
            /* 표시만 맞추는 용도. 아래 「저장」을 눌러야 반영됩니다. */
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={faceBusy}
              onClick={() => {
                setFaceEnrolled(!faceEnrolled);
                setFaceTouched(true);
              }}
            >
              {faceEnrolled ? "등록 해제" : "파일 없이 등록됨으로 표시"}
            </Button>
          )}
          <span className={styles.faceMeta}>
            젯슨을 거치지 않을 때만 써요. 사진은 받지 않아요 (JSON · .npy)
          </span>
        </div>
      </section>

      {/* ── 작업 배정 ────────────────────────────────────────── */}
      <section className={styles.section}>
        <span className={styles.sectionTitle}>작업 배정</span>
        <p className={styles.lead}>
          자격과는 <strong>별개의 조건</strong>이에요. 자격이 있어도 배정되지
          않으면 못 하고, 배정돼 있어도 자격이 만료되면 게이트가 막아요.
        </p>

        <div className={styles.radioRow}>
          <label className={styles.radio}>
            <input
              type="radio"
              name="restrict"
              checked={!restrict}
              onChange={() => setRestrict(false)}
            />
            제한 없음 (자격 요건만 봄)
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="restrict"
              checked={restrict}
              onChange={() => setRestrict(true)}
            />
            고른 작업만
          </label>
        </div>

        {restrict ? (
          <div className={styles.workGrid}>
            {options.workCodes.map((w) => {
              const on = allowed.includes(w.code);
              const needs = w.requiredQualifications
                .map((c) => qualName(c))
                .join(", ");
              return (
                <label
                  key={w.code}
                  className={`${styles.workItem} ${on ? styles.workItemOn : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setAllowed(
                        on
                          ? allowed.filter((c) => c !== w.code)
                          : [...allowed, w.code],
                      )
                    }
                  />
                  <span className={styles.workBody}>
                    <span className={styles.workName}>
                      {w.code} {w.name}
                    </span>
                    {needs ? (
                      <span className={styles.workNeeds}>필요 자격: {needs}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className={styles.actions}>
        <Button variant="outlined" color="assistive" onClick={onClose}>
          취소
        </Button>
        <Button disabled={busy} onClick={save}>
          {busy ? "저장 중" : "저장"}
        </Button>
      </div>
    </Card>
  );
}
