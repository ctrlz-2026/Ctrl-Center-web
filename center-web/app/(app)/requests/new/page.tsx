"use client";

import { RequireRole } from "@/components/RequireRole";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Card, CardTitle, InfoRow } from "@/components/Card";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { SelectField, TextArea, TextField } from "@/components/Field";
import { Primary, Side, Split } from "@/components/Layout";
import { Toast, useToast } from "@/components/Toast";
import { checkQualification, formatHeadcount, formatPpe } from "@/lib/rules";
import { useUser } from "@/lib/session";
import { useRequests } from "@/lib/store";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, canRequestWork } from "@/lib/types";
import type { WorkCode } from "@/lib/types";
import styles from "./page.module.css";

/** 승인 라인. 지금은 팀에 팀장이 한 명이라 상수입니다.
 *  조직도가 생기면 employees 에서 요청자의 상급자를 찾아 채웁니다. */
const APPROVER = "김병오 팀장";

/** datetime-local 은 로컬 시간대의 "YYYY-MM-DDTHH:mm" 문자열을 받습니다.
 *  toISOString() 은 UTC 로 바꿔버려서 그대로 쓰면 9시간 어긋납니다. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const COLUMNS: Column<WorkCode>[] = [
  {
    key: "code",
    header: "코드",
    width: "120px",
    render: (c) => <span className={styles.code}>{c.code}</span>,
  },
  { key: "name", header: "작업명", width: "1fr", render: (c) => c.name },
  {
    key: "headcount",
    header: "필수인원",
    width: "90px",
    render: (c) => formatHeadcount(c.requiredHeadcount),
  },
  {
    key: "ppe",
    header: "필수 PPE",
    width: "1fr",
    render: (c) =>
      c.requiredQualification
        ? `${formatPpe(c.requiredPpe)} (자격 필요)`
        : formatPpe(c.requiredPpe),
  },
];

function NewRequestPageInner() {
  const { submit, myLatest, workCodes, sites, loading } = useRequests();
  const user = useUser();
  const { message, show } = useToast();

  const [picked, setPicked] = useState<WorkCode | null>(null);
  const [siteId, setSiteId] = useState("");
  // 기본값은 다음 정각. 과거 시각으로 신청하는 걸 막기 위해 min 도 지금으로 겁니다.
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toLocalInput(d);
  });
  const [reason, setReason] = useState("");

  const qualification = picked
    ? checkQualification(picked, user)
    : null;

  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!picked || sending) return;
    setSending(true);
    await submit({
      workCode: picked,
      siteId: siteId || sites[0]?.id,
      scheduledAt,
      reason,
    });
    setSending(false);
    setPicked(null);
    setReason("");
    show("요청을 보냈어요. 팀장 승인함에 바로 올라갑니다.");
  }

  return (
    <>
      <Split>
        <Primary>
          <Card padding={24} gap={24}>
            <CardTitle>새 작업 승인 요청</CardTitle>

            <div className={styles.fieldRow}>
              <SelectField
                label="작업 장소"
                value={siteId || sites[0]?.id || ""}
                onChange={(e) => setSiteId(e.target.value)}
                options={sites.map((s) => ({ value: s.id, label: s.name }))}
              />
              <TextField
                label="작업 예정 시각"
                type="datetime-local"
                value={scheduledAt}
                min={toLocalInput(new Date())}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>

            <div className={styles.group}>
              <span className={styles.groupLabel}>작업코드</span>
              <DataTable
                label="작업코드 목록"
                columns={COLUMNS}
                rows={workCodes}
                emptyText={loading ? "작업코드를 불러오는 중이에요." : "등록된 작업코드가 없어요."}
                rowKey={(c) => c.code}
                onRowClick={setPicked}
                isSelected={(c) => c.code === picked?.code}
              />
            </div>

            <TextArea
              label="요청 사유 (선택)"
              height={96}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="정기 점검 주기 도래로 사다리 상단 고정부 확인이 필요합니다"
            />

            {qualification && !qualification.ok ? (
              <p className={styles.warn}>
                {qualification.note}. 요청은 보낼 수 있지만 게이트에서 입장이
                차단돼요. 자격을 갱신하거나 팀장에게 대체 인원 배정을 요청하세요.
              </p>
            ) : null}

            <div className={styles.actions}>
              <Button variant="outlined" color="assistive" disabled={!picked}>
                임시저장
              </Button>
              <Button onClick={handleSend} disabled={!picked || sending}>
                {sending ? "보내는 중" : "요청 보내기"}
              </Button>
            </div>
          </Card>
        </Primary>

        <Side gap={16}>
          <Card padding={20} gap={12}>
              <span className={styles.sideTitle}>선택한 작업</span>
              {picked ? (
                <>
                  <span className={styles.pickedTitle}>{picked.name}</span>
                  {/* 필수인원·필수 PPE 는 작업자가 입력하지 않고 코드에서 따라옵니다.
                      이 값이 그대로 게이트 검증 기준이 됩니다. */}
                  <InfoRow label="필수인원">
                    {formatHeadcount(picked.requiredHeadcount)}
                  </InfoRow>
                  <InfoRow label="필수 PPE">
                    {formatPpe(picked.requiredPpe)}
                  </InfoRow>
                  <InfoRow label="승인자">{APPROVER}</InfoRow>
                </>
              ) : (
                <span className={styles.pickedEmpty}>
                  위 표에서 작업코드를 고르면 필수인원과 필수 PPE가 자동으로
                  채워져요.
                </span>
              )}
          </Card>

          <Card padding={20} gap={12}>
            <span className={styles.sideTitle}>내 최근 요청</span>
              {myLatest ? (
                <div className={styles.recentRow}>
                  <span
                    className={`${styles.recentName} ${styles.recentNameActive}`}
                  >
                    {myLatest.code} {myLatest.title}
                  </span>
                  <Badge tone={REQUEST_STATUS_TONE[myLatest.status]}>
                    {REQUEST_STATUS_LABEL[myLatest.status]}
                  </Badge>
                </div>
              ) : null}
              {myLatest === null ? (
                <span className={styles.pickedEmpty}>
                  아직 보낸 요청이 없어요.
                </span>
              ) : null}
          </Card>
        </Side>
      </Split>

      <Toast message={message} />
    </>
  );
}

export default function NewRequestPage() {
  return (
    <RequireRole allow={canRequestWork}>
      <NewRequestPageInner />
    </RequireRole>
  );
}
