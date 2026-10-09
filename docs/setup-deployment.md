# 로컬 실행·계정 연결·배포

## 개인 자기소개 배포 (2026-10-09)

앱 배포 전에 [20261009121112_author_profile.sql](../supabase/migrations/20261009121112_author_profile.sql)을 한 번 적용한다. 공개 스냅샷 테이블·RLS·공개 열 SELECT 권한·작성자 쓰기 권한을 만들며 작업 공간/인증 제공자/환경 변수는 바꾸지 않는다. 기존 프로젝트에는 `author_profile`로 적용했고 익명 공개 필드 200/소유자 ID 열 401 및 실제 역할의 롤백 쓰기 검사를 완료했다. 새 프로젝트에서는 `authors`와 `auth.uid()`가 있는 초기 스키마 뒤에 적용한다. [기능](author-profile.md)·[검증](../VERIFICATION.md).

## 개인 노트 배포

앱 배포와 함께 [개인 노트 보호 마이그레이션](../supabase/migrations/20261004063340_independent_notes_guard.sql)을 설치한다. 테이블·Auth·RLS·Storage 정책은 바꾸지 않는다. 버전 1 JSON에 선택적 notes 배열과 첨부 noteId 소속을 추가하며 이전 자료를 계속 읽는다. 기존 notes를 누락하는 오래된 탭은 저장을 멈추고 새로고침을 안내한다. 이어 [노트 계층·AI 보호 SQL](../supabase/migrations/20261004074609_note_hierarchy_ai_guard.sql)을 설치해 noteNavigation·aiMessages 누락을 막는다. [휴지통 보호 SQL](../supabase/migrations/20261004104045_workspace_trash_guard.sql)도 적용해 기존 trash 누락·사본/첨부 구조를 보호한다. 운영 설치·배포 확인은 [검증 기록](../VERIFICATION.md)을 따른다.

## 작품 휴지통·게시 철회 배포 (2026-10-07)

앱을 배포하기 **전에** SQL Editor에서 [작품 휴지통·게시 철회 SQL](../supabase/migrations/20261007081500_work_trash_unpublish.sql)을 한 번 실행한다. `guard_workspace_trash` 함수 본문을 교체해 작품 항목을 받아들이고, 작가 본인 판본만 비활성화하는 `unpublish_work(uuid)`를 추가한다(`authenticated`만 실행). 테이블·RLS·기존 payload는 바꾸지 않고 재실행해도 같은 상태가 된다. 실행 후 `select proname from pg_proc where proname='unpublish_work'`로 함수가 있는지 확인한다. 순서를 거꾸로 하면 새 앱의 게시 철회와 작품 휴지통 이동은 "서버에 게시 철회 기능이 아직 설치되지 않았습니다"로 멈추고 작업 공간은 바뀌지 않는다.

2026-10-01에 실제 Supabase 서울 프로젝트에 최초 SQL을 적용했다. 6개 테이블의 RLS, RPC 4개, 비공개 버킷과 Realtime 대상 테이블을 확인했고 공개 회원가입을 닫았다. 익명 REST 접근 검사 7개가 통과했다. 이후 작가 계정 1명·허용 목록·로그인, Vercel GitHub 연결·운영 배포와 기본 클라우드 시험까지 완료했다. 다른 기기 첨부·충돌과 운영 ZIP 파일 복원은 남아 있다. 기존 시험 ZIP의 원고·첨부 복원은 별도 로컬 origin에서 확인했다. 아래 설치 절차를 이미 적용한 프로젝트에 반복 실행하지 않는다. 새 비밀번호 입력·등록은 계정 소유자가 직접 수행한다. [검증 기록](../VERIFICATION.md).

## 제목 없는 문서 휴지통 저장 수정 (2026-10-08)

