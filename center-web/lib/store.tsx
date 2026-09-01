"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { getFirebaseAuth } from "./firebase/client";
import { subscribe } from "./live";
import type { LiveStatus } from "./live";
import { useUser } from "./session";
import type { DashboardData } from "./firebase/dashboard";
import type { SiteOption } from "./firebase/queries";
import type { ApprovalRequest, WorkCode } from "./types";

/* 승인 워크플로우. Firestore 가 진실 공급원입니다.
 *
 * 브라우저는 DB 를 직접 만지지 않고 /api/requests 만 부릅니다.
 * 권한 판정(누가 신청할 수 있고 누가 승인할 수 있는지)은 서버가 토큰을 검증해서 하고,
 * 화면 쪽 검사는 UX 용입니다.
 *
 * 갱신은 폴링이 아니라 서버 push 입니다. /api/stream/requests 가 Firestore 를
 * 구독하고 변경분을 SSE 로 밀어줍니다. 그래서 다른 사람이 승인해도 내 화면이
 * 저절로 바뀝니다 — 팀장이 승인하면 관제 화면이 즉시 반응하는 게 이 구조입니다. */

interface SubmitInput {
  workCode: WorkCode;
  siteId?: string;
  /** datetime-local 값 (예: "2026-08-29T09:00"). */
  scheduledAt?: string;
  reason: string;
}

interface RequestsContextValue {
  requests: ApprovalRequest[];
  workCodes: WorkCode[];
  sites: SiteOption[];
  /** 관제 화면 데이터. 전부 게이트 세션에서 계산된 값입니다. */
  dashboard: DashboardData | null;
  pendingCount: number;
  loading: boolean;
  error: string | null;
  /** 실시간 연결 상태. 관제 화면의 연결 표시가 이 값을 씁니다. */
  status: LiveStatus;
  /** 마지막으로 서버에서 갱신을 받은 시각. 끊겼을 때 표기용입니다. */
  lastUpdatedAt: Date | null;
  /** 내가 올린 요청 중 가장 최근 것 (W2 우측 "내 최근 요청"). */
  myLatest: ApprovalRequest | null;
  submit: (input: SubmitInput) => Promise<void>;
  /** reason 은 반려 사유(필수), note 는 승인하며 남기는 한마디(선택). */
  decide: (
    id: string,
    action: "approve" | "reject",
    reason?: string,
    note?: string,
  ) => Promise<void>;
  /** 젯슨이 없는 동안 웹에서 게이트를 진행시킵니다. 기기가 붙으면 사라질 기능입니다. */
  gateControl: (
    action: "unlock" | "end",
    ref: { requestId?: string; sessionId?: string },
  ) => Promise<void>;
}

const RequestsContext = createContext<RequestsContextValue | null>(null);

async function authHeaders(): Promise<HeadersInit> {
  const auth = getFirebaseAuth();
  const token = await auth?.currentUser?.getIdToken();
  return token
    ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
    : { "content-type": "application/json" };
}

export function RequestsProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [workCodes, setWorkCodes] = useState<WorkCode[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    // 서버 push 구독. 최초 스냅샷도 이 스트림으로 옵니다 — 별도 초기 로드가
    // 필요 없습니다. setState 는 스트림 콜백 안에서 일어나므로 연쇄 렌더가 아닙니다.
    return subscribe<{
      requests: ApprovalRequest[];
      workCodes: WorkCode[];
      sites: SiteOption[];
      dashboard: DashboardData;
      at: string;
    }>({
      path: "/api/stream/requests",
      event: "requests",
      onStatus: setStatus,
      onData: (data) => {
        setRequests(data.requests);
        setWorkCodes(data.workCodes);
        setSites(data.sites);
        setDashboard(data.dashboard);
        setLastUpdatedAt(new Date(data.at));
        setError(null);
        setLoading(false);
      },
    });
  }, []);

  const submit = useCallback(
    async (input: SubmitInput) => {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          workCode: input.workCode.code,
          siteId: input.siteId,
          scheduledAt: input.scheduledAt,
          reason: input.reason,
        }),
      });
      if (!res.ok) {
        setError("요청을 보내지 못했어요.");
      }
      // 목록 갱신은 스트림이 밀어줍니다. 여기서 다시 받아오지 않습니다.
    },
    [],
  );

  const decide = useCallback(
    async (
      id: string,
      action: "approve" | "reject",
      reason?: string,
      note?: string,
    ) => {
      const res = await fetch(`/api/requests/${id}/decision`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action, reason, note }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "처리하지 못했어요.");
      }
    },
    [],
  );

  const gateControl = useCallback(
    async (
      action: "unlock" | "end",
      ref: { requestId?: string; sessionId?: string },
    ) => {
      const res = await fetch("/api/gate/manual", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action, ...ref }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "게이트를 제어하지 못했어요.");
      }
      // 갱신은 스트림이 밀어줍니다 (gateSessions 도 구독 중입니다).
    },
    [],
  );

  const value = useMemo<RequestsContextValue>(() => {
    const pendingCount = requests.filter((r) => r.status === "pending").length;
    const myLatest =
      requests.find((r) => r.requesterId === user.employeeId) ?? null;
    return {
      requests,
      workCodes,
      sites,
      dashboard,
      pendingCount,
      loading,
      error,
      status,
      lastUpdatedAt,
      myLatest,
      submit,
      decide,
      gateControl,
    };
  }, [requests, workCodes, sites, dashboard, loading, error, status, lastUpdatedAt, user, submit, decide, gateControl]);

  return (
    <RequestsContext.Provider value={value}>
      {children}
    </RequestsContext.Provider>
  );
}

export function useRequests() {
  const ctx = useContext(RequestsContext);
  if (!ctx) {
    throw new Error("useRequests 는 RequestsProvider 안에서만 쓸 수 있어요.");
  }
  return ctx;
}
