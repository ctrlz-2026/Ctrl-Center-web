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

| 코드 | 경로 | 화면 | 누가 보나 |
| --- | --- | --- | --- |
| W1 | `/login` | 로그인 | 전원 |
| — | `/signup` | 가입 신청 | 계정 없는 사람 (인증 없이 열림) |
| W2 | `/requests/new` | 작업 승인 요청 | 작업자 · 팀장 |
| W3 | `/approvals` | 팀장 승인함 | 팀장 |
| W4 | `/dashboard` | 관제 대시보드 | 전원 |
| W5 | `/me` | 마이페이지 | 작업자 · 팀장 |
| — | `/notes` | 작업장별 특이사항 | 전원 |
| — | `/admin` | 계정 관리 | 안전관리자 |

`/dashboard/sessions/[id]` 는 관제에서 작업 제목을 눌러 들어가는 세션 상세입니다.
젯슨 문열림 시뮬레이션이 들어갈 자리를 비워둔 틀입니다.

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

> `seed.mjs`를 돌리면 Auth 계정이 다시 만들어져 **열어둔 브라우저는 로그아웃됩니다.**
> 다시 로그인하면 됩니다.

### 계정

**아이디 = 사번, 초기 비밀번호 = 사번 + `1234`**

| 사번 | 이름 | 역할 | 비밀번호 |
| --- | --- | --- | --- |
| 202533690 | 김병오 | 팀장 (승인자) | `2025336901234` |
| 202533795 | 윤지윤 | 안전관리자 | `2025337951234` |
| 202533872 | 정천호 | 작업자 | `2025338721234` |
| 202633671 | 박상하 | 작업자 | `2026336711234` |

사번은 `scripts/seed-data.mjs`의 `TEAM` 한 곳에서만 정의합니다 —
세션·요청·출입기록이 전부 사번을 참조해서, 흩어놓으면 하나 바꿀 때 참조를 빠뜨립니다.

---

## 배포

**`main`에 push하면 Vercel이 자동으로 재배포합니다.** 따로 할 일이 없습니다.

