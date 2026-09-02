/* 시드 데이터 정의. seed.mjs 가 이 파일을 읽어 Firestore 에 넣습니다.
 *
 * 데이터를 스크립트에서 분리한 이유: 사람·작업장·작업코드는 자주 손보는데
 * 넣는 로직은 안 바뀝니다. 섞여 있으면 데이터 고치다 로직을 건드리게 됩니다. */

// ─── 보호구 ─────────────────────────────────────────────────────────────────
// yoloClass 는 AI 담당이 학습 클래스를 확정하면 채웁니다.
// null 이면 "모델이 아직 못 잡는 항목"이라는 뜻입니다.
/* 이름은 「작업 기준 설계」(팀장, 2026-09-01)의 표기를 따릅니다 —
 * 장갑 → 보호장갑, 안전벨트 대신 안전대. 표와 화면이 다른 낱말을 쓰면
 * 현장에서 "이거 그거 맞아?"를 되묻게 됩니다. */
export const ppeItems = [
  { code: "helmet", name: "안전모", yoloClass: "helmet", active: true },
  { code: "shoes", name: "안전화", yoloClass: null, active: true },
  { code: "lanyard", name: "안전대", yoloClass: null, active: true },
  { code: "gloves", name: "보호장갑", yoloClass: null, active: true },
  { code: "goggles", name: "보안경", yoloClass: null, active: true },
  { code: "gasmask", name: "방독마스크", yoloClass: null, active: true },
  // 아래 둘은 이번 작업 기준 표에 안 쓰이지만, 작업이 늘면 다시 필요해집니다.
  { code: "vest", name: "안전조끼", yoloClass: null, active: false },
  { code: "harness", name: "안전벨트", yoloClass: null, active: false },
];

/* 이름은 「작업 기준 설계」의 "필요 자격·교육" 칸을 그대로 옮긴 것입니다. */
export const qualifications = [
  { code: "high_place", name: "고소작업 안전교육" },
  { code: "electric", name: "전기작업 유자격" },
  { code: "confined", name: "밀폐공간 작업 특별교육" },
  // G 는 표(G-2)에 "관련 안전교육 이수"로만 적혀 있습니다. 도장부스는 유기용제를
  // 다루므로 기존 chemical 을 이 이름으로 쓰되, 정식 명칭은 확인이 필요합니다.
  { code: "chemical", name: "도장작업 안전교육" },
  { code: "crane", name: "크레인 점검작업 안전교육" },
];

// ─── 작업장 ─────────────────────────────────────────────────────────────────
export const sites = [
  { id: "site-a1", name: "A동 1층 라인2" },
  { id: "site-a3", name: "A동 3층 공조실" },
  { id: "site-b2", name: "B동 2층 기계실" },
  { id: "site-c0", name: "C동 지하 배수조" },
  { id: "site-d5", name: "D동 옥상" },
  { id: "site-e1", name: "E동 도장부스" },
  { id: "site-f0", name: "F동 폐수처리장" },
];

export const gates = sites.map((s) => ({
  id: `gate-${s.id.replace("site-", "")}`,
  siteId: s.id,
  name: `${s.name} 게이트`,
}));

/* ─── 작업코드 ───────────────────────────────────────────────────────────────
 * 내용(작업명·최소인원·자격·PPE·예상시간)은 「작업 기준 설계」(팀장, 2026-09-01)
 * 표가 기준입니다. 여기서 임의로 바꾸지 않습니다.
 *
 * **다만 코드 표기만 팀 표와 다릅니다.** 표는 `A-3`·`B-7` 인데 우리는 글자
 * 하나만 씁니다 — 뒤 숫자가 인원·시간·위험도 어느 것과도 무관한 임의값이라
 * 읽는 사람이 의미를 찾다가 헷갈리기 때문입니다(팀 결정, 2026-09-01).
 *
 * 표와 대조할 수 있게 대응을 남겨둡니다. 표가 바뀌면 이 줄부터 확인하세요.
 *   A ← A-3   B ← B-7   C ← C-1   D ← D-2   E ← E-4
 *   F ← F-1   G ← G-2   H ← H-5   J ← J-8
 *
 * I 는 건너뜁니다. 표에서 홀로 놓이면 숫자 1 이나 소문자 l 로 읽힙니다. */
