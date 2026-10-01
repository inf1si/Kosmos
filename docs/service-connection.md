# 다음 연결: Google Drive와 AI

Supabase·Vercel과 작가 로그인은 연결됐다. 외부 문서 기능은 파일만으로 바로 사용한다. 다음 작업은 무료 Drive 자동 백업의 OAuth 연결이며 AI는 키를 만든 제공자부터 활성화한다. 비밀번호·API 키·refresh token은 채팅에 보내지 않고 본인이 Vercel의 Production 환경 변수에 직접 넣는다.

## 1. Google 프로젝트와 Drive API

1. 백업에 사용할 Google 계정의 남은 공간을 확인한다.
2. [Google Cloud Console](https://console.cloud.google.com/)에서 개인 프로젝트 `Kosmos Backup`을 만든다. 기존 적절한 프로젝트를 사용해도 된다.
3. API 및 서비스의 라이브러리에서 **Google Drive API**를 찾아 활성화한다. Cloud Storage 버킷·유료 Google One·별도 서버는 이 구성에 필요하지 않다. 결제나 유료 서비스 화면이 나오면 이 백업에 필요한 서비스인지 먼저 확인한다.
4. Google Auth Platform에서 앱 이름·지원 이메일·연락 이메일을 설정한다. 개인 Google 계정은 External을 사용한다. 요청 범위는 `https://www.googleapis.com/auth/drive.file` 하나다.
5. Testing으로 확인할 때 본인 계정을 테스트 사용자로 등록한다. 지속 자동 백업에는 앱 상태를 In production으로 전환한 뒤 토큰을 발급한다. Testing 상태의 이 범위 refresh token은 7일 만료 대상이다. 개인 사용·범위·검증 요구는 콘솔 안내를 따른다. [Google OAuth 만료 규칙](https://developers.google.com/identity/protocols/oauth2).

## 2. 본인 OAuth 클라이언트와 연결 승인

1. OAuth Client를 **Web application**으로 만든다. 이름은 `Kosmos Backup`으로 둔다.
2. Authorized redirect URI에 `https://developers.google.com/oauthplayground`를 정확히 추가한다.
3. [Google 공식 OAuth Playground](https://developers.google.com/oauthplayground/)의 설정에서 **Use your own OAuth credentials**를 체크하고 방금 생성한 Client ID·Client secret을 직접 입력한다. Endpoints는 Google, Access type은 Offline으로 둔다.
4. Step 1의 scope 입력에 `https://www.googleapis.com/auth/drive.file` 하나만 넣는다. Google 로그인과 접근 허용은 계정 소유자가 직접 완료한다. 다른 범위가 함께 요청되면 승인하지 않고 설정을 확인한다.
5. Step 2의 Exchange authorization code for tokens를 실행해 refresh token을 확보한다. 기본 Playground 클라이언트 토큰은 24시간 후 취소되므로 **본인 클라이언트** 사용이 필요하다. 공유 링크에 자격 증명·토큰을 포함하지 않는다. [Playground 공식 안내](https://developers.google.com/oauthplayground/).

이는 현재 서버 설정 방식이다. Kosmos 안의 원클릭 Google 연결 화면은 아직 구현하지 않았다. Codex의 Google Drive 커넥터 연결도 Kosmos의 서버 토큰을 대신하지 않는다.

## 3. Vercel Production 변수

[Vercel 프로젝트](https://vercel.com/)의 Settings → Environment Variables에서 다음을 **Production에만** 추가한다. [전체 변수 목록](setup-deployment.md)을 함께 참고한다.

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

| 제공자 | 키 발급·모델 확인 | Vercel Production 변수 |
|---|---|---|
| OpenAI | [API 플랫폼](https://platform.openai.com/)과 Responses 구조화 출력 지원 모델 | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Claude | [Anthropic Console](https://platform.claude.com/)과 Messages JSON Schema 지원 모델 | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Gemini | [Google AI Studio](https://aistudio.google.com/)와 generateContent JSON Schema 지원 모델 | `GEMINI_API_KEY`, `GEMINI_MODEL` |

현재 키·모델은 없다. 각 키를 만든 뒤 제공자 문서의 정확한 모델 ID를 넣는다. 하나만 연결해도 그 제공자부터 사용할 수 있다. 세 계정의 결제·사용 한도는 서로 별개이며 ChatGPT·Claude 웹 구독이 API 사용료를 대신한다고 가정하지 않는다. 제공자 대시보드의 가능한 예산·알림·사용 제한을 설정하고 짧은 샘플로 먼저 검토한다.

환경 변수 변경 후 재배포하고 오른쪽 **AI** 패널에서 연결된 제공자를 선택한다. 원고와 제한된 설정 자료는 선택한 제공자 한 곳에 전송된다. 실패 시 다른 제공자로 자동 전송하지 않는다. 하루 합계 10회 제한은 월 비용의 절대 상한이 아니다. 실제 결과·한도·원문 보존을 확인한다. [AI 계약과 제한](ai.md).

## 완료 기록

키와 토큰을 제외하고 최초 성공 날짜, Drive ZIP 복원 결과, 자동 일정 결과, 선택 모델, 샘플 AI 검토·제안 적용 결과를 [검증 기록](../VERIFICATION.md)에 추가한다. 현재 단계는 코드·모의 계약 검증 완료이며 계정 연결 대기다.
