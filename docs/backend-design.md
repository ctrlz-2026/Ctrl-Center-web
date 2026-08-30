# Center 백엔드 설계

스택 확정 **Next.js 16 Route Handlers + Firebase (Firestore · Auth)**
프로젝트 `ctrlcenter-c390e` · 서울 리전 · **Spark 무료 요금제**

> 이 문서의 이전 판은 Postgres SQL 스키마였습니다. Supabase → Firebase 로 스택이
> 바뀌면서 문서 DB 기준으로 다시 썼습니다. 포트폴리오용 정리본은
> Notion/아티팩트의 「Center 데이터 모델」을 보세요 — 이 문서는 구현 기준입니다.

---

## 0. PRD 와 어긋나는 지점 (미해결)

PRD §8 은 **Jetson 이 서버, 웹은 시각화 클라이언트**입니다.
지금 구현은 반대로 **클라우드가 진실 공급원**입니다. 회의 안건 1번.

권장은 하이브리드입니다.

| 데이터 | 진실 공급원 | 이유 |
| --- | --- | --- |
| 직원·작업코드·자격·승인요청·이력·특이사항 | 클라우드 | 웹이 주인. 팀장은 현장에 없음 |
| 게이트 실시간 판정 (태그·얼굴·PPE·해정) | Jetson 로컬 캐시 | 500ms 보장, 네트워크 끊겨도 동작 |
| 판정 결과 로그 | 클라우드 (Jetson outbox) | 사후 추적·관제·이력 |

---

## 1. 설계 원칙

1. **클라이언트는 DB 를 직접 만지지 않습니다.** Firestore 보안 규칙은 전부 잠겨
   있고(`firestore.rules`), 서버만 Admin SDK 로 접근합니다. 규칙에 로직을 흩어놓으면
   나중에 무엇이 무엇을 막는지 추적이 안 됩니다.
2. **권한은 토큰에서 읽습니다.** 역할은 Firebase Auth 커스텀 클레임에 있고,
   서버가 `verifyIdToken` 으로 확인한 값만 씁니다. 요청 본문의 역할은 믿지 않습니다.
3. **파생값은 저장하지 않습니다.** 자격의 유효/임박/만료는 `expiresOn` 에서,
   연차는 `hiredOn` 에서 매번 계산합니다. 상태를 굳히면 배치 없이는 썩습니다.
4. **젯슨은 관찰만 보고합니다.** 상태 전이와 화면 문구는 서버가 정합니다.
   젯슨을 다른 사람이 만들기 때문에, 어긋나도 상태 머신이 깨지지 않게 한 것입니다.
5. **갱신은 push 입니다.** 폴링하지 않습니다 (PRD §8).

---

## 2. 컬렉션

문서 ID 를 자연키로 씁니다. 사번·작업코드·카드 UID 는 이미 유일하고, 게이트가
카드를 읽었을 때 조회 한 번으로 끝나야 하기 때문입니다.

```
employees/{사번}          이름·팀·직급·역할·입사일·보유자격[]
employeeCards/{카드UID}   → 사번 · issuedAt · revokedAt · pending
qualifications/{코드}     자격 종류 마스터
ppeItems/{코드}           보호구. yoloClass 가 AI 모델 클래스와 1:1
workCodes/{코드}          필수인원 · 필수보호구[] · 필수자격[] · 예상시간
sites/{id}                작업장
gates/{id}                게이트 ↔ 작업장 매핑
approvalRequests/{auto}   요청자·작업코드·작업장·예정시각·상태·승인자·반려사유
gateSessions/{id}         게이트 세션. 끝난 세션이 곧 "작업 이력"
workNotes/{세션_사번}      특이사항. ID 를 고정해 재저장이 덮어쓰게 함
```

아직 안 만든 것: `gateEvents`, `verifications`, `alerts` — 젯슨이 채울 자리입니다.

### 인덱스

`gateSessions` 를 `members array-contains {사번}` 으로 조회합니다. 단일 필드
array-contains 는 자동 인덱스로 처리되어 추가 설정이 필요 없습니다.
정렬을 서버 메모리에서 하는 이유도 같습니다 — 복합 인덱스를 만들지 않기 위해서.

---

## 3. API

### 웹 (Firebase ID 토큰)

```
GET  /api/me                       내 프로필 (자격 상태·연차는 계산값)
GET  /api/me/history               내 작업 이력 (참여한 게이트 세션)
PUT  /api/sessions/:id/note        특이사항 저장
GET  /api/requests                 승인 요청 + 작업코드 + 작업장
POST /api/requests                 요청 생성          worker · leader
POST /api/requests/:id/decision    승인 · 반려         leader 만
GET  /api/stream/requests          실시간 스트림 (SSE)
```

### 게이트 (기기 키 `X-Gate-Key`)

```
POST /api/gate/events              관찰 보고 (배치 · 중복 제거)
```

계약 전문은 `lib/gate-contract.ts` 입니다. 상하 님께 이 파일만 넘기면 됩니다.

### 서버가 막는 것

| 상황 | 응답 |
| --- | --- |
| 토큰 없음·만료 | 401 |
| 작업자가 승인 시도 | 403 |
| 안전관리자가 작업 신청 | 403 |
| 본인 요청 셀프 승인 | 403 |
| 참여하지 않은 작업에 메모 | 403 |
| 사유 없이 반려 | 400 |
| 없는 작업코드·작업장 | 400 |
| 이미 처리된 요청 재처리 | 409 |

