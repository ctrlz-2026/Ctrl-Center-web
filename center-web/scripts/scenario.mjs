/* 전체 시나리오 점검.
 *
 *   node --env-file=.env.local scripts/scenario.mjs                  로컬
 *   SCENARIO_BASE=https://ctrl-center-web.vercel.app \
 *     node --env-file=.env.local scripts/scenario.mjs                배포본
 *
 * 화면이 아니라 **서버**를 두드립니다 — 화면 검사는 UX 이고 실제 차단은 서버가
 * 해야 하므로, 브라우저를 거치지 않고 실제 토큰으로 API 를 직접 부릅니다.
 *
 * **데이터를 바꿉니다.** 요청을 만들고 승인·반려하고 세션까지 시작하므로,
 * 시연 전에는 돌린 뒤 `node --env-file=.env.local scripts/seed.mjs` 로
 * 되돌려 놓으세요. */
const BASE = process.env.SCENARIO_BASE ?? "http://localhost:3000";
const KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

const PEOPLE = {
  kim: ["202533690", "김병오", "팀장"],
  yoon: ["202533795", "윤지윤", "안전관리자"],
  jeong: ["202533872", "정천호", "작업자"],
  park: ["202633671", "박상하", "작업자"],
};

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function login(who) {
  const [empNo] = PEOPLE[who];
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${empNo}@center.local`, password: `${empNo}1234`, returnSecureToken: true }) },
  );
  const j = await r.json();
  if (!j.idToken) throw new Error(`${who} 로그인 실패: ${j.error?.message}`);
  return j.idToken;
}

const api = (token) => async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* 빈 응답 */ }
  return { status: res.status, body };
};

const tokens = {};
for (const who of Object.keys(PEOPLE)) tokens[who] = await login(who);
const kim = api(tokens.kim);
const jeong = api(tokens.jeong);
const park = api(tokens.park);
const yoon = api(tokens.yoon);
const anon = api(null);

console.log("\n[1] 로그인 · 프로필");
for (const [who, [, name, role]] of Object.entries(PEOPLE)) {
  const { status, body } = await api(tokens[who])("/api/me");
  check(`${name}(${role}) /api/me`, status === 200 && body?.name === name, `${status} ${body?.role ?? ""}`);
}

console.log("\n[2] 서버가 막는 것 (화면 안 거치고 직접 호출)");
check("토큰 없이 요청 조회 → 401", (await anon("/api/requests")).status === 401);
{
  const { status } = await jeong("/api/requests/req-seed-1/decision", {
    method: "POST", body: JSON.stringify({ action: "approve" }) });
  check("작업자가 승인 시도 → 403", status === 403, `실제 ${status}`);
}
{
  const { status } = await yoon("/api/requests", {
    method: "POST", body: JSON.stringify({ workCode: "D", siteId: "site-d5" }) });
  check("안전관리자가 작업 신청 → 403", status === 403, `실제 ${status}`);
}
{
  const { status } = await kim("/api/requests/req-seed-1/decision", {
    method: "POST", body: JSON.stringify({ action: "reject", reason: "  " }) });
  check("사유 없이 반려 → 400", status === 400, `실제 ${status}`);
}

console.log("\n[3] 정상 흐름 — 신청 → 승인(전달사항) → 키오스크");
const scheduled = new Date(Date.now() + 60 * 60000).toISOString();
let newId = null;
{
  const { status, body } = await jeong("/api/requests", {
    method: "POST",
    body: JSON.stringify({ workCode: "D", siteId: "site-d5", scheduledAt: scheduled,
      reason: "옥상 컨베이어 정기 점검" }) });
  newId = body?.id ?? null;
  check("정천호가 D(컨베이어) 신청 → 201/200", status < 300 && !!newId, `${status} id=${newId}`);
}
{
  const { status, body } = await kim(`/api/requests/${newId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", note: "옥상 난간 쪽 자재 치우고 시작하세요." }) });
  check("김병오 승인 + 전달사항", status === 200 && body?.status === "approved", body?.approveNote ?? "");
  check("승인자 이름이 실림", body?.approverName === "김병오", body?.approverName ?? "");
}
{
  const { status } = await kim(`/api/requests/${newId}/decision`, {
    method: "POST", body: JSON.stringify({ action: "approve" }) });
  check("이미 처리된 요청 재처리 → 409", status === 409, `실제 ${status}`);
}

console.log("\n[4] 키오스크 — 승인된 것만 노출되는가");
{
  const html = await (await fetch(`${BASE}/kiosk/gate-d5`)).text();
  check("D동 옥상 키오스크에 방금 승인한 작업이 뜸", html.includes("컨베이어 벨트 점검"));
  check("전달사항 플래그가 타일에 표시됨", html.includes("전달사항 있음"));
  const detail = await (await fetch(`${BASE}/kiosk/gate-d5/${newId}`)).text();
  check("작업 카드에 전달사항 본문이 뜸", detail.includes("옥상 난간"));
  check("작업 카드에 필수 PPE 가 뜸", detail.includes("안전모") && detail.includes("안전화"));
}

console.log("\n[5] 반려 흐름");
{
  const { body: created } = await park("/api/requests", {
    method: "POST", body: JSON.stringify({ workCode: "C", siteId: "site-a1", reason: "밸브 누수" }) });
  const rid = created?.id;
  const { status, body } = await kim(`/api/requests/${rid}/decision`, {
    method: "POST", body: JSON.stringify({ action: "reject", reason: "동일 구간 작업이 이미 진행 중입니다" }) });
  check("반려 처리", status === 200 && body?.status === "rejected", body?.rejectReason ?? "");
  const html = await (await fetch(`${BASE}/kiosk/gate-a1`)).text();
  check("반려된 작업은 키오스크에 안 뜸", !html.includes("배관 밸브 교체"));
}

console.log("\n[6] 자격 미달 표시 (박상하 · 밀폐공간 만료)");
{
  const { body } = await park("/api/requests");
  const e = body?.workCodes?.find((w) => w.code === "E");
  check("E(밀폐공간)에 자격 요건이 붙어 있음", !!e?.requiredQualification, e?.requiredQualification ?? "없음");
}

console.log("\n[7] 관제 — 임시 문열림이 곧 작업 시작인가");
{
  const before = (await kim("/api/requests")).body;
  const { status, body } = await kim("/api/gate/manual", {
    method: "POST", body: JSON.stringify({ action: "unlock", requestId: newId }) });
  check("임시 문열림 → 바로 working", status === 200 && body?.state === "working", `${status} ${body?.state}`);
  const html = await (await fetch(`${BASE}/kiosk/gate-d5`)).text();
  check("세션 시작된 작업은 키오스크에서 빠짐", !html.includes("컨베이어 벨트 점검"));
  void before;
}

console.log("\n[8] 작업 기준이 팀장 표와 맞는가");
{
  const { body } = await jeong("/api/requests");
  const want = {
    A: ["사다리 고소 점검", 2], B: ["천장 조명기구 교체", 2], C: ["배관 밸브 교체", 2],
    D: ["컨베이어 벨트 점검", 2], E: ["밀폐공간 설비 정비", 3], F: ["폐수처리장 펌프 점검", 2],
    G: ["도장부스 필터 교체", 2], H: ["공조기 구동벨트 교체", 2], J: ["천장크레인 와이어로프 점검", 2],
  };
  let ok = Object.keys(want).length === body?.workCodes?.length;
  for (const [code, [name, hc]] of Object.entries(want)) {
    const w = body?.workCodes?.find((x) => x.code === code);
    if (!w || w.name !== name || w.requiredHeadcount !== hc) { ok = false; console.log(`     ↳ ${code} 불일치: ${w?.name}/${w?.requiredHeadcount}`); }
  }
  check("작업코드 9건이 표와 일치 (이름·최소인원)", ok);
}

console.log(`\n────────  통과 ${pass} · 실패 ${fail}  ────────`);
process.exit(fail === 0 ? 0 : 1);
