"use client";

import { RequireRole } from "@/components/RequireRole";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle, Divider, InfoRow } from "@/components/Card";
import { Chip, ChipGroup } from "@/components/Chip";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { TextArea } from "@/components/Field";
import { FixedColumn, Primary, Split } from "@/components/Layout";
import { Toast, useToast } from "@/components/Toast";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { useUser } from "@/lib/session";
import {
  NOTE_DUE_DAYS,
  NOTE_STATE_LABEL,
  NOTE_STATE_TONE,
  QUALIFICATION_TONE,
  canViewMyPage,
} from "@/lib/types";
import type { NoteState, WorkHistory } from "@/lib/types";
import styles from "./page.module.css";

/* W5 · 마이페이지.
 *
 * 작업 이력을 **위아래 두 칸**으로 나눴습니다 (2026-09-27).
 *   위: 작성할 것 — 끝났는데 특이사항을 아직 안 정한 작업 + 진행중 작업
 *   아래: 지난 작업 — 남겼거나(작성함), 남길 말이 없다고 했거나(특이사항 없음),
 *        기한(7일)이 지나 접힌 것(작성 안 함)
 *
 * 전에는 이력이 한 줄로 쌓여서, 저장한 작업과 안 한 작업이 똑같아 보였습니다.
 * 계속 쌓이면 무엇이 밀려 있는지 알 수 없어서 나눴고, "남길 말 없음"을 따로 둬
 * 안 쓴 것과 안 써도 되는 것을 구분했습니다. */

