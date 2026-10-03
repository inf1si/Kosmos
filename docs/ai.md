# OpenAI·Claude·Gemini 대화

제공자별 서버 어댑터와 문서별 대화 화면을 구현했다. 현재 API 키와 모델이 없어 실제 호출·한국어 SF 답변 품질·지연·사용료는 미검증이다. 연결은 [서비스 연결 안내](service-connection.md)를 따른다.

## 원고 범위와 적용

질문을 직접 쓰거나 문장 퇴고·설정 점검·장면 구상·장면 요약·SF 개연성·자료 질문으로 시작한다. 질문은 2,000자까지다. 보낼 자료에서 현재 문서 포함 여부를 정하고, 같은 작품의 원고·설정·메모 최대 8개를 고른다. 처음에는 본문의 연결 설정과 시점 인물 문서를 선택해 둔다. 서버 저장본 원고 최대 12,000자, 참고 문서마다 앞 1,800자를 사용한다. 다른 작품의 ID는 거절한다. 전체 장편·모든 설정·외부 과학 자료를 자동 조회하지 않는다. SF 개연성은 확인할 가정을 정리하는 기능이며 외부 과학 검증이나 인터넷 검색은 수행하지 않는다.

UI는 기기 저장·클라우드 동기화를 시도하고 서버가 작가 권한·작업 공간 소유권·문서 updatedAt을 확인한다. 답변과 최대 5개의 수정 제안을 구조화 출력으로 받는다. 원고를 제외한 요청의 수정 제안은 서버에서 비운다. 작가가 제안을 선택하면 적용 전 복구 지점을 만든다. 답변 후 원고가 바뀌면 적용을 막는다.

선택 적용은 인용이 단일 텍스트 노드에서 정확히 한 번 나타날 때만 가능하다. 각주·설정 mark를 보존한다. 한 제안을 적용한 뒤 다른 제안은 새로 질문하거나 직접 비교해야 한다. AI 실패는 원고 저장을 멈추지 않는다. 전송 실패 시 질문을 유지한다. 답변을 기다리다 다른 문서를 열어도 결과는 원래 문서에 저장한다.

## 대화 기록과 보관

작품의 선택 필드 `aiConversations`에 문서 ID와 대화 배열을 저장한다. 한 문서에 최대 20회(40개 메시지), 작품당 최대 200개 문서 대화를 허용한다. 한도를 넘으면 새 요청을 막고 기록을 조용히 삭제하지 않는다. 다음 질문에는 최근 완전한 대화 5회(10개 메시지) 중 총 24,000자 안에 드는 내용을 보낸다. 긴 예전 기록은 저장본에 남지만 다음 요청에서는 빠질 수 있다.

질문과 성공 답변을 한 번에 저장한다. 질문·답변·수정안·제공자·모델·답변 당시 원고 시점·자료 제목/ID가 기기 저장, 클라우드 작업 데이터, 전체 ZIP, Drive 전체 ZIP, 암호화 DB 백업에 포함된다. 공개 판본에는 복사하지 않는다. 별도 DB 테이블이나 마이그레이션은 없다. 기록은 서버의 작가 작업 공간 권한으로 보호한다.

**대화를 메모로 보관**은 질문·답변·수정안을 일반 메모로 복사한다. 메모는 기존 Markdown·HTML·ENEX 내보내기를 사용한다. **새 대화**는 확인 화면을 거쳐 현재 문서의 기록을 비우고 먼저 복구 지점을 만든다. 최근 기기 복구 지점은 기존 50개 보관 정책을 따른다.

## 집필실에서 연결·시스템 프롬프트 설정

**AI 대화 → AI 설정**에서 제공자, 정확한 모델 ID, API 키를 넣고 **연결 저장**을 누른다. 키를 저장할 때는 AI를 호출하지 않는다. 연결·모델의 유효성과 실제 비용은 첫 샘플 대화에서 확인한다. 이미 이 브라우저에 연결했다면 키 칸을 비워 모델만 변경할 수 있다. **브라우저 연결 해제**는 해당 제공자의 브라우저 설정을 지우며, 서버 기본 설정이 있으면 다시 사용한다. 제공자 세 곳의 연결을 각각 보관한다.