export const workCodes = [
  { code: "A", name: "사다리 고소 점검", requiredHeadcount: 2,
    requiredPpe: ["helmet", "lanyard"], requiredQualifications: ["high_place"],
    estimatedMinutes: 45, active: true },
  { code: "B", name: "천장 조명기구 교체", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes"], requiredQualifications: ["electric"],
    estimatedMinutes: 30, active: true },
  { code: "C", name: "배관 밸브 교체", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes", "gloves", "goggles"], requiredQualifications: [],
    estimatedMinutes: 75, active: true },
  { code: "D", name: "컨베이어 벨트 점검", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes"], requiredQualifications: [],
    estimatedMinutes: 60, active: true },
  { code: "E", name: "밀폐공간 설비 정비", requiredHeadcount: 3,
    requiredPpe: ["helmet", "shoes", "lanyard"], requiredQualifications: ["confined"],
    estimatedMinutes: 90, active: true },
  { code: "F", name: "폐수처리장 펌프 점검", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes", "gloves", "goggles"], requiredQualifications: [],
    estimatedMinutes: 50, active: true },
  // 표(G-2)에 안전모가 없습니다. 도장부스는 머리 위 낙하물이 없다는 판단으로 보이는데,
  // 다른 작업과 달라 눈에 띄는 부분이라 팀장 확인이 필요합니다.
  { code: "G", name: "도장부스 필터 교체", requiredHeadcount: 2,
    requiredPpe: ["gasmask", "gloves", "goggles"], requiredQualifications: ["chemical"],
    estimatedMinutes: 40, active: true },
  { code: "H", name: "공조기 구동벨트 교체", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes", "gloves"], requiredQualifications: [],
    estimatedMinutes: 35, active: true },
  { code: "J", name: "천장크레인 와이어로프 점검", requiredHeadcount: 2,
    requiredPpe: ["helmet", "shoes", "gloves", "lanyard"],
    requiredQualifications: ["crane"],
    estimatedMinutes: 70, active: true },
];

/* ─── 실제 팀원 사번 ─────────────────────────────────────────────────────────
 * 로그인 계정이 나가는 4명입니다. 사번이 세션·요청·출입기록에서 참조되므로
 * 여기 한 곳에서만 정의하고 나머지 파일은 이걸 가져다 씁니다 —
 * 흩어놓으면 사번 하나 바꿀 때 참조 하나를 빠뜨리게 됩니다. */
export const TEAM = {
  yoon: "202533795", // 윤지윤 · 안전관리자
  kim: "202533690", // 김병오 · 팀장(승인자)
  jeong: "202533872", // 정천호 · 작업자
  park: "202633671", // 박상하 · 작업자
};

/* ─── 직원 ───────────────────────────────────────────────────────────────────
 * 앞의 4명이 실제 팀원(로그인 계정 발급), 나머지는 관제 화면을 채우는 가상 인물입니다.
 * 가상 인물도 employees 에 있어야 게이트 세션의 참여인원이 이름으로 표시됩니다.
 *
 * 자격은 상태를 저장하지 않고 expiresOn 만 둡니다. 유효/임박/만료는 읽을 때 계산합니다.
 * 일부러 만료·임박을 섞어놨습니다 — 자격 미달 차단 시나리오를 보여줘야 하기 때문입니다. */
