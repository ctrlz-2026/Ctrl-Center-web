# Center

작업 승인 → 게이트 안전검증 → 작업이력·자격 관리를 하나로 묶은 **산업 현장 출입통제 웹**입니다.

> 2026 미래내일 일경험 지원사업 — AI·로봇 안전제어 솔루션 챌린지 4기
> 팀 **Ctrl+Z** · 이 저장소는 **웹(프론트엔드 + 백엔드 + DB)** 범위입니다.
> 키오스크는 NVIDIA Jetson Orin에서 별도 구현되며, 이 저장소와는 API 계약으로만 만납니다.

---

## 무엇을 강제하는가

종이 작업허가서와 단순 출입카드는 "확인"에서 멈추고 출입 자체에는 개입하지 않습니다.
이 시스템은 세 가지를 시스템이 강제합니다.

1. **팀장 승인 없이는** 키오스크에 작업이 뜨지 않습니다 → 입장 시도 자체가 불가능
2. **자격이 만료되면** 검증 단계에 들어가기 전에 차단됩니다
3. 모든 인증·검증·승인이 **자동으로 기록**되어 사후 추적이 됩니다

---

## 화면

| 코드 | 화면 | 역할 |
| --- | --- | --- |
| W1 | 로그인 | 사번·비밀번호. 역할은 계정 속성에서 자동 판별 |
| W2 | 작업 승인 요청 | 작업코드를 고르면 필수인원·보호구가 따라옴 |
| W3 | 팀장 승인함 | 승인이 곧 게이트 노출 조건 |
| W4 | 관제 대시보드 | 작업장별 현황·이상 상황. 서버 push로 실시간 갱신 |
| W5 | 마이페이지 | 자격·작업이력·개인별 출입기록·특이사항 |

---

## 기술

| 구분 | 선택 | 이유 |
| --- | --- | --- |
| 프레임워크 | Next.js 16 (App Router) | Route Handler가 백엔드 역할. 서버와 화면을 한 프로젝트에 |
| 언어 | TypeScript · React 19 | 권한·상태를 타입으로 좁혀 잘못된 값을 못 만들게 |
| 스타일 | CSS Modules + 디자인 토큰 | 경계선을 `border`가 아니라 `inset box-shadow`로 그리는 스펙이라 유틸리티 클래스와 안 맞음 |
| DB | Firebase Firestore | 실시간 구독이 관제 화면에 그대로 맞음 |
| 인증 | Firebase Auth + 커스텀 클레임 | 역할을 토큰에 박아 서버가 검증 |
| 실시간 | Server-Sent Events | 방향이 서버→클라이언트 한쪽뿐이라 WebSocket 불필요 |

---

## 설계 원칙

**클라이언트는 DB를 직접 만지지 않습니다.**
Firestore 보안 규칙은 전부 잠겨 있고(`center-web/firestore.rules`), 서버만 Admin SDK로 접근합니다.
규칙에 로직을 흩어놓으면 나중에 무엇이 무엇을 막는지 추적이 안 됩니다.

**권한은 토큰에서 읽습니다.**
역할은 Firebase Auth 커스텀 클레임에 있고, 서버가 `verifyIdToken`으로 확인한 값만 씁니다.
요청 본문의 역할은 믿지 않습니다.

**파생값은 저장하지 않습니다.**
자격의 유효/임박/만료는 `expiresOn`에서, 연차는 `hiredOn`에서 매번 계산합니다.
상태를 컬럼으로 굳히면 배치 없이는 반드시 썩습니다.

**젯슨은 관찰만 보고하고 상태를 주장하지 않습니다.**
`카드 UID를 09:04:12에 읽었다` ✅ / `인원 충족됐으니 문 열어` ❌
상태 전이와 화면 문구는 서버가 계산해 응답으로 내려줍니다.
계약 전문은 `center-web/lib/gate-contract.ts` 한 파일입니다.

---

## 실행

```bash
cd center-web
npm install
cp .env.local.example .env.local   # 값을 채워야 동작합니다
npm run dev
```

`.env.local`은 **저장소에 없습니다.** Firebase 콘솔에서 직접 받아야 합니다 —
웹 앱 config 6개(프로젝트 설정 → 내 앱)와 서비스 계정 키(프로젝트 설정 → 서비스 계정).
어떤 값이 어디서 오는지는 `.env.local.example` 주석에 적어뒀습니다.

### 스크립트

```bash
node --env-file=.env.local scripts/check-firebase.mjs    # 연결 확인
node --env-file=.env.local scripts/seed.mjs              # 컬렉션 생성 + 시드 + 계정 발급
node --env-file=.env.local scripts/reset-requests.mjs    # 시연 전 초기화
```

`seed.mjs`는 여러 번 돌려도 안전합니다. 진행중 세션은 실행 시점 기준으로 다시 만들어지므로,
시연 직전에 한 번 돌리면 관제 화면의 경과 시간이 그럴듯해집니다.

---

## 구조

```
center-web/
  app/
    (auth)/login/          W1
    (app)/requests/new/    W2
    (app)/approvals/       W3
    (app)/dashboard/       W4
    (app)/me/              W5
    api/
      me/ · requests/      웹용 (Firebase ID 토큰)
      stream/requests/     SSE 실시간
      gate/events/         젯슨 수신구 (기기 키)
      gate/manual/         젯슨 대역 수동 제어 — 기기가 붙으면 삭제
  components/              Button · Badge · Card · DataTable · Field · Chip · TopNav …
  lib/
    firebase/              client · admin · queries · dashboard · auth-guard
    gate-contract.ts       젯슨과 맞추는 계약 (이 파일만 넘기면 됨)
    types.ts               권한 함수가 여기 한 곳에만 있음
  scripts/                 시드 · 초기화 · 연결확인
docs/
  backend-design.md        스키마 · API · 실시간 설계
  screenshots/             화면 캡처
```

---

## 현재 상태

동작하는 것 — 로그인·권한 3역할, 승인 워크플로우(Firestore 영속), 실시간 관제,
개인별 출입기록, 특이사항, 젯슨 수신구(중복 제거·형식 검증).

아직인 것 —

- **PPE 학습 클래스 확정 대기**: `ppeItems.yoloClass`가 `helmet` 외 전부 `null`.
  모델이 못 잡는 항목을 작업코드 필수 보호구에 넣으면 착용하고 서 있어도 영원히 통과 못 합니다.
- **사원증 실물 배송 대기**: `employeeCards`가 `TEMP-*` UID, `pending: true`
- **게이트 세션 상태 계산**: 인원 충족·해정 판정은 젯슨 연동 후
- **PRD 아키텍처 충돌**: PRD 8장은 "젯슨이 서버, 웹은 시각화 클라이언트"인데 현재 구현은 반대.
  하이브리드 안을 회의 안건으로 올려둔 상태