키·모델은 작가 인증 후 서버에서 AES-256-GCM으로 암호화해 **이 브라우저·이 도메인에 최대 30일** 보관한다. 운영 쿠키는 `__Host-` 접두어, HttpOnly·Secure·SameSite=Strict·Path=/를 사용한다. 작가 ID와 제공자를 암호화 인증 데이터에 묶어 다른 계정이나 제공자가 같은 값을 사용할 수 없게 한다. 키 값·암호문은 상태 API로 반환하지 않는다. 키는 작업 공간, 대화 기록, localStorage, IndexedDB, ZIP·Drive·DB 백업에 넣지 않는다. 다른 기기·도메인, 쿠키 삭제, 만료 또는 서버 암호화 비밀 교체 후에는 재입력한다. 만료·변조된 연결은 실행을 막으며 서버 키로 조용히 전환하지 않는다.

서버 암호화 루트는 32자 이상의 `AI_CREDENTIAL_SECRET`을 우선 사용하고, 없으면 기존 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`에서 HKDF-SHA256으로 목적을 구분한 키를 파생한다. 명시한 전용 비밀이 짧으면 저장을 거절한다. 두 비밀은 공개 환경 변수로 설정하지 않는다. 이 기능에 DB 마이그레이션이나 제공자별 서버 환경 변수는 필수가 아니다. 운영 쿠키에는 비밀값이 암호화되어 있으므로 개발 서버에서는 합성 키만 사용한다.

**시스템 프롬프트**는 답변 방식·문체·집필 방향을 4,000자까지 수정한 뒤 **프롬프트 저장**으로 적용한다. 세 제공자의 다음 질문부터 적용하며 이미 받은 답변은 바꾸지 않는다. 빈 값은 기본 한국어 SF 집필 지침으로 처리한다. **기본값 불러오기**는 입력칸만 바꾸므로 적용하려면 다시 저장한다. 브라우저별 localStorage에 보관하며 원고·대화·백업에는 포함하지 않는다. 저장 공간이 막히면 현재 탭에만 적용하고 안내를 표시한다. 질문을 보낼 때 선택한 제공자에게 이 프롬프트도 전송한다.

사용자가 수정하는 집필 지침과 별도로 자료 범위, JSON 응답 형식, 정확한 원문 인용, 자동 적용 금지 같은 서버 규칙을 유지한다. 참고 문서와 과거 대화에 들어 있는 지시를 새로운 시스템 지침으로 취급하지 않는다.

## 선택적인 서버 기본 설정

| 선택 | 서버 변수 | 공식 요청 형식 |
|---|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Responses, `text.format` JSON Schema, `store: false` |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Messages, `output_config.format` JSON Schema |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | generateContent, `responseMimeType` JSON, `responseJsonSchema` |

Vercel의 키와 모델은 선택적인 기본값이다. 브라우저에 연결한 값이 우선하고, 브라우저 연결이 없을 때 서버 기본값을 사용한다. 연결된 제공자만 실행 가능하다. 고정 공식 URL을 사용하며 키는 서버가 제공자 헤더로만 전송한다. 이전 OpenAI `AI_API_KEY`·`AI_MODEL` 별칭은 지원하지만 임의 `AI_API_URL`은 사용하지 않는다. 제공자를 자동 전환하거나 재시도해 원고를 추가 전송하지 않는다. 각 모델은 해당 구조화 출력 형식을 지원해야 한다.

세 제공자는 공유된 한국어 SF 지침과 출력 구조를 사용한다. 완료 상태·거부·중단을 검사하고 최종 결과도 로컬 Zod로 검증한다. Gemini의 thought 부분은 결과에서 제외한다. 타임아웃 45초, 출력 토큰 설정 2,200, 응답 바이트 한도 256KiB, 함수 maxDuration 60초다. 호출은 작가별 DB current_date 기준 **세 제공자 합계 하루 10회**이며 예약 후 제공자 실패도 포함한다. 키 미설정은 예약 전에 거절한다.

`store: false`는 OpenAI 요청 옵션이다. 제공자의 전체 보관·학습 정책을 보장하지 않는다. 실제 원고 사용 전 선택 제공자의 최신 정책과 예산을 확인한다. 비용 대시보드·월 예산 강제 상한은 앱에 없다.

## API

POST `/api/ai/chat`: 작가 Bearer 인증 필요, JSON 본문은 스트림 기준 128KiB까지.

```json
{
  "workId":"작품 UUID","docId":"문서 UUID","version":"문서 updatedAt",
  "provider":"openai","message":"질문","includeManuscript":true,
  "sourceIds":["같은 작품 자료 UUID"],
  "systemPrompt":"선택적인 집필 지침 · 최대 4,000자",
  "history":[{"role":"user","content":"지난 질문"},{"role":"assistant","content":"지난 답변"}]
}
```

history는 user/assistant 순서의 완전한 쌍만 허용하며 system 역할을 받지 않는다. 서버에서 현재 원고·자료를 다시 읽고 권한·시점·길이를 검사한 뒤 하루 호출을 예약한다. 성공 결과는 result(답변을 담은 review 문자열과 suggestions), provider, model, version, sources, dailyCalls다. 응답은 no-store다.

GET `/api/ai/providers`: 허용 작가의 Bearer 인증 필요. 제공자 ID·표시명·configured·모델·source(browser/server/null)·browserStored·browserInvalid와 서버의 storageAvailable을 반환한다. 키와 암호문은 반환하지 않으며 no-store다.

POST `/api/ai/settings`: 같은 Origin과 허용 작가의 Bearer 인증, application/json 필요. 본문은 `{"provider":"openai","model":"정확한 모델 ID","key":"본인이 직접 입력한 키"}`이고 스트림 기준 8KiB까지다. 최초 연결은 키가 필요하며, 유효한 브라우저 연결이 있으면 key를 생략해 모델만 고친다. 성공 본문은 `{"saved":true}`이고 암호화 쿠키를 설정한다.

DELETE `/api/ai/settings`: 같은 인증·Origin·JSON 조건에서 `{"provider":"openai"}`로 해당 쿠키를 해제한다. 두 변경 응답도 no-store며 키를 반환하지 않는다. 형식 오류 400, 인증 없음 401, 다른 Origin 403, 크기 초과 413, JSON 형식 아님 415, 암호화 설정 없음 503을 구분한다.

이전 POST `/api/review`도 호환을 위해 유지한다. 같은 인증, JSON 본문이며 Content-Length가 없어도 스트림 전체를 10,000바이트로 제한한다.

```json
{"workId":"작품 UUID","docId":"문서 UUID","version":"문서 updatedAt","goal":"style","provider":"openai"}
```

goal은 style 또는 continuity, provider는 openai / anthropic / gemini이며 생략 시 openai다. 성공 결과는 result(검토 의견·quote/replacement/reason 제안), provider, model, version, sources, dailyCalls다.

| 응답 | 의미 |
|---|---|
| 400 | 요청 형식 오류 |
| 401 | 유효한 작가 로그인 없음 |
| 403·404 | 권한·작품·문서 조회 실패 |
| 409 | 요청한 문서 시점과 서버 저장본 불일치 |
| 413 | 요청 바이트 또는 원고 길이 초과 |
| 429 | 하루 호출 한도·예약 실패 |
| 502 | 제공자 오류·시간 초과·거부·불완전하거나 잘못된 결과 |
| 503 | 선택 제공자의 키·모델 미설정 |

외부 제공자 계약은 모의 HTTP 응답으로 테스트했다. 대화 백업 왕복·공개 판본 제외·다른 작품 자료 차단·시점/길이/역할 경계와 키 암호화·계정/제공자 구분·만료·변조·Origin·쿠키 속성·비밀값 미반환·세 제공자의 사용자 프롬프트를 테스트했다. 실제 키로 성공·거부·한도·비용을 시험한 결과가 아니다. 선택 문단 전송·작품 전체 자동 검색·스트리밍·장편 작업 큐는 후속 기능이다.

구현: [어댑터](../src/lib/ai-provider.ts), [대화 라우트](../src/app/api/ai/chat/route.ts), [화면](../src/components/ai-chat.tsx), [기록](../src/lib/ai-conversation.ts), [자료 경계](../src/lib/ai-chat-context.ts), [적용 로직](../src/lib/ai.ts). 공식 계약: [OpenAI 대화 상태](https://developers.openai.com/api/docs/guides/conversation-state)·[구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude](https://platform.claude.com/docs/en/api/messages/create), [Gemini](https://ai.google.dev/api/generate-content).
