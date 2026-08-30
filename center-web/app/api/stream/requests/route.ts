import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { loadDashboard } from "@/lib/firebase/dashboard";
import { loadMasters, toRequestView, toSites, toWorkCodes } from "@/lib/firebase/queries";

/* 관제·승인함 실시간 스트림 (Server-Sent Events).
 *
 * 왜 SSE 인가:
 * 브라우저가 Firestore 를 직접 구독하려면 보안 규칙을 열어야 하는데,
 * "DB 는 잠근 채 서버만 접근한다"는 원칙을 깨게 됩니다. 대신 서버가 Admin SDK 로
 * onSnapshot 을 걸고, 변경분을 연결된 클라이언트에 밀어줍니다.
 * 폴링이 아니라 push 라는 스펙 요구(PRD 8장)도 그대로 지킵니다.
 *
 * WebSocket 이 아닌 이유: 방향이 서버 → 클라이언트 한쪽뿐입니다.
 * 클라이언트가 서버로 보내는 건 기존 POST 로 충분해서 양방향 소켓이 필요 없습니다.
 * SSE 는 재연결도 브라우저가 알아서 합니다.
 */

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  const db = adminDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      // 연결이 살아있음을 알리는 신호. 프록시가 유휴 연결을 끊는 것도 막습니다.
      const heartbeat = setInterval(() => {
        if (closed) return;
        send("ping", { at: new Date().toISOString() });
      }, HEARTBEAT_MS);

      // 승인 요청과 게이트 세션을 둘 다 구독합니다. 어느 쪽이 바뀌든
      // 화면이 필요로 하는 전체 묶음을 다시 만들어 보냅니다 — 관제는 두 정보를
      // 합쳐서 보여주기 때문에 따로 보내면 화면이 반쪽만 갱신됩니다.
      let building = false;
      const pushAll = async () => {
        if (building || closed) return;
        building = true;
        try {
          const [masters, reqSnap, dashboard] = await Promise.all([
            loadMasters(),
            db.collection("approvalRequests").get(),
            loadDashboard(),
          ]);
          const requests = reqSnap.docs
            .map((d) => ({ id: d.id, data: d.data() }))
            .sort((a, b) =>
              String(b.data.createdAt).localeCompare(String(a.data.createdAt)),
            )
            .map(({ id, data }) => toRequestView(id, data, masters));

          // 신청 화면에는 이 사람에게 배정된 작업만 띄웁니다 (REST GET 과 같은 규칙).
          const allowed = masters.employees.get(caller.empNo)?.allowedWorkCodes;

          send("requests", {
            requests,
            workCodes: toWorkCodes(
              masters,
              Array.isArray(allowed) ? allowed : null,
            ),
            sites: toSites(masters),
            dashboard,
            at: new Date().toISOString(),
          });
        } catch {
          send("error", { message: "목록을 만들지 못했어요." });
        } finally {
          building = false;
        }
      };

      const onError = () => send("error", { message: "데이터베이스 연결이 끊겼어요." });
      const unsubRequests = db
        .collection("approvalRequests")
        .onSnapshot(() => void pushAll(), onError);
      const unsubSessions = db
        .collection("gateSessions")
        .onSnapshot(() => void pushAll(), onError);
      const unsubscribe = () => {
        unsubRequests();
        unsubSessions();
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 이미 닫힌 경우
        }
      };

      // 브라우저가 탭을 닫거나 이동하면 리스너도 같이 정리합니다.
      // 안 하면 세션마다 Firestore 리스너가 쌓입니다.
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx 계열 프록시가 스트림을 버퍼링하지 않도록.
      "x-accel-buffering": "no",
    },
  });
}
