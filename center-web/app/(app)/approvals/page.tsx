"use client";

import { RequireRole } from "@/components/RequireRole";

import { useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle, InfoRow } from "@/components/Card";
import { Chip, ChipGroup } from "@/components/Chip";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { TextArea } from "@/components/Field";
import { Primary, Side, Split } from "@/components/Layout";
import { Toast, useToast } from "@/components/Toast";
import { formatHeadcount, formatPpe } from "@/lib/rules";
import { useUser } from "@/lib/session";
import { useRequests } from "@/lib/store";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, canApprove } from "@/lib/types";
import type { ApprovalRequest } from "@/lib/types";
import styles from "./page.module.css";

type Filter = "pending" | "all";

function ApprovalsPageInner() {
  const { requests, pendingCount, decide, loading } = useRequests();
  const { message, show } = useToast();
  const user = useUser();

  // 자기가 올린 요청은 자기가 승인하지 못하게 막습니다.
  // (회의 미확정 항목 ③ — 팀장의 셀프 승인을 허용하기로 하면 이 함수만 지우면 됩니다)
  const isOwnRequest = (r: ApprovalRequest) => r.requesterId === user.employeeId;

  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const rows = useMemo(
    () =>
      filter === "pending"
        ? requests.filter((r) => r.status === "pending")
        : requests,
    [requests, filter],
  );

  // 선택된 요청이 필터에서 빠지면 상세 패널은 비웁니다.
  const selected =
    requests.find((r) => r.id === selectedId && rows.includes(r)) ?? null;

  async function handleApprove(request: ApprovalRequest) {
    await decide(request.id, "approve");
    show(`${request.code} ${request.title} 승인했어요.`);
  }

  async function handleReject(request: ApprovalRequest) {
    // 스펙 권장: 반려 사유 없이는 반려할 수 없습니다. 서버도 같은 검사를 합니다.
    if (!rejectReason.trim()) return;
    await decide(request.id, "reject", rejectReason);
    setRejectReason("");
    show(`${request.code} ${request.title} 반려했어요.`);
  }

  const columns: Column<ApprovalRequest>[] = [
    {
      key: "at",
      header: "요청시각",
      width: "110px",
      render: (r) => r.requestedAt,
    },
    {
      key: "who",
      header: "요청자 · 작업",
      width: "1fr",
      render: (r) => (
        <span className={styles.requester}>
          <span className={styles.requesterName}>
            {r.requesterName} {r.requesterRank}
          </span>
          <span className={styles.requesterWork}>
            {r.code} {r.title}
          </span>
        </span>
      ),
    },
    { key: "site", header: "작업장", width: "130px", render: (r) => r.site },
    {
      key: "headcount",
      header: "인원",
      width: "90px",
      render: (r) => formatHeadcount(r.headcount),
    },
    {
      key: "action",
      header: "처리",
      width: "170px",
      render: (r) =>
        r.status === "pending" && isOwnRequest(r) ? (
          <span className={styles.selfNote}>본인 요청</span>
        ) : r.status === "pending" ? (
          <span className={styles.rowActions}>
            <Button size="small" onClick={() => handleApprove(r)}>
              승인
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              onClick={() => setSelectedId(r.id)}
            >
              반려
            </Button>
          </span>
        ) : (
          <span
            className={`${styles.decided} ${
              r.status === "approved"
                ? styles.decidedApproved
                : styles.decidedRejected
            }`}
          >
            {REQUEST_STATUS_LABEL[r.status]}
          </span>
        ),
    },
  ];

  return (
    <>
      <Split>
        <Primary>
          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>승인 대기</CardTitle>
              <ChipGroup>
                <Chip
                  active={filter === "pending"}
                  onClick={() => setFilter("pending")}
                >
                  대기
                </Chip>
                <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                  전체
                </Chip>
              </ChipGroup>
            </CardHeader>

            <DataTable
              label="승인 요청 목록"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setSelectedId(r.id)}
              isSelected={(r) => r.id === selectedId}
              isMuted={(r) => r.status !== "pending"}
              emptyText={
                loading
                  ? "불러오는 중이에요."
                  : filter === "pending"
                    ? "대기 중인 요청이 없어요."
                    : "요청이 없어요."
              }
            />
          </Card>
        </Primary>

        <Side>
          <Card padding={20} gap={12}>
            <CardTitle>요청 상세</CardTitle>

            {selected ? (
              <>
                <InfoRow label="요청자">
                  {selected.requesterName} {selected.requesterRank} ·{" "}
                  {selected.requesterTenure}
                </InfoRow>
                <InfoRow label="작업">
                  {selected.code} {selected.title}
                </InfoRow>
                <InfoRow label="필수 PPE">
                  {formatPpe(selected.requiredPpe)}
                </InfoRow>
                <InfoRow label="자격 확인">
                  <span
                    className={
                      selected.qualificationOk ? styles.qualOk : styles.qualNg
                    }
                  >
                    {selected.qualificationNote}
                  </span>
                </InfoRow>

                {selected.reason ? (
                  <InfoRow label="요청 사유">{selected.reason}</InfoRow>
                ) : null}

                <p className={styles.notice}>
                  승인하면 {selected.site} 터치패드에 이 작업이 바로 노출됩니다.
                  반려하면 작업자에게 사유가 전달돼요.
                </p>

                {selected.status === "pending" && isOwnRequest(selected) ? (
                  <p className={styles.notice}>
                    본인이 올린 요청은 승인하거나 반려할 수 없어요. 다른 승인자가
                    처리해야 합니다.
                  </p>
                ) : selected.status === "pending" ? (
                  <>
                    <TextArea
                      label="반려 사유"
                      height={80}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="반려하려면 사유를 적어주세요"
                    />
                    <div className={styles.detailActions}>
                      <Button
                        variant="outlined"
                        color="assistive"
                        onClick={() => handleReject(selected)}
                        disabled={!rejectReason.trim()}
                      >
                        반려
                      </Button>
                      <Button onClick={() => handleApprove(selected)}>
                        승인
                      </Button>
                    </div>
                  </>
                ) : (
                  <InfoRow label="처리 결과">
                    <Badge tone={REQUEST_STATUS_TONE[selected.status]}>
                      {REQUEST_STATUS_LABEL[selected.status]}
                    </Badge>
                  </InfoRow>
                )}
              </>
            ) : (
              <p className={styles.empty}>
                왼쪽 표에서 요청을 고르면 상세가 여기에 나와요. 지금 대기 중인
                요청은 {pendingCount}건이에요.
              </p>
            )}
          </Card>
        </Side>
      </Split>

      <Toast message={message} />
    </>
  );
}

export default function ApprovalsPage() {
  return (
    <RequireRole allow={canApprove}>
      <ApprovalsPageInner />
    </RequireRole>
  );
}
