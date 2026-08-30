"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle } from "@/components/Card";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { TextArea } from "@/components/Field";
import { Stack } from "@/components/Layout";
import { RequireRole } from "@/components/RequireRole";
import { Toast, useToast } from "@/components/Toast";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { useUser } from "@/lib/session";
import {
  ROLE_LABEL,
  SIGNUP_STATUS_LABEL,
  SIGNUP_STATUS_TONE,
  canManageAccounts,
} from "@/lib/types";
import type { ManagedAccount, Role, SignupRequest } from "@/lib/types";
import styles from "./page.module.css";

/* 계정 관리 (안전관리자 전용).
 *
 * 가입 신청을 승인하면 그때 로그인 계정이 만들어집니다. 계정 목록에서는
 * 비밀번호 초기화·역할 변경·비활성화를 합니다.
 *
 * **계정을 지우는 버튼은 없습니다.** 지우면 그 사람이 참여한 과거 작업 이력의
 * 이름이 빈칸이 됩니다. 퇴사자는 비활성으로 내립니다. */

const ROLES: Role[] = ["worker", "leader", "safety_admin"];

async function authHeaders(): Promise<HeadersInit> {
  const token = await getFirebaseAuth()?.currentUser?.getIdToken();
  return token
    ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
    : { "content-type": "application/json" };
}

interface AdminData {
  signups: SignupRequest[];
  accounts: ManagedAccount[];
}

/** 목록 가져오기. 상태를 건드리지 않고 값만 돌려줍니다 — 불러오는 곳(최초
 *  로드, 처리 후 갱신)마다 언제 setState 할지가 달라서입니다. */
