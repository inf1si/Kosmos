# 다음 연결: Google Drive와 AI

Supabase·Vercel과 작가 로그인은 연결됐다. 외부 문서 기능은 파일만으로 바로 사용한다. Drive 연결 절차는 아래 기록을 참고하고 실제 최신 상태는 [구현 상태](status.md)와 [검증 기록](../VERIFICATION.md)을 따른다. AI는 키를 만든 제공자부터 활성화한다. 비밀번호·API 키·refresh token은 채팅에 보내지 않는다. API 키는 본인이 집필실의 AI 설정 또는 Vercel 기본 설정에 직접 넣고, 백업 비밀은 Vercel Production 변수에 넣는다.

2026-10-01에 Google Cloud의 전용 **Kosmos Backup** 프로젝트와 Google Drive API 활성화를 완료했다. 사용자가 앱·웹 OAuth 클라이언트를 만들고 값을 복사해 보관했으며 JSON 다운로드는 완료되지 않았다. 원래 비밀값이 비공개 도구 결과에 포함된 뒤, 사용자가 새 비밀키를 보관하고 기존 키를 비활성화한 상태를 확인했다.

2026-10-02에 사용자 승인 후 실제 홈페이지·데이터 이용 안내·서비스 도메인을 Branding에 저장하고 Data Access에 `drive.file` 하나만 선언·저장했다. Audience는 **프로덕션 단계**이며 **테스트로 돌아가기**가 표시된다. 사용자 동의 후 인증 코드 도착을 확인했고 첫 교환에서는 `invalid_grant`가 보고됐다. 이후 사용자가 재승인·Refresh token 보관 완료를 보고했다. 토큰 값·필드는 읽지 않았으며 완료는 사용자 보고 기준이다. 사용자는 Vercel Production에 Google 연결값 3개를 직접 입력·저장했다고 보고했다. 이후 서버 설정과 운영 Drive 업로드·재다운로드·임시 IndexedDB 복원을 확인했다. 예약·누락 알림은 추가 검증한다. AI 키·모델은 없으며 결제 계정 연결·저장 공간 구매도 수행하지 않았다. [확인 결과](evidence/oauth-preparation-2026-10-02.json).

## 1. Google 프로젝트와 Drive API

