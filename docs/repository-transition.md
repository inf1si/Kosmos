# Kosmos main 교체 절차

대상: [inf1si/Kosmos](https://github.com/inf1si/Kosmos) · 확인일: 2026-10-01.

최초에는 `main`을 조회해 교체 방법을 정리했다. 이후 사용자의 교체 요청에 따라 이 커밋에서 새 Next.js 소스·문서로 교체한다. 기존 main 커밋은 [백업 브랜치](https://github.com/inf1si/Kosmos/tree/backup/pre-nextjs-20261001)에 보관한다. Supabase 데이터 이전·Vercel 배포는 별도 후속 단계다.

## 확인한 현재 저장소

- 기본 브랜치: `main`.
- 확인한 커밋: [`aa15e273db52b4ecfbf664bd8dde0cda7438c411`](https://github.com/inf1si/Kosmos/commit/aa15e273db52b4ecfbf664bd8dde0cda7438c411).
- 기존 코드: Astro 6, React 편집기, Drizzle + libSQL/SQLite, Better-Auth, Anthropic SDK. [기존 README](https://github.com/inf1si/Kosmos/blob/aa15e273db52b4ecfbf664bd8dde0cda7438c411/README.md).
- 새 코드: Next.js, Tiptap, IndexedDB, Supabase, 선택적 Responses 형식 AI. [현재 아키텍처](architecture.md).
- 기존 `main`의 보호 여부는 확인 시점에 `false`였다. 실제 반영 시 최신 커밋과 저장소 규칙을 다시 확인한다.

기존 코드를 조금 수정하는 작업이 아니라 앱·인증·DB·빌드 설정을 바꾸는 전체 소스 교체다. GitHub 저장소에 원고 데이터가 모두 들어 있다는 뜻은 아니다. 기존 배포나 실제 DB의 존재·내용은 이 확인에서 검증하지 않았다.

## 권장 방식

**기존 main에서 출발해 새 프로젝트로 파일을 교체하고 일반 커밋으로 올린다.** 기존 커밋의 자식으로 교체 커밋을 만들기 때문에 main의 파일은 바뀌어도 이력은 이어진다. 먼저 예전 main을 가리키는 백업 브랜치를 보관한다.

```text
기존 커밋 A ── 교체 커밋 B
     │              │
backup/...         main
```

새 폴더에서 이력이 없는 저장소를 초기화한 다음 강제 push로 main을 바꿀 필요가 없다. 브랜치 이름 변경이나 저장소 삭제도 필요하지 않다.

## 1. 기존 소스와 실제 데이터 보관

1. 기존 배포·DB에 원고가 있다면 먼저 DB와 첨부를 별도로 내보낸다. SQLite 파일 또는 Turso 원격 데이터는 소스 커밋과 구분한다.
2. 기존 로그인 설정·배포 환경을 운영자용으로 기록한다. 비밀 값은 공개 Git에 넣지 않는다.
3. 최신 main을 가져오고 해당 커밋에서 백업 브랜치를 만든다. 예시 이름은 `backup/pre-nextjs-20261001`이다. 이미 있다면 기존 백업을 덮지 말고 새 이름을 사용한다.

새로 clone하는 경우, Git이 설치된 터미널에서 상위 작업 폴더를 열고:

```powershell
git clone https://github.com/inf1si/Kosmos.git Kosmos
Set-Location -LiteralPath './Kosmos'
git switch main
git pull --ff-only origin main
git status --short
git branch backup/pre-nextjs-20261001
git push origin backup/pre-nextjs-20261001
```

기존 로컬 Kosmos를 사용하면 clone을 반복하지 않고 그 폴더에서 시작한다. `git status --short`에 사용자 변경이 있으면 보존한 뒤 진행한다. 백업 브랜치는 코드 이력의 표식이며 실제 DB·첨부의 백업을 대신하지 않는다.

## 2. 교체 파일 준비

제공한 `novel-studio-source.zip`을 저장소 **밖의 별도 폴더**에 푼다. 내부 `novel-studio/`의 파일들을 저장소 루트에 넣을 것이다. 이 ZIP에는 문서·참고 화면·테스트·SQL과 lockfile이 있고 node_modules·빌드 결과·비밀 키는 없다.

그대로 폴더를 한 겹 더 넣으면 `Kosmos/novel-studio/package.json`이 되어 배포 Root Directory도 따로 설정해야 한다. 권장 구조는 `Kosmos/package.json`, `Kosmos/src/`, `Kosmos/docs/`다.

기존 폴더에 새 파일만 덧붙이면 Astro 설정·package-lock·이전 라우트가 남을 수 있다. **깨끗한 교체용 clone**에서 다음을 실행해 추적 파일을 제거하고 새 파일을 넣는다. 이 단계는 로컬 파일을 삭제하므로 경로와 보존 여부를 먼저 확인한다.

```powershell
git rev-parse --show-toplevel
git status --short
git rm -r -- .
```

출력한 루트가 의도한 **Kosmos clone**인지 확인한 뒤 마지막 명령을 실행한다. `.git`은 유지된다. 사용자 변경·키·DB 파일이 있는 기존 폴더에서 위 명령을 그대로 실행하지 않는다.

다음으로 ZIP을 푼 `novel-studio/`의 **내용물 전체**를 Kosmos 루트에 복사한다. 숨김 이름의 `.gitignore`, `.env.example`도 포함한다. `.git`을 다른 프로젝트의 것으로 교체하지 않는다. 실행 중인 개발 폴더의 node_modules·`.next`·`.env.local`을 함께 복사하지 않는다.

## 3. 검사와 일반 커밋

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git add --all
git diff --cached --stat
git diff --cached --name-only
```

원하는 새 소스·문서가 들어갔는지, 이전 Astro 설정과 npm lockfile이 남지 않았는지 확인한다. 실제 비밀 키·DB·개인 원고와 첨부는 올리지 않는다. `docs/assets/`는 샘플 집필실과 공식 디자인 참고 캡처다.

검사가 통과하고 변경 목록을 확인한 뒤:

```powershell
git commit -m "Replace Kosmos with Next.js novel studio"
git push origin main
```

원격 main이 중간에 바뀌면 일반 push가 거절될 수 있다. 최신 변경을 확인해 반영할 내용을 다시 준비하며 강제 push로 해결하지 않는다. 브랜치 규칙이 PR을 요구하면 교체 브랜치에서 같은 커밋을 만든 뒤 PR로 main에 반영한다.

## 4. 배포 설정 변경

소스 교체만으로 클라우드가 연결되는 것은 아니다. 기존 배포가 main을 자동 감시한다면 새 빌드 설정과 환경을 준비한 뒤 반영한다.

| 항목 | 이전 앱 | 새 앱 |
|---|---|---|
| 프레임워크 | Astro Node standalone | Next.js |
| 패키지 도구 | npm / package-lock | pnpm / pnpm-lock |
| 빌드 | Astro `dist/` | Next.js 기본 배포 구성 |
| 인증 | Better-Auth | Supabase Auth + 작가 허용 목록 |
| DB | SQLite/libSQL/Turso | Supabase PostgreSQL |
| 개발 포트 | 4321 | 3210 |
| 작가 공간 | `/admin` | `/studio` |
| 작품 주소 | `/s/[slug]` 등 | `/read/[workId]` |

Vercel에서는 Next.js, 저장소 루트, Node.js 24, `pnpm build`를 기준으로 설정한다. Supabase 프로젝트·마이그레이션·작가 계정과 환경 변수는 [설정·배포 안내](setup-deployment.md)를 따른다. 이전 `DATABASE_URL`, `BETTER_AUTH_*`, `ANTHROPIC_API_KEY` 값만으로 새 앱이 동작하지 않는다.

운영 Supabase 연결이 없으면 새 집필실은 닫힌 상태다. 기본 샘플 원고가 외부에 자동 게시되지 않는다. 기존 공개 URL을 유지하려면 별도의 URL 변환·리다이렉트가 필요하다.

## 5. 기존 원고가 있는 경우

기존 `series/chapter/wiki_page/link/asset` 데이터는 새 `Workspace/Work/NovelDocument/Publication` 형식과 같지 않다. 이전 DB 파일을 새 프로젝트에 복사하거나 새 ZIP 복원기에 넣어도 자동 이동하지 않는다.

기존 작품·원고·공개 상태, 전역 설정을 작품별로 나누는 규칙, ID와 설정 링크, 각주·첨부, 공개판을 변환하는 가져오기 도구가 필요하다. Better-Auth 사용자·비밀번호도 Supabase 작가 로그인으로 자동 전환되지 않는다. 실제 데이터가 있다면 소스 교체와 데이터 이전을 별도 작업으로 다룬다.

새 데이터의 실제 저장·권한·기기 전환·ZIP 복원까지 확인한 뒤 기존 운영을 전환한다. 기존 DB·첨부는 새 환경 검증 전까지 보존한다.

## 되돌리기

교체 커밋 하나를 되돌리려면 그 커밋의 실제 SHA를 확인한 뒤 `git revert`로 되돌림 커밋을 만들고 일반 push한다. 이렇게 하면 교체 이력도 남는다. 여러 후속 커밋이 있다면 함께 검토한다.

```powershell
git log --oneline -5
git revert <교체-커밋의-실제-SHA>
git push origin main
```

각괄호의 자리표시자는 그대로 실행하지 않고 실제 값을 사용한다. 코드 되돌림은 새 DB·원고·공개판과 배포 환경 변수를 자동 복원하지 않는다. 백업 브랜치와 실제 DB 백업의 역할을 구분한다.