export const employees = [
  // ── 실제 팀원 (로그인 가능) ──
  {
    empNo: TEAM.yoon, name: "윤지윤", team: "안전관리팀", rank: "부장",
    role: "safety_admin", hiredOn: "2016-03-02", completedCount: 0, active: true,
    login: true,
    qualifications: [
      { code: "high_place", expiresOn: "2028-03-01" },
      { code: "chemical", expiresOn: "2027-11-30" },
    ],
  },
  {
    empNo: TEAM.kim, name: "김병오", team: "생산1팀", rank: "팀장",
    role: "leader", hiredOn: "2015-02-07", completedCount: 1043, active: true,
    login: true,
    qualifications: [
      { code: "high_place", expiresOn: "2027-08-15" },
      { code: "electric", expiresOn: "2027-04-20" },
      { code: "crane", expiresOn: "2028-01-10" },
    ],
  },
  {
    empNo: TEAM.jeong, name: "정천호", team: "생산1팀", rank: "주임",
    role: "worker", hiredOn: "2020-03-18", completedCount: 287, active: true,
    login: true,
    qualifications: [
      { code: "high_place", expiresOn: "2027-05-22" },
      { code: "electric", expiresOn: "2026-09-08" }, // 만료 임박
    ],
  },
  {
    empNo: TEAM.park, name: "박상하", team: "생산2팀", rank: "사원",
    role: "worker", hiredOn: "2021-04-12", completedCount: 156, active: true,
    login: true,
    qualifications: [
      { code: "confined", expiresOn: "2026-07-20" }, // 만료 — 자격 미달 시연용
      { code: "high_place", expiresOn: "2027-09-30" },
    ],
  },

  // ── 관제 화면을 채우는 가상 인물 ──
  {
    empNo: "2013-0055", name: "윤태호", team: "설비보전팀", rank: "부장",
    role: "worker", hiredOn: "2013-05-06", completedCount: 1580, active: true,
    qualifications: [
      { code: "crane", expiresOn: "2028-02-14" },
      { code: "electric", expiresOn: "2027-10-01" },
    ],
  },
  {
    empNo: "2014-0132", name: "홍성길", team: "설비보전팀", rank: "차장",
    role: "worker", hiredOn: "2014-07-21", completedCount: 1120, active: true,
    qualifications: [
      { code: "chemical", expiresOn: "2027-06-30" },
      { code: "confined", expiresOn: "2027-03-15" },
    ],
  },
  {
    empNo: "2017-0264", name: "곽동훈", team: "생산2팀", rank: "반장",
    role: "worker", hiredOn: "2017-09-04", completedCount: 612, active: true,
    qualifications: [
      { code: "high_place", expiresOn: "2027-12-05" },
      { code: "confined", expiresOn: "2026-09-10" }, // 만료 임박
    ],
  },
  {
    empNo: "2018-0511", name: "이수민", team: "전기팀", rank: "주임",
    role: "worker", hiredOn: "2018-05-11", completedCount: 398, active: true,
    qualifications: [{ code: "electric", expiresOn: "2027-07-19" }],
  },
  {
    empNo: "2019-0417", name: "최유진", team: "생산1팀", rank: "주임",
    role: "worker", hiredOn: "2019-04-17", completedCount: 341, active: true,
    qualifications: [
      { code: "high_place", expiresOn: "2027-01-25" },
      { code: "chemical", expiresOn: "2026-06-30" }, // 만료
    ],
  },
  {
    empNo: "2022-0703", name: "김민재", team: "생산1팀", rank: "사원",
    role: "worker", hiredOn: "2022-07-03", completedCount: 94, active: true,
    qualifications: [{ code: "high_place", expiresOn: "2027-04-11" }],
  },
  {
    empNo: "2023-0128", name: "박서준", team: "생산2팀", rank: "사원",
    role: "worker", hiredOn: "2023-01-28", completedCount: 51, active: true,
    qualifications: [],
  },
  {
    empNo: "2021-0619", name: "장현우", team: "전기팀", rank: "사원",
    role: "worker", hiredOn: "2021-06-19", completedCount: 173, active: true,
    qualifications: [{ code: "electric", expiresOn: "2027-02-28" }],
  },

  /* ── A동 1층 라인2 시연용 인원 ────────────────────────────────────────────
   * scripts/seed-demo.mjs 가 쓰는 사람들입니다. 위 인물들은 이미 다른 작업장의
   * 세션에 배정돼 있어서, 그대로 A동에 또 넣으면 **한 사람이 두 작업장에서
   * 동시에 작업 중**으로 보입니다. 「출입 및 인원관리 로직」 §9 가 금지하는
   * 상태(already_in_other_work)라, 시연 화면이 스스로 규칙을 어기게 됩니다. */
  {
    empNo: "2016-0208", name: "서동현", team: "생산1팀", rank: "주임",
    role: "worker", hiredOn: "2016-02-08", completedCount: 612, active: true,
    // 전기 자격이 만료된 상태로 둡니다 — 차단 시연에 씁니다.
    qualifications: [{ code: "electric", expiresOn: "2026-07-31" }],
  },
  {
    empNo: "2020-0345", name: "임하늘", team: "생산1팀", rank: "사원",
    role: "worker", hiredOn: "2020-03-16", completedCount: 204, active: true,
    qualifications: [],
  },
  {
    empNo: "2015-0177", name: "노경수", team: "설비보전팀", rank: "차장",
    role: "worker", hiredOn: "2015-01-27", completedCount: 891, active: true,
    qualifications: [
      { code: "electric", expiresOn: "2027-12-19" },
      { code: "high_place", expiresOn: "2027-06-30" },
    ],
  },
  {
    empNo: "2021-0882", name: "배시우", team: "설비보전팀", rank: "사원",
    role: "worker", hiredOn: "2021-08-02", completedCount: 148, active: true,
    qualifications: [{ code: "electric", expiresOn: "2028-02-14" }],
  },
  {
    empNo: "2019-0733", name: "문가영", team: "전기팀", rank: "주임",
    role: "worker", hiredOn: "2019-07-03", completedCount: 335, active: true,
    qualifications: [{ code: "electric", expiresOn: "2027-09-25" }],
  },
  {
    empNo: "2023-0491", name: "오재민", team: "생산1팀", rank: "사원",
    role: "worker", hiredOn: "2023-04-10", completedCount: 38, active: true,
    qualifications: [],
  },
];

/* ─── 사원증 ─────────────────────────────────────────────────────────────────
 * 카드·리더기가 아직 배송 전이라 UID 가 임시값입니다.
 * pending: true 인 문서는 실물이 오면 실제 UID 로 교체해야 합니다. */
export const employeeCards = employees.map((e) => ({
  cardUid: `TEMP-${e.empNo}`,
  empNo: e.empNo,
  issuedAt: "2026-08-28",
  revokedAt: null,
  pending: true,
}));