async function fetchAdminData(): Promise<AdminData | null> {
  const res = await fetch("/api/admin/accounts", { headers: await authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as AdminData;
}

function AdminPageInner() {
  const me = useUser();
  const { message, show } = useToast();

  const [signups, setSignups] = useState<SignupRequest[] | null>(null);
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  const apply = useCallback((data: AdminData | null) => {
    if (!data) return;
    setSignups(data.signups);
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    // 화면을 떠난 뒤 도착한 응답은 버립니다.
    let alive = true;
    void fetchAdminData().then((data) => {
      if (alive) apply(data);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  /** 처리 후 목록 갱신. */
  const reload = useCallback(
    async () => apply(await fetchAdminData()),
    [apply],
  );

  async function decideSignup(
    s: SignupRequest,
    action: "approve" | "reject",
    reason?: string,
  ) {
    setBusyId(s.id);
    const res = await fetch(`/api/admin/signups/${s.id}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ action, reason }),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    setBusyId(null);

    if (!res.ok) {
      show(body?.error ?? "처리하지 못했어요.");
      return;
    }
    show(
      action === "approve"
        ? `${s.name} 님 계정을 만들었어요. 첫 비밀번호는 ${s.empNo}1234 예요.`
        : `${s.name} 님 신청을 거절했어요.`,
    );
    setRejecting(null);
    setRejectReason("");
    await reload();
  }

  async function patchAccount(
    a: ManagedAccount,
    body: Record<string, unknown>,
    okMessage: string,
  ) {
    setBusyId(a.empNo);
    const res = await fetch(`/api/admin/accounts/${a.empNo}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      password?: string;
    } | null;
    setBusyId(null);

    if (!res.ok) {
      show(data?.error ?? "처리하지 못했어요.");
      return;
    }
    if (data?.password) {
      setResetInfo(`${a.name} 님의 비밀번호를 ${data.password} 로 되돌렸어요.`);
    }
    show(okMessage);
    await reload();
  }

  const signupColumns: Column<SignupRequest>[] = [
    {
      key: "who",
      header: "신청자",
      width: "1fr",
      render: (s) => (
        <span className={styles.who}>
          <span className={styles.whoName}>
            {s.name} {s.rank}
          </span>
          <span className={styles.whoSub}>
            {s.empNo} · {s.team}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "상태",
      width: "110px",
      render: (s) => (
        <Badge tone={SIGNUP_STATUS_TONE[s.status]}>
          {SIGNUP_STATUS_LABEL[s.status]}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "처리",
      width: "170px",
      render: (s) =>
        s.status === "pending" ? (
          <span className={styles.rowActions}>
            <Button
              size="small"
              disabled={busyId === s.id}
              onClick={() => decideSignup(s, "approve")}
            >
              승인
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={busyId === s.id}
              onClick={() => {
                setRejecting(s);
                setRejectReason("");
              }}
            >
              거절
            </Button>
          </span>
        ) : (
          <span className={styles.noLogin}>{s.rejectReason ?? "—"}</span>
        ),
    },
  ];

  const accountColumns: Column<ManagedAccount>[] = [
    {
      key: "who",
      header: "이름",
      width: "1fr",
      render: (a) => (
        <span className={`${styles.who} ${a.active ? "" : styles.inactive}`}>
          <span className={styles.whoName}>
            {a.name} {a.rank}
            {a.empNo === me.employeeId ? (
              <span className={styles.selfTag}> 나</span>
            ) : null}
          </span>
          <span className={styles.whoSub}>
            {a.empNo} · {a.team}
            {a.hasLogin ? "" : " · 로그인 계정 없음"}
          </span>
        </span>
      ),
    },
    {
      key: "role",
      header: "역할",
      width: "150px",
      render: (a) => (
        <select
          className={styles.roleSelect}
          value={a.role}
          disabled={a.empNo === me.employeeId || busyId === a.empNo}
          aria-label={`${a.name} 역할`}
          onChange={(e) =>
            patchAccount(
              a,
              { action: "setRole", role: e.target.value },
              `${a.name} 님을 ${ROLE_LABEL[e.target.value as Role]}(으)로 바꿨어요.`,
            )
          }
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "state",
      header: "상태",
      width: "100px",
      render: (a) => (
        <Badge tone={a.active ? "success" : "neutral"}>
          {a.active ? "활성" : "비활성"}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "처리",
      width: "210px",
      render: (a) => (
        <span className={styles.rowActions}>
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            disabled={!a.hasLogin || busyId === a.empNo}
            onClick={() =>
              patchAccount(
                a,
                { action: "resetPassword" },
                `${a.name} 님 비밀번호를 초기화했어요.`,
              )
            }
          >
            비밀번호 초기화
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            disabled={a.empNo === me.employeeId || busyId === a.empNo}
            onClick={() =>
              patchAccount(
                a,
                { action: "setActive", active: !a.active },
                a.active
                  ? `${a.name} 님 계정을 비활성화했어요.`
                  : `${a.name} 님 계정을 다시 활성화했어요.`,
              )
            }
          >
            {a.active ? "비활성" : "활성"}
          </Button>
        </span>
      ),
    },
  ];

  const pendingCount = signups?.filter((s) => s.status === "pending").length ?? 0;

  return (
    <>
      <Stack>
        <Card padding={24} gap={16}>
          <CardHeader>
            <CardTitle>가입 신청</CardTitle>
            <span className={styles.lead}>
              {signups === null
                ? "불러오는 중이에요."
                : `대기 ${pendingCount}건`}
            </span>
          </CardHeader>

          <p className={styles.lead}>
            승인하면 그 자리에서 로그인 계정이 만들어져요. 첫 비밀번호는 사번 뒤에
            1234 이고, 역할은 작업자로 시작해요 — 승급은 아래 계정 목록에서 해요.
          </p>

          <DataTable
            label="가입 신청 목록"
            columns={signupColumns}
            rows={signups ?? []}
            rowKey={(s) => s.id}
            isMuted={(s) => s.status !== "pending"}
            emptyText={
              signups === null ? "불러오는 중이에요." : "들어온 신청이 없어요."
            }
          />

          {rejecting ? (
            <div className={styles.rejectPanel}>
              <span className={styles.rejectTitle}>
                {rejecting.name} 님 신청 거절
              </span>
              <TextArea
                label="거절 사유"
                height={72}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="사번이 확인되지 않아요 · 소속이 다릅니다 …"
              />
              <div className={styles.rejectActions}>
                <Button
                  size="medium"
                  variant="outlined"
                  color="assistive"
                  onClick={() => setRejecting(null)}
                >
                  취소
                </Button>
                <Button
                  size="medium"
                  disabled={!rejectReason.trim() || busyId === rejecting.id}
                  onClick={() =>
                    decideSignup(rejecting, "reject", rejectReason)
                  }
                >
                  거절
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card padding={24} gap={16}>
          <CardHeader>
            <CardTitle>계정</CardTitle>
            <span className={styles.lead}>
              {accounts === null ? "" : `${accounts.length}명`}
            </span>
          </CardHeader>

          {resetInfo ? <p className={styles.resetNote}>{resetInfo}</p> : null}

          <DataTable
            label="계정 목록"
            columns={accountColumns}
            rows={accounts ?? []}
            rowKey={(a) => a.empNo}
            isMuted={(a) => !a.active}
            emptyText={
              accounts === null ? "불러오는 중이에요." : "계정이 없어요."
            }
          />

          <p className={styles.lead}>
            계정을 지우는 버튼은 없어요. 지우면 그 사람이 참여한 과거 작업 이력의
            이름이 빈칸이 되기 때문에, 퇴사자는 비활성으로 내려요. 역할을 바꾸면
            당사자는 다시 로그인해야 반영돼요.
          </p>
        </Card>
      </Stack>

      <Toast message={message} />
    </>
  );
}

export default function AdminPage() {
  return (
    <RequireRole allow={canManageAccounts}>
      <AdminPageInner />
    </RequireRole>
  );
}