화면에서도 막지만 서버가 다시 막습니다. 화면 검사는 UX 이고 실제 차단은 서버입니다.

---

## 4. 실시간 (SSE)

`/api/stream/requests` 가 서버에서 Firestore `onSnapshot` 을 걸고 변경분을
연결된 클라이언트에 밀어줍니다.

**WebSocket 이 아닌 이유** — 방향이 서버 → 클라이언트 한쪽뿐입니다. 클라이언트가
서버로 보내는 건 기존 POST 로 충분해서 양방향 소켓이 필요 없습니다.

**브라우저가 Firestore 를 직접 구독하지 않는 이유** — 그러려면 보안 규칙을 열어야
하는데 원칙 1번과 충돌합니다.

**EventSource 를 쓰지 않은 이유** — Authorization 헤더를 실을 수 없어 토큰을
쿼리스트링에 넣어야 합니다. 서버 로그와 브라우저 히스토리에 ID 토큰이 남습니다.
대신 `fetch` 로 스트림을 직접 읽고(`lib/live.ts`), EventSource 가 공짜로 해주던
자동 재연결을 지수 백오프로 구현했습니다.

관제 화면의 연결 표시는 이 상태를 그대로 씁니다 — 끊기면 빨강으로 바뀌고 마지막
갱신 시각을 띄웁니다 (스펙 "통신 끊김").

---

## 5. 인증

| 주체 | 방식 |
| --- | --- |
| 웹 사용자 | Firebase Auth. 사번을 `{사번}@center.local` 로 매핑 |
| 역할 | 커스텀 클레임 `{ role, empNo }`. 서버가 토큰에서 읽음 |
| 젯슨 | 게이트별 기기 키 (`X-Gate-Key`) |

**젯슨에 Firebase 키를 심지 않습니다.** 기기가 현장에 물리적으로 노출돼 있어
유출되면 DB 전체가 열립니다. 게이트별로 발급하고 유출 시 그 게이트만 폐기합니다.

---

## 6. 운영

```bash
# 컬렉션 생성 + 시드 + Auth 계정 (여러 번 돌려도 안전)
node --env-file=.env.local scripts/seed.mjs

# 연결 확인
node --env-file=.env.local scripts/check-firebase.mjs

# 시연 전 초기화 (승인 상태·특이사항 리셋)
node --env-file=.env.local scripts/reset-requests.mjs

# 보안 규칙 배포
firebase deploy --only firestore:rules
```

데모 계정 — 비밀번호 전부 `center1234`

| 사번 | 이름 | 역할 |
| --- | --- | --- |
| 2019-0417 | 김도현 | 작업자 |
| 2014-0088 | 이현우 | 팀장 |
| 2011-0002 | 정한수 | 안전관리자 |

---

## 7. 남은 것

- [ ] **PRD §8 아키텍처 충돌** — 회의 안건 1번
- [ ] **PPE 클래스 확정** — `ppeItems.yoloClass` 가 `helmet` 빼고 전부 `null`.
      모델이 못 잡는 항목을 작업코드에 넣으면 영원히 통과 못 합니다
- [ ] **사원증 실물** — `employeeCards` 가 `TEMP-*` UID, `pending: true`
- [ ] **게이트 세션 상태 계산** — `/api/gate/events` 가 지금은 형식 검증과
      중복 제거만 합니다. 인원 충족·PPE 통과·해정 판정을 붙여야 합니다.
      **단, "문 열림 → 작업 시작" 규칙은 아래 §7.1 에서 이미 확정됐습니다** —
      이 로직을 짤 때 그대로 따르면 됩니다
- [ ] **`gateEvents` · `verifications` · `alerts` 컬렉션**
- [ ] **W4 KPI 실데이터화** — 게이트 세션이 생기면 `lib/data.ts` 는 사라집니다

### 7.1 결정: 문 열림 = 작업 시작 (2026-08-30)

**"문이 열리면 자동으로 작업 시작으로 본다."** 문은 열렸는데 작업은 아직
시작 전인 중간 상태를 따로 두지 않습니다.

- **왜**: 문을 열어놓고 작업을 안 하는 경우가 실제로 없습니다. 별도의 "작업
  시작" 확인 스텝은 사용자에게 클릭 한 번을 더 시키는 것 말고는 얻는 게 없고,
  오히려 "문은 열렸는데 화면엔 아직 대기중"이라는 오해만 만듭니다.
- **어디에 적용됐나**: `lib/gate-contract.ts` 의 `GateStateResponse.state` 는
  원래부터 `unlocking` 다음이 바로 `working` 이라 이 결정과 이미 맞았습니다.
  젯슨이 없는 동안 관제 화면에서 쓰는 수동 진행 경로(`/api/gate/manual`)는
  기존에 `unlock`→`start`→`end` 세 단계였던 걸 `unlock`→`end` 두 단계로
  합쳤습니다 — `unlock` 버튼을 누르면 세션이 곧바로 `working` 상태로 생성되고
  출입 기록도 그 자리에서 같이 남습니다.
- **앞으로 `/api/gate/events` 상태 계산을 구현할 때**: 인원 충족·PPE 통과
  판정이 끝나 `unlock: true` 를 내려주는 바로 그 응답에서 `state` 도 함께
  `working` 으로 넘겨야 합니다. 별도 이벤트나 웹의 추가 확인을 기다리지 않습니다.