/** 시각만 뽑아 보여줍니다. 날짜는 위 "일시"에 이미 있습니다. */
function hhmm(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

const PENDING: NoteState[] = ["todo", "open"];

const COLUMNS: Column<WorkHistory>[] = [
  { key: "when", header: "일시", width: "112px", render: (h) => h.when },
  {
    key: "work",
    header: "작업",
    width: "1fr",
    render: (h) => (
      <>
        <span className={styles.workCode}>{h.code}</span> {h.title}
      </>
    ),
  },
  {
    key: "verify",
    header: "검증결과",
    width: "1fr",
    render: (h) =>
      h.closed ? (
        <span className={h.passedFirstTry ? styles.verifyOk : styles.verifyRetry}>
          {h.verification || "—"}
        </span>
      ) : (
        <span className={styles.verifyOk}>{h.duration} 경과</span>
      ),
  },
  {
    key: "note",
    header: "특이사항",
    width: "112px",
    render: (h) => (
      <Badge tone={NOTE_STATE_TONE[h.noteState]}>{NOTE_STATE_LABEL[h.noteState]}</Badge>
    ),
  },
];

type PastFilter = "all" | "written" | "none" | "lapsed";

function MyPageInner() {
  const { message, show } = useToast();
  const user = useUser();

  const [history, setHistory] = useState<WorkHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pastFilter, setPastFilter] = useState<PastFilter>("all");

  const load = useCallback(async () => {
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch("/api/me/history", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { history: WorkHistory[] };
    setHistory(data.history);
    setDrafts(Object.fromEntries(data.history.map((h) => [h.id, h.note ?? ""])));
    // 처음 열면 가장 먼저 써야 할 작업을 골라 둡니다.
    setSelectedId(
      (prev) =>
        prev ??
        data.history.find((h) => h.noteState === "todo")?.id ??
        data.history[0]?.id ??
        null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    // 서버에서 이력을 끌어옵니다. 파생 상태가 아니라 외부 데이터 로드입니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pending = history.filter((h) => PENDING.includes(h.noteState));
  const past = history.filter((h) => !PENDING.includes(h.noteState));
  const pastShown =
    pastFilter === "all" ? past : past.filter((h) => h.noteState === pastFilter);
  const count = (s: NoteState) => past.filter((h) => h.noteState === s).length;

  const selected = history.find((h) => h.id === selectedId) ?? null;
  const draft = selected ? (drafts[selected.id] ?? "") : "";
  const unchanged = selected ? draft.trim() === (selected.note ?? "") : true;

  async function save(body: { note?: string; none?: boolean }) {
    if (!selected || saving) return;
    setSaving(true);
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    const res = await fetch(`/api/sessions/${selected.id}/note`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      show("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    // 목록 위치(위 칸 → 아래 칸)가 바로 바뀌게 서버 값으로 다시 받습니다.
    show(body.none ? "'특이사항 없음'으로 표시했어요." : "저장했어요. 다음 작업자에게 전달됩니다.");
    await load();
  }

  const table = (rows: WorkHistory[], empty: string, label: string) => (
    <DataTable
      label={label}
      columns={COLUMNS}
      rows={rows}
      emptyText={loading ? "불러오는 중이에요." : empty}
      rowKey={(h) => h.id}
      onRowClick={(h) => setSelectedId(h.id)}
      isSelected={(h) => h.id === selectedId}
    />
  );

  return (
    <>
      <Split>
        <FixedColumn width={300}>
          <Card padding={20} gap={16}>
            <div className={styles.profileHead}>
              <span className={styles.avatar} aria-hidden="true">
                {user.name.slice(1)}
              </span>
              <span className={styles.name}>{user.name}</span>
              <span className={styles.team}>
                {user.team} · {user.rank}
              </span>
            </div>

            <Divider />

            <InfoRow label="사번">{user.employeeId}</InfoRow>
            <InfoRow label="근속">{user.tenure}</InfoRow>
            <InfoRow label="완료 작업">{user.completedCount}건</InfoRow>
          </Card>

          <Card padding={20} gap={12}>
            <span className={styles.sectionTitle}>보유 자격</span>
            {/* 이 자격이 게이트에서 작업코드의 필수 자격과 대조됩니다.
                만료된 항목은 해당 작업의 입장이 사전 차단돼요 (가설 3). */}
            {user.qualifications.map((q) => (
              <div className={styles.qualRow} key={q.name}>
                <span className={styles.qualName}>{q.name}</span>
                <Badge tone={QUALIFICATION_TONE[q.status]}>{q.badgeLabel}</Badge>
              </div>
            ))}
          </Card>
        </FixedColumn>

        <Primary>
          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>작성할 특이사항 {pending.length > 0 ? pending.length : ""}</CardTitle>
            </CardHeader>
            <p className={styles.sectionHint}>
              끝난 작업은 {NOTE_DUE_DAYS}일 안에 특이사항을 남기거나 &lsquo;남길 말
              없음&rsquo;을 골라주세요. 그 뒤엔 &lsquo;작성 안 함&rsquo;으로 아래에
              접혀요.
            </p>
            {table(pending, "밀린 특이사항이 없어요.", "작성할 특이사항")}
          </Card>

          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>지난 작업</CardTitle>
              <ChipGroup>
                <Chip active={pastFilter === "all"} onClick={() => setPastFilter("all")}>
                  전체 {past.length}
                </Chip>
                <Chip active={pastFilter === "written"} onClick={() => setPastFilter("written")}>
                  작성함 {count("written")}
                </Chip>
                <Chip active={pastFilter === "none"} onClick={() => setPastFilter("none")}>
                  없음 {count("none")}
                </Chip>
                <Chip active={pastFilter === "lapsed"} onClick={() => setPastFilter("lapsed")}>
                  작성 안 함 {count("lapsed")}
                </Chip>
              </ChipGroup>
            </CardHeader>
            {table(pastShown, "해당하는 작업이 없어요.", "지난 작업")}
          </Card>
        </Primary>

        <FixedColumn width={340} as="aside">
          <Card padding={20} gap={12}>
            {selected === null ? (
              <>
                <CardTitle>작업 상세</CardTitle>
                <p className={styles.noteHint}>
                  왼쪽에서 작업을 고르면 상세와 특이사항이 여기에 나와요.
                </p>
              </>
            ) : (
              <>
                <div className={styles.detailHead}>
                  <CardTitle>
                    {selected.code} {selected.title}
                  </CardTitle>
                  <Badge tone={NOTE_STATE_TONE[selected.noteState]}>
                    {NOTE_STATE_LABEL[selected.noteState]}
                  </Badge>
                </div>

                <InfoRow label="일시">{selected.when}</InfoRow>
                <InfoRow label={selected.closed ? "소요시간" : "경과"}>
                  {selected.duration}
                </InfoRow>
                {selected.scheduleNote ? (
                  <InfoRow label="예정 대비">{selected.scheduleNote}</InfoRow>
                ) : null}
                <InfoRow label="참여인원">{selected.members.join(", ")}</InfoRow>
                <InfoRow label="검증결과">
                  {selected.closed ? (
                    <span
                      className={
                        selected.passedFirstTry ? styles.verifyOk : styles.verifyRetry
                      }
                    >
                      {selected.verification || "—"}
                    </span>
                  ) : (
                    <Badge tone="active">작업 진행중</Badge>
                  )}
                </InfoRow>

                {selected.access ? (
                  <>
                    <Divider />
                    {/* 개인별 출입 기록. 세션 요약이 아니라 "내가" 언제 태그하고
                        들어가고 나왔는지입니다. 사후 추적의 근거가 됩니다. */}
                    <span className={styles.sectionTitle}>내 출입 기록</span>
                    <InfoRow label="사원증 태그">{hhmm(selected.access.taggedAt)}</InfoRow>
                    <InfoRow label="입장">{hhmm(selected.access.enteredAt)}</InfoRow>
                    <InfoRow label="퇴장">{hhmm(selected.access.exitedAt)}</InfoRow>
                    <InfoRow label="얼굴인식">
                      {selected.access.faceScore === null
                        ? "—"
                        : `일치 ${Math.round(selected.access.faceScore * 100)}%`}
                    </InfoRow>
                    <InfoRow label="보호구 검증">
                      <span
                        className={
                          selected.access.ppeAttempts > 1 ? styles.verifyRetry : undefined
                        }
                      >
                        {selected.access.ppeAttempts === 0
                          ? "—"
                          : selected.access.ppeAttempts === 1
                            ? "1회 통과"
                            : `${selected.access.ppeAttempts}회 시도`}
                      </span>
                    </InfoRow>
                  </>
                ) : null}

                <Divider />

                <TextArea
                  label="특이사항"
                  height={140}
                  value={draft}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [selected.id]: e.target.value }))
                  }
                  placeholder="다음 작업자가 알아야 할 내용을 적어주세요"
                />

                {/* 저장된 상태를 글로 보여줍니다 — 전에는 저장하고 새로고침해도
                    안 쓴 것과 똑같아 보여서, 저장이 됐는지 알 수 없었습니다. */}
                <p className={styles.savedLine}>
                  {selected.noteState === "written"
                    ? `저장됨 · ${selected.noteSavedLabel ?? ""} — 고쳐서 다시 저장할 수 있어요.`
                    : selected.noteState === "none"
                      ? `'특이사항 없음'으로 표시함 · ${selected.noteSavedLabel ?? ""}`
                      : selected.noteState === "lapsed"
                        ? `${NOTE_DUE_DAYS}일이 지나 '작성 안 함'으로 접혔어요. 지금 남겨도 돼요.`
                        : "작업 중에도, 끝난 뒤에도 적을 수 있어요."}
                </p>

                <Button
                  fullWidth
                  onClick={() => save({ note: draft })}
                  disabled={!draft.trim() || unchanged || saving}
                >
                  {saving
                    ? "저장 중"
                    : selected.noteState === "written"
                      ? "고친 내용 저장"
                      : "특이사항 저장"}
                </Button>
                {selected.noteState !== "written" && selected.noteState !== "none" ? (
                  <Button
                    fullWidth
                    variant="outlined"
                    color="assistive"
                    onClick={() => save({ none: true })}
                    disabled={saving || draft.trim().length > 0}
                  >
                    남길 말 없음
                  </Button>
                ) : null}
              </>
            )}
          </Card>
        </FixedColumn>
      </Split>

      <Toast message={message} />
    </>
  );
}

export default function MyPage() {
  return (
    <RequireRole allow={canViewMyPage}>
      <MyPageInner />
    </RequireRole>
  );
}