기존 작품 휴지통 SQL 뒤에 [20261008055311_untitled_trash_documents.sql](../supabase/migrations/20261008055311_untitled_trash_documents.sql)을 적용한다. 제목 없는 문서를 허용하는 앱과 달리 서버가 휴지통 문서의 빈 제목을 거절해 모든 후속 저장이 실패하던 조건을 제거한다. 기존 제목·본문·휴지통 데이터와 트리거/RLS/권한은 바꾸지 않는다. 기존 마이그레이션을 다시 실행하면 이전 함수로 돌아가므로 새 프로젝트도 이 SQL을 마지막 휴지통 보호 수정으로 실행한다. 운영에는 `untitled_trash_documents`(버전 `20261008055831`)가 적용됐고 함수 정의/권한을 확인했다. 앱 재배포·대기열 초기화 없이 열린 앱의 기존 저장 재시도가 동작한다. 실제 작가 브라우저에서 저장 완료 여부는 별도 확인한다.

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
| `OPENAI_API_KEY`, `OPENAI_MODEL` | 서버 | OpenAI 키·구조화 출력 지원 모델 ID |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | 서버 | Claude 키·모델 ID |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | 서버 | Gemini 키·모델 ID |
| `AI_API_KEY`, `AI_MODEL` | 서버 | 이전 OpenAI 별칭. 새 연결은 위의 정식 이름 사용 |
| `BACKUP_STORAGE_PROVIDER` | 서버 | 사용자 선택 `google-drive`. 선택적으로 `s3` |
| `BACKUP_GOOGLE_CLIENT_ID` | 서버 | 본인 Google OAuth Client ID |
| `BACKUP_GOOGLE_CLIENT_SECRET` | 서버 | 같은 클라이언트 secret |
| `BACKUP_GOOGLE_REFRESH_TOKEN` | 서버 | 본인 승인으로 받은 drive.file refresh token |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 | 자동 백업용 legacy service_role. Production만 |
| `BACKUP_AUTHOR_ID` | 서버 | 기존 작가의 Auth UUID. 값은 공개 문서에 넣지 않음 |
| `CRON_SECRET` | 서버 | 별도 무작위 비밀 32자 이상 |
| `BACKUP_S3_PREFIX` | 서버 | 기본 kosmos. Drive 내부 식별과 S3 경로에 사용 |
| `BACKUP_S3_ENDPOINT` | 서버 | S3 선택 시 R2 또는 AWS HTTPS endpoint |
| `BACKUP_S3_REGION` | 서버 | 기본 auto. AWS S3는 실제 region |
| `BACKUP_S3_BUCKET` | 서버 | S3 선택 시 비공개 버킷 |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | 서버 | S3 선택 시 서버 저장소 키 |


현재 Supabase 공식 예시는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 사용하지만 이 앱은 **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**를 읽는다. publishable key 값을 이 변수에 넣을 수 있다. 변수 이름만 공식 예제처럼 바꾸면 현재 앱이 연결을 인식하지 못한다.

Supabase 공개 키는 RLS와 함께 사용하는 값이다. `service_role`/secret key, DB 비밀번호, AI 키를 `NEXT_PUBLIC_` 변수에 넣지 않는다. 일반 집필·동기화는 service-role key를 사용하지 않는다. 독립 서버 백업만 별도 service-role key를 읽는다. `.env.local`은 Git·문서·소스 ZIP에서 제외한다.

환경 변수를 바꾼 뒤 개발 서버를 다시 실행한다. `NEXT_PUBLIC_` 값은 빌드에 반영되므로 Vercel에서는 값 변경 후 재배포한다. 공식 프로젝트 URL·키 위치와 Data API 설정은 [Supabase Next.js 안내](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)를 확인한다.

## 3. Supabase 새 프로젝트

