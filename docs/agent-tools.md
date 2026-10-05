# 저장소 에이전트 스킬과 Anti Slop

설치 기준: 2026-10-05. 설정은 Kosmos 저장소에만 적용한다. Codex·Claude의 개인 설정이나 계정, 앱의 AI 제공자 설정은 바꾸지 않는다.

## 설치된 도구

| 도구 | 원본과 설치 범위 |
|---|---|
| Attention Span | [alexgreensh/attention-span](https://github.com/alexgreensh/attention-span)의 Attention-kind·Rundown·Spartan 출력 스타일과 attention-kind·rundown·spartan·tldr 스킬. 기본은 Attention-kind. |
| Karpathy Skills | [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)의 karpathy-guidelines. 가정 명시·최소 구현·필요한 부분만 수정·검증 가능한 목표를 따른다. |
| Verification Before Completion | [obra/superpowers](https://github.com/obra/superpowers)의 해당 스킬만 설치했다. 완료·커밋·PR 전 실제 검사 결과가 필요하다. |
| Anti Slop | 사용자 지정 [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)의 공식 설치 스킬과 Oxlint 플러그인. 일반 규칙 18개와 Oxlint의 누적 spread 검사 1개를 error로 켠다. |

원본 커밋·설치 파일의 SHA-256은 [.agents/upstream.json](../.agents/upstream.json)에 있다. 스킬 원본은 `.agents/skills/`, 라이선스·원본 안내는 `.agents/third-party/`에 보존한다. Attention Span은 AGPL-3.0, Superpowers·Anti Slop은 MIT이며 Karpathy 원본은 MIT로 선언되어 있지만 별도 LICENSE 파일은 제공하지 않는다. 서로 다른 패키지의 라이선스를 Kosmos 전체 라이선스로 바꾸지 않는다.

## Codex와 Claude에서 사용

- **Codex:** 저장소에서 새 대화를 시작한다. `.agents/skills/`에 스킬이 있으며 [AGENTS.md](../AGENTS.md)가 코딩·완료 검증 스킬과 기본 응답 스타일을 읽도록 연결한다.
- **Claude Code:** 저장소에서 새 세션을 시작한다. [CLAUDE.md](../CLAUDE.md)가 AGENTS.md를 가져오며 `.claude/skills/`의 진입점에서 원본 스킬을 읽는다. 진입점은 일반 파일이므로 Windows에서도 심볼릭 링크 권한이 필요 없다.
- 기본 출력 스타일은 [.claude/settings.json](../.claude/settings.json)의 `Attention-kind`다. Claude의 `/output-style`에서 `Rundown`·`Spartan`으로 바꿀 수 있다. `/attention-kind`, `/rundown`, `/spartan`, `/tldr`은 직접 요청할 때 사용하는 스킬이다.
- 한국어 요청에는 한국어로 답한다. 원본의 ADHD 문구로 사용자의 진단을 가정하지 않는다. 상위 지침·사용자의 구체적 요청을 우선하며, 간결함은 답변 길이에 적용하고 조사·구현·검증을 줄이는 이유로 쓰지 않는다.

현재 실행 중인 대화에 스킬 목록이 즉시 새로 실리는 것은 보장하지 않는다. 파일 설치·진입점·실제 스킬 발견 결과와 Claude 런타임 확인 범위는 [검증 기록](../VERIFICATION.md)을 따른다.

## Anti Slop 실행

Node.js 22 또는 24와 저장소의 pnpm을 사용한다.

```powershell
pnpm install --frozen-lockfile
pnpm lint
```

`oxlint .`이 애플리케이션·테스트·스크립트·루트 설정 파일을 검사한다. [.oxlintrc.json](../.oxlintrc.json)에 규칙과 생성물·설치 스킬·벤더 코드의 제외 범위가 있다. 요청한 Anti Slop만 활성화하며 별도의 Oxlint 기본 correctness 규칙은 켜지 않는다. 직접 Effect 의존성이 없어 선택적인 Effect 규칙은 등록하지 않았다.

플러그인은 [tools/oxlint/anti-slop/index.ts](../tools/oxlint/anti-slop/index.ts)에 있다. `oxlint`와 `@oxlint/plugins`는 현재 조회한 동일 버전 **1.86.0**으로 고정했다. 벤더 TypeScript는 앱의 타입 검사 대상에서 제외하며 Oxlint가 직접 읽는다. 생성된 Next 타입·앱 타입 검사는 기존대로 실행한다.

초기 전체 검사: **141개 파일·19개 규칙, 137개 파일에서 error 3,023건**. 빈 줄 규칙 2,826건, 타입 단언의 SAFETY 설명 90건, unknown 매개변수·런타임 typeof 각 24건 등이 포함된다. 이는 도입 규칙의 진단 수이며 모두 실행 버그라는 뜻은 아니다. 앱 소스는 이번 설치에서 수정하지 않았다. `pnpm lint`는 이 상태에서 종료 코드 1을 반환한다.

[CI](../.github/workflows/verify.yml)는 같은 전체 검사를 실행하고 `anti-slop-lint` JSON 결과물을 보관한다. 기존 위반을 정리하기 전까지 lint 단계만 **advisory (`continue-on-error: true`)**다. 19개 규칙의 실제 로딩·검사 파일·진단 배열을 별도 필수 단계에서 확인하므로 플러그인이 실행되지 않거나 결과가 손상되면 CI는 실패한다. error 규칙은 유지하고 문서·타입·테스트·빌드·암호화 검사의 실패도 기존처럼 CI를 실패시킨다. 따라서 CI 성공은 lint 무결함을 의미하지 않는다. 코드 정리 후 전체 lint가 통과할 때 advisory를 제거한다.

검사를 통과시키려고 규칙을 끄거나 unsafe cast를 추가하지 않는다. 간격 자동 수정과 타입·입력 경계 변경은 별도 정리 작업으로 검토한다. Anti Slop은 정적 규칙 검사이므로 타입 검사·실제 기능 검증을 대체하지 않는다.

## 업데이트

[공식 업데이트 절차](../.agents/skills/install-anti-slop/references/update.md)를 따른다. 스킬 원본과 설치된 플러그인을 대조하고 변경을 보존한다. `--force`로 덮어쓰지 않는다. 정확한 원본 커밋·해시·라이선스·[플러그인 출처](../tools/oxlint/anti-slop/UPSTREAM.md)를 함께 갱신하고 Oxlint와 SDK를 같은 버전으로 올린다. 규칙 수가 바뀌면 CI의 필수 로딩 검사 기준도 함께 갱신한다. Claude 진입점의 원본 경로와 출력 스타일도 확인한다.

업데이트 후 `pnpm lint`, `pnpm typecheck`, 변경에 맞는 테스트·빌드·`pnpm docs:check`를 실행하고 실제 실패와 확인 범위를 기록한다.
