# 로컬 실행·계정 연결·배포

2026-10-01에 실제 Supabase 서울 프로젝트에 최초 SQL을 적용했다. 6개 테이블의 RLS, RPC 4개, 비공개 버킷과 Realtime 대상 테이블을 확인했고 공개 회원가입을 닫았다. 익명 REST 접근 검사 7개가 통과했다. 작가 계정·허용 목록·로그인 시험과 Vercel 배포는 남아 있다. 아래 설치 절차를 이미 적용한 프로젝트에 반복 실행하지 않는다. 새 비밀번호 입력·등록은 계정 소유자가 직접 수행한다. [검증 기록](../VERIFICATION.md).

## 1. 로컬 실행

프로젝트 폴더 `novel-studio`를 터미널의 현재 디렉터리로 연다. Node.js 22 또는 24, pnpm 11.19.0이 필요하다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`http://127.0.0.1:3210/studio`에서 연다. 제공된 작업 폴더에는 설치한 의존성이 있지만 소스 ZIP에는 없다. Windows에서는 [start-studio.ps1](../start-studio.ps1)로도 실행할 수 있다. 이 스크립트는 시스템 Node 또는 Codex의 번들 Node를 찾으며 의존성 설치를 대신하지 않는다.

개발 서버가 이미 3210 포트를 사용 중이면 기존 서버를 사용하거나 해당 서버를 먼저 종료한다. 아무 프로세스나 종료하지 않는다. 운영 빌드도 같은 포트를 사용한다.

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

프로젝트는 Next.js 16이다. 개발 변경 전 [AGENTS.md](../AGENTS.md)와 설치된 Next.js의 관련 문서를 확인한다.

## 2. 환경 변수

[.env.example](../.env.example)을 `.env.local`로 복사해 로컬 값을 넣는다. 예제가 비어 있어도 로컬 개발 미리보기는 열린다. 다음 이름은 **현재 앱이 읽는 이름**이다.

| 변수 | 사용 위치 | 설정 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저·서버 | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저·서버 | Supabase publishable key 또는 기존 anon key |
| `ALLOW_LOCAL_PREVIEW` | 서버 | 기본 `false`. 외부 배포에서 켜지 않음 |
| `AI_API_URL` | 서버 | 선택적. 기본 `https://api.openai.com/v1/responses` |
| `AI_API_KEY` | 서버 | AI 연결 때만 설정 |
| `AI_MODEL` | 서버 | 선택한 제공자의 모델 ID. 아직 미정 |

현재 Supabase 공식 예시는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 사용하지만 이 앱은 **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**를 읽는다. publishable key 값을 이 변수에 넣을 수 있다. 변수 이름만 공식 예제처럼 바꾸면 현재 앱이 연결을 인식하지 못한다.

Supabase 공개 키는 RLS와 함께 사용하는 값이다. `service_role`/secret key, DB 비밀번호, AI 키를 `NEXT_PUBLIC_` 변수에 넣지 않는다. 앱 연결에 Supabase service-role key는 필요하지 않다. `.env.local`은 Git·문서·소스 ZIP에서 제외한다.

환경 변수를 바꾼 뒤 개발 서버를 다시 실행한다. `NEXT_PUBLIC_` 값은 빌드에 반영되므로 Vercel에서는 값 변경 후 재배포한다. 공식 프로젝트 URL·키 위치와 Data API 설정은 [Supabase Next.js 안내](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)를 확인한다.

## 3. Supabase 새 프로젝트

