"use client";

import { RequireRole } from "@/components/RequireRole";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardTitle, Divider, InfoRow } from "@/components/Card";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { TextArea } from "@/components/Field";
import { FixedColumn, Primary, Split } from "@/components/Layout";
import { Toast, useToast } from "@/components/Toast";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { useUser } from "@/lib/session";
import { QUALIFICATION_TONE, canViewMyPage } from "@/lib/types";
import type { WorkHistory } from "@/lib/types";
import styles from "./page.module.css";

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

const COLUMNS: Column<WorkHistory>[] = [
  { key: "when", header: "일시", width: "120px", render: (h) => h.when },
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
    key: "duration",
    header: "소요",
    width: "100px",
    render: (h) => (h.closed ? h.duration : `${h.duration} 경과`),
  },
  {
    key: "verify",
    header: "검증결과",
    width: "1fr",
    render: (h) =>
      h.closed ? (
        <span className={h.passedFirstTry ? styles.verifyOk : styles.verifyRetry}>
          {h.verification}
        </span>
      ) : (
        <Badge tone="active">진행중</Badge>
      ),
  },
];

function MyPageInner() {
  const { message, show } = useToast();
  const user = useUser();

  // 이력은 "내가 참여한 끝난 게이트 세션"입니다. 서버가 사번으로 걸러 내려줍니다.
  const [history, setHistory] = useState<WorkHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    setNotes(Object.fromEntries(data.history.map((h) => [h.id, h.note ?? ""])));
    setSelectedId((prev) => prev ?? data.history[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // 서버에서 이력을 끌어옵니다. 파생 상태가 아니라 외부 데이터 로드입니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selected = history.find((h) => h.id === selectedId) ?? null;

  async function saveNote() {
    if (!selected || saving) return;
    setSaving(true);
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    const res = await fetch(`/api/sessions/${selected.id}/note`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ note: notes[selected.id] ?? "" }),
    });
    setSaving(false);
    show(
      res.ok
        ? "저장했어요. 다음 작업자에게 전달됩니다."
        : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }

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
            <InfoRow label="완료 작업">
              {user.completedCount}건
            </InfoRow>
          </Card>

          <Card padding={20} gap={12}>
            <span className={styles.sectionTitle}>보유 자격</span>
            {/* 이 자격이 게이트에서 작업코드의 필수 자격과 대조됩니다.
                만료된 항목은 해당 작업의 입장이 사전 차단돼요 (가설 3). */}
            {user.qualifications.map((q) => (
              <div className={styles.qualRow} key={q.name}>
                <span className={styles.qualName}>{q.name}</span>
                <Badge tone={QUALIFICATION_TONE[q.status]}>
                  {q.badgeLabel}
                </Badge>
              </div>
            ))}
          </Card>
        </FixedColumn>

        <Primary>
          <Card padding={24} gap={16}>
            <CardTitle>작업 이력</CardTitle>
            <DataTable
              label="내 작업 이력"
              columns={COLUMNS}
              rows={history}
              emptyText={loading ? "불러오는 중이에요." : "아직 참여한 작업이 없어요."}
              rowKey={(h) => h.id}
              onRowClick={(h) => setSelectedId(h.id)}
              isSelected={(h) => h.id === selectedId}
            />
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
            <CardTitle>
              {selected.code} {selected.title}
            </CardTitle>

            <InfoRow label="일시">{selected.when}</InfoRow>
            <InfoRow label={selected.closed ? "소요시간" : "경과"}>
              {selected.duration}
            </InfoRow>
            {selected.scheduleNote ? (
              <InfoRow label="예정 대비">{selected.scheduleNote}</InfoRow>
            ) : null}
            <InfoRow label="참여인원">
              {selected.members.join(", ")}
            </InfoRow>
            <InfoRow label="검증결과">
              {selected.closed ? (
                <span
                  className={
                    selected.passedFirstTry ? styles.verifyOk : styles.verifyRetry
                  }
                >
                  {selected.verification}
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
                <InfoRow label="사원증 태그">
                  {hhmm(selected.access.taggedAt)}
                </InfoRow>
                <InfoRow label="입장">
                  {hhmm(selected.access.enteredAt)}
                </InfoRow>
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
              value={notes[selected.id] ?? ""}
              onChange={(e) =>
                setNotes((prev) => ({ ...prev, [selected.id]: e.target.value }))
              }
              placeholder="다음 작업자가 알아야 할 내용을 적어주세요"
            />
            <p className={styles.noteHint}>
              작업 중에도, 끝난 뒤에도 적을 수 있어요.
            </p>

            <Button
              fullWidth
              onClick={saveNote}
              disabled={!(notes[selected.id] ?? "").trim() || saving}
            >
              {saving ? "저장 중" : "특이사항 저장"}
            </Button>
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