- 저장소 — `ctrlz-2026/Ctrl-Center-web` (조직 `ctrlz-2026`)
- 배포 — [ctrl-center-web.vercel.app](https://ctrl-center-web.vercel.app)
- Vercel 프로젝트 Root Directory는 `center-web`

환경변수는 저장소가 아니라 **Vercel 대시보드**에 있습니다
(Settings → Environment Variables). 로컬 `.env.local`과 같은 10개입니다.

> 저장소가 Public인 이유 — Vercel Hobby 플랜은 조직의 Private 저장소를 배포하지
> 못합니다. 비밀키는 `.env.local`에만 있고 그 파일은 `.gitignore`에 있어 올라가지
> 않으므로 공개로 돌렸습니다.

---

## 다른 컴퓨터에서 이어받기

```bash
git clone https://github.com/ctrlz-2026/Ctrl-Center-web.git
cd Ctrl-Center-web/center-web
npm install
```

그다음 **`.env.local`을 직접 넣어야 합니다** — 저장소에 없습니다.
가장 빠른 방법은 쓰던 컴퓨터의 `center-web/.env.local`을 그대로 복사하는 것이고,
없으면 Firebase 콘솔에서 다시 받습니다(`.env.local.example` 주석 참고).

```bash
node --env-file=.env.local scripts/check-firebase.mjs   # 연결부터 확인
npm run dev
```

Firestore는 클라우드에 있으므로 **시드를 다시 돌릴 필요가 없습니다.**
데이터가 이미 들어 있고, 컴퓨터가 바뀌어도 그대로 보입니다.

---

## 구조

```
center-web/
  app/
    (auth)/login/            W1
    (auth)/signup/           가입 신청 (인증 없이 열림)
    (app)/requests/new/      W2
    (app)/approvals/         W3
    (app)/dashboard/         W4
      sessions/[id]/         세션 상세 — 젯슨 시뮬레이션 자리
    (app)/me/                W5
    (app)/notes/             작업장별 특이사항
    (app)/admin/             계정 관리 (안전관리자)
    icon.svg                 파비콘 (ZC 키캡 로고)
    api/
      me/ · requests/        웹용 (Firebase ID 토큰)
      notes/                 작업장별 특이사항
      signup/                가입 신청 — 유일하게 인증 없이 열린 경로
      admin/accounts/        계정 목록 · 역할/비번/활성
        [empNo]/profile/     자격 · 사원증 · 얼굴등록 · 작업배정
      admin/signups/[id]/    가입 승인·거절
      stream/requests/       SSE 실시간
      gate/events/           젯슨 수신구 (기기 키)
      gate/manual/           젯슨 대역 수동 제어 — 기기가 붙으면 삭제
  components/                Button · Badge · Card · DataTable · Field · Logo · TopNav …
  lib/
    firebase/                client · admin · queries · dashboard · auth-guard · user
    gate-contract.ts         젯슨과 맞추는 계약 (이 파일만 넘기면 됨)
    types.ts                 권한 함수가 여기 한 곳에만 있음
  scripts/                   시드 · 초기화 · 연결확인
docs/
  backend-design.md          스키마 · API · 실시간 설계 · 결정 기록
  screenshots/               화면 캡처
```

**고칠 때 어디를 보나**

| 바꾸고 싶은 것 | 파일 |
| --- | --- |
| 누가 무엇을 할 수 있나 | `lib/types.ts` (권한 함수가 여기에만 있음) |
| 색·모서리·여백 | `app/tokens/center.css` (개별 화면 CSS 말고 여기) |
| 사번·시드 데이터 | `scripts/seed-data.mjs` |
| 젯슨과의 약속 | `lib/gate-contract.ts` |
| 왜 그렇게 했는지 | `docs/backend-design.md` |

---

## 현재 상태

**동작하는 것** — 로그인·권한 3역할, 회원가입과 관리자 승인, 계정 관리(비밀번호
초기화·역할 변경·비활성화), 자격/사원증/얼굴등록/작업배정 관리, 승인 워크플로우
(Firestore 영속), 실시간 관제, 작업장별 특이사항, 개인별 출입기록,
젯슨 수신구(중복 제거·형식 검증). 전부 배포돼 있습니다.

**결정해서 굳힌 것** (배경은 `docs/backend-design.md`)

- 문이 열리면 곧 작업 시작 — "문은 열렸는데 아직 작업 전" 상태를 두지 않습니다
- 팀장도 작업을 신청하고, **본인 요청을 본인이 승인**합니다. 팀장도 현장에
  들어가는데 승인자가 한 명뿐이라 막으면 게이트를 통과할 수 없습니다.
  대신 `selfApproved`로 기록에 남깁니다
- 작업 배정과 자격은 **별개의 조건**입니다. 배정 확인은 서버, 자격 확인은 게이트
- 얼굴 사진·특징값은 **웹에 저장하지 않습니다.** 등록 여부만 대장으로 듭니다

**아직인 것**

- **PPE 학습 클래스 확정 대기**: `ppeItems.yoloClass`가 `helmet` 외 전부 `null`.
  모델이 못 잡는 항목을 작업코드 필수 보호구에 넣으면 착용하고 서 있어도 영원히 통과 못 합니다.
- **사원증 실물 배송 대기**: `employeeCards`가 `TEMP-*` UID, `pending: true`
  (관리자 콘솔에서 실물 UID를 넣을 수 있게는 해뒀습니다)
- **게이트 세션 상태 계산**: 인원 충족·해정 판정은 젯슨 연동 후
- **첫 로그인 비밀번호 변경 강제**: 초기 비밀번호가 사번에서 유추되는 값입니다
- **작업코드 표기**: `A-3`, `B-7` 같은 코드가 헷갈린다는 의견이 있습니다.
  빼거나 장소 이름 위주로 바꾸는 안 — 아직 미결
- **PRD 아키텍처 충돌**: PRD 8장은 "젯슨이 서버, 웹은 시각화 클라이언트"인데 현재 구현은 반대.
  하이브리드 안을 회의 안건으로 올려둔 상태
