"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle } from "@/components/Card";
import { SelectField, TextField } from "@/components/Field";
import type { AccountProfile, AccountProfileOptions } from "@/lib/types";
import styles from "./profile.module.css";

/* 한 사람의 자격 · 사원증 · 얼굴등록 · 작업배정 편집기.
 *
 * 얼굴은 **등록 여부만** 다룹니다. 사진과 특징값은 젯슨이 갖고 있고 웹에는
 * 오지 않습니다 — 생체정보를 웹 DB 에 두면 보관·파기 책임이 따라오고,
 * "젯슨이 판정하고 웹은 결과만 받는다"는 계약과도 어긋납니다. */

interface Props {
  empNo: string;
  headers: () => Promise<HeadersInit>;
  onSaved: (message: string) => void;
  onClose: () => void;
}

export function AccountProfilePanel({ empNo, headers, onSaved, onClose }: Props) {
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
      setRestrict(data.profile.allowedWorkCodes !== null);
      setAllowed(data.profile.allowedWorkCodes ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [empNo, headers]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/accounts/${empNo}/profile`, {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify({
        qualifications: quals,
        cardUid: cardUid.trim() || null,
        faceEnrolled,
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
          얼굴 사진과 특징값은 <strong>젯슨(키오스크)에만</strong> 있고 이 웹에는
          저장하지 않아요. 여기서는 등록을 마쳤는지만 대장으로 관리해요.
        </p>
        <div className={styles.faceRow}>
          <Badge tone={faceEnrolled ? "success" : "neutral"}>
            {faceEnrolled ? "등록됨" : "미등록"}
          </Badge>
          {profile.faceEnrolledAt && faceEnrolled ? (
            <span className={styles.lead}>
              {new Date(profile.faceEnrolledAt).toLocaleDateString("ko-KR")} 등록
            </span>
          ) : null}
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            onClick={() => setFaceEnrolled(!faceEnrolled)}
          >
            {faceEnrolled ? "등록 해제" : "등록 완료로 표시"}
          </Button>
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
