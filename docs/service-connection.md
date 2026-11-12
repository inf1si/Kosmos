# 다음 연결: Google Drive와 AI

## 집필 작업 대화 연결 (2026-11-09)

백그라운드에서 이어지는 **작업 대화**는 Vertex 서버 인증·모델과 새 DB migration이 필요하다. 문서·노트·커서 AI와 같은 Vertex 인증을 사용한다. 브라우저 쿠키에는 모델 ID만 저장하며 웹 조사는 Vertex Gemini를 사용한다. [설정 절차](setup-deployment.md#집필-작업-대화)·[사용 계약](writing-agent.md).

## 서재 다운로드 연결 (2026-11-03)

[다운로드 마이그레이션](../supabase/migrations/20261102154315_library_book_downloads.sql)은 `book_downloads` 테이블과 비공개 Storage 버킷·RLS·명시적 Data API 권한을 함께 추가한다. [등록 객체 삭제 보호](../supabase/migrations/20261102161150_protect_registered_book_files.sql)도 함께 적용한다. 기존 Supabase 공개 연결값과 작가 세션을 재사용하며 service-role 키·추가 환경 변수·외부 파일 서비스를 요구하지 않는다. 익명 다운로드 API는 방문자 세션을 전달하지 않는다. 원고 백업과 등록 파일의 범위는 [책 내보내기](book-export.md#서재-다운로드)를 따른다.

집필실 **Google 로그인**은 Drive 백업과 다른 연결이다. 로그인·기존 Naver 이메일 작가 계정 연결은 [Google 로그인 안내](google-login.md)를 따른다. 이 페이지의 Drive OAuth 클라이언트·refresh token은 로그인 설정으로 복사하거나 변경하지 않는다.

Supabase·Vercel과 작가 로그인은 연결됐다. 외부 문서 기능은 파일만으로 바로 사용한다. Drive 연결 절차는 아래 기록을 참고하고 실제 최신 상태는 [구현 상태](status.md)와 [검증 기록](../VERIFICATION.md)을 따른다. AI는 `orbiter-ai`의 Gemini·Claude로 통일한다. [Vertex 연결 절차](vertex-ai.md)를 따른다. 비밀번호·API 키·refresh token은 채팅에 보내지 않고 백업 비밀은 Vercel Production 변수에 넣는다.

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

## 4. Vertex AI

일반 문서·노트·커서 AI와 작업 대화는 모두 [Vertex AI 연결](vertex-ai.md)을 따른다. 서버 인증을 연결한 뒤 앱의 AI 설정에서 모델을 선택한다. OpenAI·Claude·Gemini 직접 API 키 입력은 지원하지 않는다. 구독 웹사이트의 로그인과 API 과금은 별개다.