1. 백업에 사용할 Google 계정의 남은 공간을 확인한다.
2. [Google Cloud Console](https://console.cloud.google.com/)에서 개인 프로젝트 `Kosmos Backup`을 만든다. 기존 적절한 프로젝트를 사용해도 된다.
3. API 및 서비스의 라이브러리에서 **Google Drive API**를 찾아 활성화한다. Cloud Storage 버킷·유료 Google One·별도 서버는 이 구성에 필요하지 않다. 결제나 유료 서비스 화면이 나오면 이 백업에 필요한 서비스인지 먼저 확인한다.
4. Google Auth Platform에서 앱 이름·지원 이메일·연락 이메일을 설정한다. 개인 Google 계정은 External을 사용한다. 요청 범위는 `https://www.googleapis.com/auth/drive.file` 하나다.
5. 브랜딩의 홈페이지·개인정보처리방침에는 실제 공개 페이지를 등록한다. Kosmos의 공개 소개는 `/`, 데이터 이용 안내는 `/privacy`이며 로그인 없이 읽을 수 있다. 승인된 도메인은 실제 서비스 도메인을 사용하고, 존재하지 않는 약관·정책 URL을 넣지 않는다. Google의 현재 브랜딩 요구와 콘솔 검증 결과를 따른다. [브랜딩 안내](https://support.google.com/cloud/answer/15549049?hl=en).
   - 현재 등록·저장한 값은 홈페이지 `https://kosmos-ashy.vercel.app/`, 데이터 이용 안내 `https://kosmos-ashy.vercel.app/privacy`, 서비스 도메인 `kosmos-ashy.vercel.app`이다. 소스 `41114a1`의 Vercel Production 배포 Ready와 이 두 운영 페이지의 내용·연결을 확인했다. Google 브랜드 검증 완료를 의미하지 않는다.
6. Testing으로 확인할 때 본인 계정을 테스트 사용자로 등록한다. 지속 자동 백업에는 앱 상태를 In production으로 전환한 뒤 토큰을 발급한다. Testing 상태의 이 범위 refresh token은 7일 만료 대상이다. Production 전환은 OAuth 검증과 별개이며 토큰의 영구 유효성을 보장하지 않는다. 개인 사용·범위·검증 요구는 콘솔 안내를 따른다. [Google 게시 상태](https://support.google.com/cloud/answer/15549945?hl=en) · [Google OAuth 만료 규칙](https://developers.google.com/identity/protocols/oauth2).

## 2. 본인 OAuth 클라이언트와 연결 승인

1. OAuth Client를 **Web application**으로 만든다. 이름은 `Kosmos Backup`으로 둔다.
2. Authorized redirect URI에 `https://developers.google.com/oauthplayground`를 정확히 추가한다.
   - 새 클라이언트 비밀값은 생성 시점에만 전체 표시·다운로드될 수 있다. 생성 창을 닫기 전에 본인이 보관한다. 다운로드가 동작하지 않으면 복사 버튼으로 보관하며 채팅·GitHub·공유 문서에 붙이지 않는다. [클라이언트 관리](https://support.google.com/cloud/answer/15549257?hl=en).
3. [Google 공식 OAuth Playground](https://developers.google.com/oauthplayground/)의 설정에서 **Use your own OAuth credentials**를 체크하고 본인 Client ID·활성화된 새 Client secret을 직접 입력한다. Flow는 Server-side, Endpoints는 Google, Access type은 Offline, Force prompt는 Consent Screen으로 둔다.
4. Step 1의 scope 입력에 `https://www.googleapis.com/auth/drive.file` 하나만 넣는다. Google 로그인과 접근 허용은 계정 소유자가 직접 완료한다. 다른 범위가 함께 요청되면 승인하지 않고 설정을 확인한다.
5. Step 2의 **Exchange authorization code for tokens**를 직접 실행하고, 표시되는 **Refresh token**을 본인이 안전하게 보관한다. 현재 첫 교환의 `invalid_grant` 보고 이후 사용자가 새 승인과 Refresh token 보관 완료를 보고했다. 토큰 값은 읽지 않았다. 기본 Playground 클라이언트 토큰은 24시간 후 취소되므로 **본인 클라이언트** 사용이 필요하다. 공유 링크에 자격 증명·토큰을 포함하지 않는다. [Playground 공식 안내](https://developers.google.com/oauthplayground/).

이는 현재 서버 설정 방식이다. Kosmos 안의 원클릭 Google 연결 화면은 아직 구현하지 않았다. Codex의 Google Drive 커넥터 연결도 Kosmos의 서버 토큰을 대신하지 않는다.

## 3. Vercel Production 변수

[Vercel 프로젝트](https://vercel.com/)의 Settings → Environment Variables에서 다음을 **Production에만** 추가한다. [전체 변수 목록](setup-deployment.md)을 함께 참고한다.

사용자가 `BACKUP_GOOGLE_CLIENT_ID`·`BACKUP_GOOGLE_CLIENT_SECRET`·`BACKUP_GOOGLE_REFRESH_TOKEN`의 Value를 직접 넣고 Production에 저장했다고 보고했다. 이 세 값은 사용자 보고 기준이며, 아래 서버용 키·작가 지정·제공자·cron 설정은 이어서 추가해야 한다.

| 변수 | 넣을 값 |
|---|---|
| `BACKUP_STORAGE_PROVIDER` | `google-drive` |
| `BACKUP_GOOGLE_CLIENT_ID` | 본인 OAuth Client ID |
| `BACKUP_GOOGLE_CLIENT_SECRET` | 같은 클라이언트의 secret |
| `BACKUP_GOOGLE_REFRESH_TOKEN` | `drive.file` 승인으로 받은 refresh token |
| `SUPABASE_SERVICE_ROLE_KEY` | 현재 Supabase 프로젝트의 서버용 legacy service_role key. anon key 아님 |
| `BACKUP_AUTHOR_ID` | Supabase Authentication의 기존 작가 사용자 UUID. 대시보드 로그인 계정과 구분 |
| `BACKUP_S3_PREFIX` | `kosmos` 기본값. Drive에서도 내부 식별자로 사용 |
| `CRON_SECRET` | 암호 관리자 등으로 생성한 별도 무작위 32자 이상 비밀 |

Production 재배포 뒤 작가 로그인 → 백업과 복구 → **지금 외부 백업**을 실행한다. 성공 시각·버전·문서·첨부 수, Drive의 `Kosmos 백업` 폴더와 ZIP을 확인한다. ZIP을 내려받아 별도 시험 환경에서 복원한 뒤 다음 04시대 자동 실행을 확인한다. 이 검증이 끝나기 전에는 자동 백업이 작동 중이라고 기록하지 않는다.

토큰 취소·만료·공간 부족이면 과거 정상 ZIP은 남는다. Google 승인을 다시 받거나 공간을 정리하고 같은 절차로 새 성공을 확인한다. 실제 값은 문서에 기록하지 않는다.

## 4. AI 제공자별 연결

가장 간단한 방법은 로그인한 **집필실 → AI 대화 → AI 설정**에서 제공자, 정확한 모델 ID, 발급받은 API 키를 넣고 **연결 저장**하는 것이다. 재배포 없이 해당 브라우저에 연결된다. 키·모델은 서버가 암호화한 쿠키로 최대 30일 보관하며 다른 기기·도메인에서는 다시 넣는다. 저장 자체는 AI를 호출하지 않는다. 프롬프트는 4,000자까지 작성해 프리셋으로 저장·적용한다. 계정에 동기화·백업하며 API 키는 제외한다. 기본 6종·사용자 20개와 재설정은 [AI 안내](ai.md)를 따른다.

Vercel 연결은 모든 기기가 사용할 **선택적 서버 기본값**이다. 이 브라우저의 연결이 우선하고, 브라우저 연결이 없을 때 아래 값을 사용한다.

| 제공자 | 키 발급·모델 확인 | Vercel Production 변수 |
|---|---|---|
| OpenAI | [API 플랫폼](https://platform.openai.com/)과 Responses 구조화 출력 지원 모델 | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Claude | [Anthropic Console](https://platform.claude.com/)과 Messages JSON Schema 지원 모델 | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Gemini | [Google AI Studio](https://aistudio.google.com/)와 generateContent JSON Schema 지원 모델 | `GEMINI_API_KEY`, `GEMINI_MODEL` |

현재 키·모델은 없다. 각 키를 만든 뒤 제공자 문서의 정확한 모델 ID를 넣는다. 하나만 연결해도 그 제공자부터 사용할 수 있다. 세 계정의 결제·사용 한도는 서로 별개이며 ChatGPT·Claude 웹 구독이 API 사용료를 대신한다고 가정하지 않는다. 제공자 대시보드의 가능한 예산·알림·사용 제한을 설정하고 짧은 샘플로 먼저 검토한다.

Vercel 환경 변수를 바꾸었다면 재배포한다. 집필실에서 키를 저장했다면 재배포하지 않아도 된다. 참고 패널의 **AI 대화** 탭(서식 도구의 **AI 대화**)에서 연결된 제공자를 선택한다. 보낼 자료에서 현재 원고 포함 여부와 참고 문서를 선택한다. 질문·시스템 프롬프트·최근 대화·선택 자료는 해당 제공자 한 곳에 전송된다. 실패 시 다른 제공자로 자동 전송하지 않는다. 하루 합계 10회 제한은 월 비용의 절대 상한이 아니다. 실제 결과·한도·원문 보존을 확인한다. [AI 계약과 제한](ai.md).

브라우저 키 보관에는 서버의 `AI_CREDENTIAL_SECRET`(별도 무작위 32자 이상)을 권장한다. 생략하면 이미 백업용으로 설정한 `SUPABASE_SERVICE_ROLE_KEY`에서 별도 암호화 키를 파생하므로 기존 운영 설정으로도 사용할 수 있다. 값은 `NEXT_PUBLIC_` 변수에 넣지 않는다. 암호화 루트 교체·만료·브라우저 데이터 삭제 후에는 키를 재입력한다. 오류가 나면 **브라우저 연결 해제** 후 새 키·모델로 다시 저장한다.

## 완료 기록

키와 토큰을 제외하고 최초 성공 날짜, Drive ZIP 복원 결과, 자동 일정 결과, 선택 모델, 샘플 AI 검토·제안 적용 결과를 [검증 기록](../VERIFICATION.md)에 추가한다. 현재 단계는 코드·모의 계약 검증과 OAuth 앱 프로덕션 준비, 사용자 재승인·Refresh token 보관·Google 변수 저장 완료 보고까지다. 나머지 서버 설정과 실제 백업 검증은 남아 있다.