1. [Supabase Dashboard](https://supabase.com/dashboard)에 로그인한다.
2. 기존 빈 프로젝트가 있으면 먼저 확인한다. 이번 연결은 사용자가 만든 `Kosmos` 서울 프로젝트를 사용했다. 새 프로젝트가 필요할 때만 생성하며 DB 비밀번호는 계정 소유자가 보관한다.
3. SQL Editor에서 [001_studio.sql](../supabase/migrations/001_studio.sql) 전체를 **새 프로젝트에 한 번** 실행한다.
4. 이어 [002_document_navigation_guard.sql](../supabase/migrations/002_document_navigation_guard.sql), [003_ai_preferences_guard.sql](../supabase/migrations/003_ai_preferences_guard.sql), [개인 노트 보호 SQL](../supabase/migrations/20261004063340_independent_notes_guard.sql), [노트 계층·AI SQL](../supabase/migrations/20261004074609_note_hierarchy_ai_guard.sql), [휴지통 SQL](../supabase/migrations/20261004104045_workspace_trash_guard.sql), [작품 휴지통·게시 철회 SQL](../supabase/migrations/20261007081500_work_trash_unpublish.sql), [템플릿 보호 SQL](../supabase/migrations/20261007124540_workspace_templates_guard.sql), [서재 순서 SQL](../supabase/migrations/20261007150655_library_order.sql), [빈 제목 휴지통 SQL](../supabase/migrations/20261008055311_untitled_trash_documents.sql)을 순서대로 실행한다. 6개 앱 테이블·private-assets 버킷·preserve_document_navigation·preserve_ai_preferences·preserve_personal_notes·preserve_note_details·preserve_workspace_trash·preserve_workspace_templates 트리거를 확인한다. 기존 프로젝트에는 미적용 번호만 추가하고 001을 다시 실행하지 않는다.
5. Data API를 꺼두었다면 Integrations의 Data API 설정에서 활성화하고 필요한 public 테이블·함수를 노출한다. 노출과 읽기·쓰기 권한은 별개다. SQL의 RLS·GRANT를 유지한다.
6. Realtime publication에 `workspaces`가 포함되었는지 확인한다.

이 마이그레이션은 `create table/function/policy`와 버킷 생성이 있는 최초 설치용이다. 기존 프로젝트에서 재실행하거나 이미 운영 중인 객체를 삭제해 맞추지 않는다. 기존 프로젝트 사용 시 먼저 충돌·백업을 확인하고 별도 전환 마이그레이션을 작성한다.

문서 트리 이전 업데이트: `001`이 설치된 운영 프로젝트에는 `002`만 적용한 뒤 앱을 배포한다. `002`는 재실행해도 트리거를 중복 생성하지 않는다. 2026-10-03 현재 운영 프로젝트에는 적용했고 트리거 활성 상태 `O`를 확인했다. 기존 원고·작가 권한·API 키는 변경하지 않았다.

## 4. 작가 계정

Supabase 서비스에 로그인한 대시보드 계정과 **앱 작가 계정**은 구분된다. 앱은 Supabase Auth 이메일·비밀번호 로그인과 Google 로그인·기존 계정 연결 코드를 지원한다. Google 제공자·수동 연결·복귀 주소를 설정한 뒤 기존 이메일 로그인 → 계정 메뉴 → Google 연결을 한 번 승인한다. 서로 다른 이메일도 같은 작가 UUID를 유지하며 작가 권한을 새로 추가하지 않는다. 현재 운영 Google 제공자와 수동 연결은 활성화됐으며 코드 추가와 실제 활성화 완료를 구분한다. [Google 설정과 사용법](google-login.md).

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

소스는 Git 저장소에 넣어 Vercel에서 가져오거나 Vercel CLI로 배포할 수 있다. 공개 저장소에는 소스·예시 자료만 넣고 원고와 비밀 값은 별도로 보관한다. 소스 저장소는 [inf1si/Kosmos](https://github.com/inf1si/Kosmos)이며 새 Next.js 프로젝트는 저장소 루트에 있다. Supabase 초기 설치와 Vercel GitHub 연결·프로젝트 가져오기·환경 변수·첫 운영 배포를 완료했다. 운영 주소는 [kosmos-ashy.vercel.app](https://kosmos-ashy.vercel.app)이다. GitHub 앱 연결은 해당 저장소 하나만 선택한다. 기존 main 보관·교체·되돌림은 [저장소 안내](repository-transition.md)를 따른다.

2026-10-05 확인: `inf1si/Kosmos`는 개인 계정 소유 저장소이며 현재 공개 상태다. 비공개 저장소도 Vercel GitHub 앱의 접근 권한과 연결을 유지하면 배포할 수 있다. 공개 여부는 배포된 사이트·Supabase 로그인/원고 저장·AI 실행에 쓰이지 않는다. 조직의 비공개 저장소를 Hobby 팀으로 배포하는 제한은 개인 계정 저장소에 해당하지 않는다. [Vercel 비공개 Git 저장소 안내](https://vercel.com/docs/git#deploying-private-git-repositories)를 따른다. 이번 확인에서는 저장소 공개 여부를 변경하지 않았다.

비공개 저장소의 GitHub Actions는 계정 요금제의 실행 시간·저장 공간 한도를 사용한다(GitHub Free는 표준 호스팅 러너 월 2,000분). 이 저장소의 CI·DB 예약 백업은 Actions에서 실행하므로 해당 한도를 확인한다. Vercel의 GitHub 자동 배포는 Actions 워크플로와 별도다. [GitHub Actions 과금·한도](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) 기준, 2026-10-05 확인.

Vercel 프로젝트 설정:

| 항목 | 값 |
|---|---|
| Root Directory | `inf1si/Kosmos` 가져오기는 저장소 루트 `./`. 제공된 로컬 폴더명은 `novel-studio` |
| Framework | Next.js |
| Install | pnpm 11.19.0, lockfile 기준. Vercel의 `ENABLE_EXPERIMENTAL_COREPACK=1` 설정 |
| Build | `pnpm build` |
| Node.js | 24.x를 기본 제안. 지원 범위는 `package.json` 확인 |
| Output | Next.js 기본값 |
| 환경 변수 | Supabase URL·공개 키, 이후 AI 서버 값 |

이번 배포의 Supabase URL·공개 키는 Production에만 넣었다. `ENABLE_EXPERIMENTAL_COREPACK=1`은 Production·Preview에 설정했고 빌드 로그에서 pnpm 11.19.0을 확인했다. 이 변수는 Vercel 빌드 설정이며 앱 환경 변수와 별개다. [Vercel Corepack 안내](https://vercel.com/docs/builds/configure-a-build#corepack).

`ALLOW_LOCAL_PREVIEW`는 제거하거나 `false`로 둔다. Vercel 관리 배포에서는 `pnpm start`를 직접 띄우지 않는다. 배포 환경의 Node와 변수 범위는 [Vercel Node.js 안내](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [환경 변수 안내](https://vercel.com/docs/environment-variables)를 확인한다.

Preview 배포가 운영 작업본을 수정하지 않도록 별도 시험 Supabase 프로젝트를 사용한다. Production과 Preview의 환경 변수를 구분한다. 실제 원고를 넣기 전 독립 백업과 복원 시험을 완료한다.

배포가 성공하면 기본 URL에서 로그인·저장·게시·익명 독서·각주·설정·첨부·ZIP을 다시 확인한다. 사용자 도메인 구매와 연결은 이후에 수행한다. 도메인 변경 후 기기 저장소가 달라지는 점도 확인한다.

## 7. 다음 연결

외부 문서는 [가져오기·내보내기](import-export.md)에서 바로 사용한다. Google Drive 무료 공간 백업과 AI 3종은 코드가 준비됐지만 키·토큰이 없어 아직 실행하지 않는다. [서비스 연결 순서](service-connection.md)대로 Google 프로젝트·최소 권한 OAuth와 Vercel Production 변수를 먼저 설정한다. [AI 안내](ai.md), [백업 안내](backup-restore.md), [운영 안내](operations.md)를 따른다.

서비스 비용의 이전 제안은 [기술 제안](technical-proposal.md)에 있다. 가입·결제 시 최신 가격과 Vercel 플랜의 사용 조건을 확인하며, 미정인 유료 플랜·도메인을 이미 구매한 것으로 기록하지 않는다.

## 사용자 속성·템플릿 보호 배포 (2026-10-07)

앱 배포 전에 [템플릿 보호 마이그레이션](../supabase/migrations/20261007124540_workspace_templates_guard.sql)을 적용한다. 기존 작업 공간 JSON에 템플릿·사용자 속성이 생긴 뒤 구버전 탭이 그 필드를 누락해 저장하는 요청을 거절한다. 명시적 빈 배열은 허용한다. 새 테이블·Auth·Storage·RLS 변경은 없다.

운영 프로젝트에는 SQL을 적용했고 임시 테이블의 실제 트리거로 누락 거절/빈 배열 허용을 확인한 뒤 롤백했다. 함수는 SECURITY INVOKER, 빈 search_path이며 anon/authenticated 직접 실행 권한은 없다. 실제 작가 작업 공간 행은 변경하지 않았다. 앱 배포·로그인한 계정 저장 결과는 [검증 기록](../VERIFICATION.md)에서 별도로 기록한다. 열린 탭은 배포 뒤 새로고침한다.

## 서재 순서 마이그레이션

앱 배포 전에 [20261007150655_library_order.sql](../supabase/migrations/20261007150655_library_order.sql)을 한 번 적용한다. 공개 테이블에 순위 열·작가/작품 인덱스·INSERT 트리거와 작가 조회/저장 RPC를 추가한다. 기존 작품의 최신 게시순을 유지하며 공개 본문·판본 ID·게시일은 바꾸지 않는다. 재실행용 SQL이 아니므로 이미 적용한 프로젝트에서는 다시 실행하지 않는다.

열의 NOT NULL·양수 제약, `assign_library_position` 트리거, `get_author_library()`·`set_library_order(uuid[])`를 확인한다. 두 RPC는 authenticated만 실행 가능하며 내부에서 허용 작가·owner·현재 판본 전체 목록을 검사한다. anon에는 활성 공개 판본의 순위 SELECT만 추가하며 쓰기 권한·기존 RLS·Auth·Storage 정책은 유지한다. 보안 진단의 authenticated SECURITY DEFINER 경고 두 항목은 이 의도된 RPC와 내부 소유자 검사를 함께 검토한다.

운영 적용·CI·실제 계정 검증 여부는 [검증 기록](../VERIFICATION.md)을 따른다. 열린 집필실/서재 탭은 배포 후 새로고침한다.