1. [Supabase Dashboard](https://supabase.com/dashboard)에 로그인한다.
2. 기존 빈 프로젝트가 있으면 먼저 확인한다. 이번 연결은 사용자가 만든 `Kosmos` 서울 프로젝트를 사용했다. 새 프로젝트가 필요할 때만 생성하며 DB 비밀번호는 계정 소유자가 보관한다.
3. SQL Editor에서 [001_studio.sql](../supabase/migrations/001_studio.sql) 전체를 **새 프로젝트에 한 번** 실행한다.
4. 오류 없이 완료되었는지, 6개 앱 테이블과 `private-assets` 버킷이 생성되었는지 확인한다.
5. Data API를 꺼두었다면 Integrations의 Data API 설정에서 활성화하고 필요한 public 테이블·함수를 노출한다. 노출과 읽기·쓰기 권한은 별개다. SQL의 RLS·GRANT를 유지한다.
6. Realtime publication에 `workspaces`가 포함되었는지 확인한다.

이 마이그레이션은 `create table/function/policy`와 버킷 생성이 있는 최초 설치용이다. 기존 프로젝트에서 재실행하거나 이미 운영 중인 객체를 삭제해 맞추지 않는다. 기존 프로젝트 사용 시 먼저 충돌·백업을 확인하고 별도 전환 마이그레이션을 작성한다.

## 4. 작가 계정

Supabase 서비스에 로그인한 대시보드 계정과 **앱 작가 계정**은 구분된다. 앱은 Supabase Auth 이메일·비밀번호 로그인을 사용한다.

1. Authentication의 사용자 관리에서 작가 사용자 1명을 만들고 이메일 확인 상태를 확인한다.
2. 공개 회원가입을 비활성화한다. 앱에도 회원가입 UI는 없다.
3. 해당 Auth 사용자의 실제 UUID를 복사해 SQL Editor에서 허용 목록에 추가한다.

```sql
-- 따옴표 안의 자리표시자를 실제 Auth 사용자 UUID로 바꿔 실행한다.
insert into public.authors(user_id) values ('작가의-실제-UUID');
```

4. Connect 패널에서 프로젝트 URL과 publishable/anon key를 확인해 환경 변수에 넣는다.
5. 개발 서버를 다시 열어 앱 작가 계정으로 로그인한다.

허용 목록이 없는 Auth 사용자에게 집필실 권한을 주지 않는다. 현재 앱에는 비밀번호 재설정·이메일 확인 콜백 화면이 없으므로 최초 계정·비밀번호 관리는 대시보드에서 처리한다. 후속 사용자 관리 UI를 별도로 구현한다.

## 5. 실제 클라우드 시험

처음에는 샘플 원고로 아래 흐름을 확인하고 날짜·결과를 [검증 기록](../VERIFICATION.md)에 추가한다.

- 원고 수정 후 **클라우드 동기화됨** 확인 → 새로고침 → 별도 브라우저나 기기에서 같은 계정 로그인·확인.
- 한쪽 기기를 끊은 상태에서 두 기기 수정 → 재접속 → 오래된 덮어쓰기 차단과 양쪽 원고 보존.
- 이미지 업로드 → 다른 기기 다운로드 → ZIP 내보내기·시험 복원.
- 장면 게시 → 로그아웃한 독자 화면 확인 → 초안 수정 후 공개판 유지.
- 익명·허용 목록 없는 사용자·다른 작가 계정의 비공개 작업본·이력·첨부 접근 거절.

로컬 미리보기의 원고는 로그인으로 자동 이동하지 않는다. 원래 origin에서 ZIP을 만든 뒤 로그인 작업 공간에서 복원한다. 최초 로그인 시 샘플 작품이 생기지만 자동 외부 게시는 하지 않는다.

## 6. 소스 보관과 Vercel

소스는 Git 저장소에 넣어 Vercel에서 가져오거나 Vercel CLI로 배포할 수 있다. 공개 저장소에는 소스·예시 자료만 넣고 원고와 비밀 값은 별도로 보관한다. 소스 저장소는 [inf1si/Kosmos](https://github.com/inf1si/Kosmos)이며 새 Next.js 프로젝트는 저장소 루트에 있다. Supabase 초기 설치는 완료했고 Vercel GitHub 앱 연결·프로젝트 가져오기·환경 변수·배포는 아직 완료하지 않았다. GitHub 앱 연결은 해당 저장소 하나만 선택한다. 기존 main 보관·교체·되돌림은 [저장소 안내](repository-transition.md)를 따른다.

Vercel 프로젝트 설정:

| 항목 | 값 |
|---|---|
| Root Directory | `inf1si/Kosmos` 가져오기는 저장소 루트 `./`. 제공된 로컬 폴더명은 `novel-studio` |
| Framework | Next.js |
| Install | pnpm, lockfile 기준 |
| Build | `pnpm build` |
| Node.js | 24.x를 기본 제안. 지원 범위는 `package.json` 확인 |
| Output | Next.js 기본값 |
| 환경 변수 | Supabase URL·공개 키, 이후 AI 서버 값 |

`ALLOW_LOCAL_PREVIEW`는 제거하거나 `false`로 둔다. Vercel 관리 배포에서는 `pnpm start`를 직접 띄우지 않는다. 배포 환경의 Node와 변수 범위는 [Vercel Node.js 안내](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [환경 변수 안내](https://vercel.com/docs/environment-variables)를 확인한다.

Preview 배포가 운영 작업본을 수정하지 않도록 별도 시험 Supabase 프로젝트를 사용한다. Production과 Preview의 환경 변수를 구분한다. 실제 원고를 넣기 전 독립 백업과 복원 시험을 완료한다.

배포가 성공하면 기본 URL에서 로그인·저장·게시·익명 독서·각주·설정·첨부·ZIP을 다시 확인한다. 사용자 도메인 구매와 연결은 이후에 수행한다. 도메인 변경 후 기기 저장소가 달라지는 점도 확인한다.

## 7. 다음 연결

AI는 위 저장·권한·복원 흐름이 실제로 확인된 뒤 연결한다. 독립 자동 백업은 별도 저장소와 서버 실행 일정이 필요하다. [AI 안내](ai.md), [백업 안내](backup-restore.md), [운영 안내](operations.md)를 따른다.

서비스 비용의 이전 제안은 [기술 제안](technical-proposal.md)에 있다. 가입·결제 시 최신 가격과 Vercel 플랜의 사용 조건을 확인하며, 미정인 유료 플랜·도메인을 이미 구매한 것으로 기록하지 않는다.
