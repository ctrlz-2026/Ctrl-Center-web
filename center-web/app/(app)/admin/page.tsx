"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle } from "@/components/Card";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { TextArea, TextField } from "@/components/Field";
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
import { AccountProfilePanel } from "./AccountProfilePanel";
import styles from "./page.module.css";

/* 계정 관리 (안전관리자 전용).
 *
 * 가입 신청을 승인하면 그때 로그인 계정이 만들어집니다. 계정 목록에서는
 * 비밀번호 초기화·역할 변경·비활성화를 합니다.
 *
 * **계정을 지우는 버튼은 없습니다.** 지우면 그 사람이 참여한 과거 작업 이력의
 * 이름이 빈칸이 됩니다. 퇴사자는 비활성으로 내립니다. */

const ROLES: Role[] = ["worker", "leader", "safety_admin"];

/** 작업자 직접 등록 폼의 빈 값. */
const EMPTY_FORM = { empNo: "", name: "", team: "", rank: "", cardUid: "" };

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
  /** 상세를 열어둔 사람. 자격·사원증·얼굴등록·작업배정을 여기서 편집합니다. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [registering, setRegistering] = useState(false);

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

  /* 다른 창에 다녀오면 목록을 새로 읽습니다. 얼굴 등록은 젯슨 쪽에서 끝나므로,
     이 화면을 띄워둔 채 등록하고 돌아왔을 때 배지가 옛 값이면 안 됩니다.
     주기적으로 묻지 않는 이유 — 이 목록은 한 번에 전 직원을 읽습니다. */
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  /** 정보 관리 창에서 얼굴 등록 상태가 바뀌면 목록의 배지만 맞춥니다. */
  const applyFace = useCallback((empNo: string, enrolled: boolean) => {
    setAccounts((prev) =>
      prev ? prev.map((a) => (a.empNo === empNo ? { ...a, faceEnrolled: enrolled } : a)) : prev,
    );
  }, []);

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

  /** 안전관리자가 사람을 바로 등록합니다. 끝나면 그 사람의 정보 관리 창을
   *  열어 자격·작업 배정을 이어서 넣을 수 있게 합니다. */
  async function registerWorker() {
    if (registering) return;
    setRegistering(true);
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(form),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      empNo?: string;
    } | null;
    setRegistering(false);
    if (!res.ok || !body?.empNo) {
      show(body?.error ?? "등록하지 못했어요.");
      return;
    }
    show(`${form.name} 님을 등록했어요. 첫 비밀번호는 사번 뒤에 1234 예요.`);
    setForm(EMPTY_FORM);
    await reload();
    setEditing(body.empNo);
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
      /* 게이트를 지나는 데 필요한 두 가지. 누가 아직 준비가 안 됐는지 목록에서
         바로 보이게 합니다 — 전에는 한 명씩 "정보 관리"를 열어봐야 알았습니다. */
      key: "gate",
      header: "사원증 · 얼굴",
      width: "150px",
      render: (a) => (
        <span className={styles.gateBadges}>
          <Badge
            tone={a.card === "issued" ? "success" : a.card === "temp" ? "warning" : "neutral"}
          >
            {a.card === "issued" ? "카드" : a.card === "temp" ? "임시 카드" : "카드 없음"}
          </Badge>
          <Badge tone={a.faceEnrolled ? "success" : "neutral"}>
            {a.faceEnrolled ? "얼굴" : "얼굴 미등록"}
          </Badge>
        </span>
      ),
    },
    {
      key: "state",
      header: "상태",
      width: "84px",
      render: (a) => (
        <Badge tone={a.active ? "success" : "neutral"}>
          {a.active ? "활성" : "비활성"}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "처리",
      width: "290px",
      render: (a) => (
        <span className={styles.rowActions}>
          <Button
            size="small"
            onClick={() => setEditing(a.empNo)}
          >
            정보 관리
          </Button>
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
            <CardTitle>작업자 등록</CardTitle>
          </CardHeader>
          <p className={styles.lead}>
            신청을 기다리지 않고 바로 등록해요. 등록하면 로그인 계정이 같이
            만들어지고, 이어서 자격·작업 배정을 넣는 창이 열려요. 사원증은 지금
            넣어도 되고 나중에 넣어도 돼요. <strong>얼굴은 여기서 넣지 않아요</strong>{" "}
            — 등록한 사번으로 젯슨의 얼굴 등록 프로그램에서 찍으면 이 화면이
            자동으로 &ldquo;얼굴 등록됨&rdquo;으로 바뀌어요.
          </p>
          <div className={styles.registerGrid}>
            <TextField
              label="사번 (숫자 9자리)"
              inputMode="numeric"
              placeholder="202612345"
              value={form.empNo}
              onChange={(e) => setForm({ ...form, empNo: e.target.value })}
            />
            <TextField
              label="이름"
              placeholder="홍길동"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="팀"
              placeholder="생산1팀"
              value={form.team}
              onChange={(e) => setForm({ ...form, team: e.target.value })}
            />
            <TextField
              label="직급"
              placeholder="사원"
              value={form.rank}
              onChange={(e) => setForm({ ...form, rank: e.target.value })}
            />
            <TextField
              label="사원증 UID (선택)"
              placeholder="04A2B3C4"
              value={form.cardUid}
              onChange={(e) => setForm({ ...form, cardUid: e.target.value })}
            />
          </div>
          <div className={styles.registerActions}>
            <Button
              size="medium"
              disabled={
                registering ||
                !/^\d{9}$/.test(form.empNo.trim()) ||
                !form.name.trim() ||
                !form.team.trim() ||
                !form.rank.trim()
              }
              onClick={registerWorker}
            >
              {registering ? "등록 중" : "등록"}
            </Button>
          </div>
        </Card>

        {editing ? (
          <AccountProfilePanel
            empNo={editing}
            headers={authHeaders}
            onSaved={(m) => {
              show(m);
              setEditing(null);
              void reload();
            }}
            onClose={() => setEditing(null)}
            onFaceChanged={applyFace}
          />
        ) : null}

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
