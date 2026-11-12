# Vertex AI 연결

문서·노트·커서 AI와 집필 작업 대화의 API는 Google Cloud 프로젝트 **`orbiter-ai`**로 통일한다. Gemini·Claude를 선택하고 웹 조사는 Vertex Gemini를 사용한다. 직접 OpenAI/Anthropic/Gemini Developer API나 AI Gateway로 자동 전환하지 않는다. 웹 구독·CLI 로그인은 사용하지 않는다.

## GCP 설정

프로젝트에 결제 계정을 연결하고 [Cloud Shell](https://console.cloud.google.com/cloudshell/editor?project=orbiter-ai)을 연다. 이 작업 브랜치의 저장소를 Cloud Shell에서 연 뒤 [설정 스크립트](../scripts/setup-vertex-gcp.sh)를 검토해 실행한다. 저장소가 없으면 이 파일을 Cloud Shell에 업로드해 같은 명령으로 실행할 수 있다.

```bash
bash scripts/setup-vertex-gcp.sh
```

스크립트는 API 세 개(Vertex AI·IAM Credentials·STS), `orbiter-vertex` 서비스 계정, `orbiter-vercel` WIF pool과 `kosmos-production` OIDC provider를 만든다. 서비스 계정에는 `roles/aiplatform.user`만 부여하고, WIF 주체에는 그 계정을 사용할 `roles/iam.workloadIdentityUser`를 부여한다. 허용 주체는 `owner:kosmos42:project:kosmos:environment:production` 하나다. Preview나 팀 전체에는 권한을 열지 않는다. 전용 리소스는 재실행하면 같은 설정으로 맞춘다. 다른 프로젝트는 `VERTEX_SETUP_PROJECT`로 명시한다.

이어서 [Model Garden](https://console.cloud.google.com/vertex-ai/model-garden?project=orbiter-ai)에서 사용할 모델의 접근 권한을 확인한다. Claude는 별도 이용 조건/접근 활성화가 필요할 수 있다. 모델별 리전·전역 엔드포인트 지원과 할당량도 확인한다. 예를 들어 공식 문서의 `claude-sonnet-4-6`, `gemini-3.1-pro-preview` 같은 **Vertex 모델 ID**를 사용하되, 현재 프로젝트에서 제공되는 ID를 기준으로 선택한다. 검색용 Gemini에는 Google Search grounding·URL context 지원이 필요하다. API 사용료와 검색 요금은 프로젝트 결제 계정에 청구되며 크레딧 적용 여부는 해당 크레딧 조건에 따른다.

## Vercel Production 설정

스크립트 끝에 출력되는 다섯 값과 사용할 모델 ID를 `kosmos` 프로젝트의 **Production**에 추가하고 재배포한다. 출력은 키가 아닌 리소스 이름이다.

| 변수 | 값 |
|---|---|
| `GOOGLE_VERTEX_PROJECT` | `orbiter-ai` |
| `GOOGLE_VERTEX_LOCATION` | 기본 `global` |
| `VERTEX_AUTH_MODE` | `wif` |
| `GOOGLE_VERTEX_WIF_PROVIDER` | 스크립트가 출력한 `projects/숫자/locations/global/workloadIdentityPools/orbiter-vercel/providers/kosmos-production` |
| `GOOGLE_VERTEX_SERVICE_ACCOUNT` | `orbiter-vertex@orbiter-ai.iam.gserviceaccount.com` |
| `VERTEX_GEMINI_MODEL` | 사용할 Vertex Gemini 모델 ID |
| `VERTEX_CLAUDE_MODEL` | 사용할 Vertex Claude 모델 ID |
| `VERTEX_GEMINI_MODELS`, `VERTEX_CLAUDE_MODELS` | 선택. 쉼표·줄바꿈으로 나눈 기본 모델 목록 |
| `VERTEX_SEARCH_MODEL` | 선택. 없으면 Gemini 기본 모델 |
| `VERTEX_GEMINI_LOCATION`, `VERTEX_CLAUDE_LOCATION` | 선택. 기본 위치와 다른 리전을 쓸 때 |

Vercel의 실행별 OIDC 토큰을 GCP provider의 전용 audience로 교환한다. custom audience 토큰의 issuer는 `https://oidc.vercel.com/kosmos42`이며 프로젝트의 기본 issuer 모드와 무관하다. Google STS와 서비스 계정 impersonation을 거쳐 단기 OAuth 토큰으로 Vertex를 호출한다. 토큰과 서비스 계정 키를 브라우저·Workflow 인자·원고·로그·백업에 넣지 않는다. 서비스 계정 JSON 키를 생성할 필요가 없다. [Vercel 공식 GCP 안내](https://vercel.com/docs/oidc/gcp).

작업 대화는 별도 [Supabase migration](../supabase/migrations/20261109135502_personal_writing_agent.sql)과 기존 서버 서비스 키도 필요하다. [배포 순서](setup-deployment.md#집필-작업-대화)를 따른다. Preview에는 운영 서비스 키를 복사하지 않는다. Preview에서 실제 AI를 시험하려면 별도 테스트 계정·DB·WIF 주체를 구성한다.

## 앱 설정과 로컬 개발

앱의 **AI 설정**은 Gemini·Claude별 모델 목록과 기본 모델 ID를 받는다. 목록은 한 줄에 하나씩 입력하고, 각 대화창의 **모델** 드롭다운으로 바꾼다. 서버의 단일 모델 변수는 기본값으로 유지되며, 복수 `MODELS` 변수는 초기 목록에 합쳐진다. 단일 변수를 생략하면 복수 목록의 첫 모델을 기본값으로 사용한다. 앱에서 저장한 목록이 있으면 그 목록을 우선 사용한다. 저장·초기화는 모델 선택만 바꾸며 인증·권한·결제 계정은 서버 설정으로 관리한다. 상태의 “서버 연결”은 설정이 채워졌음을 뜻하며 IAM·모델 허용 여부를 미리 호출해 검증한 결과는 아니다. 실제 요청이 거절되면 모델·권한·할당량 오류로 표시한다. 이전 API 키 환경 변수와 키 쿠키는 사용하지 않는다. 이전 대화 기록은 그대로 읽고 내보낼 수 있다.

로컬에서는 `.env.example`을 바탕으로 `VERTEX_AUTH_MODE=adc`, 프로젝트·모델을 설정한 후 실행한다.

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project orbiter-ai
pnpm dev
```

이 인증 파일은 기기에만 두고 저장소나 Vercel에 업로드하지 않는다. 모델 목록·기본값 쿠키와 기기의 빠른 모델 선택은 다른 기기로 옮기지 않는다. 모델을 목록에 넣는 것만으로 Model Garden 접근이 활성화되지는 않는다. 웹 조사 모델은 `VERTEX_SEARCH_MODEL` 설정을 계속 사용한다.

## 확인 범위

로컬 합성 테스트는 실제 SDK·OAuth 교환 흐름·Vertex 경로·Workflow와 브라우저 동작을 사용하되 외부 모델 응답은 대체한다. 실제 GCP IAM 리소스 생성·파트너 모델 활성화·유료 응답·요금·운영 재개는 그 검사에 포함되지 않는다. 이 환경에는 GCP 관리 인증이 없어 위 스크립트는 실행하지 않았다. 최신 결과는 [검증 기록](../VERIFICATION.md)을 따른다.
