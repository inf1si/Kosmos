# OpenAI·Claude·Gemini 검토

제공자별 서버 어댑터와 선택 화면을 구현했다. 현재 API 키와 모델이 없어 실제 호출·한국어 SF 검토 품질·지연·사용료는 미검증이다. 연결은 [서비스 연결 안내](service-connection.md)를 따른다.

## 원고 범위와 적용

현재 문서의 문장·호흡 또는 설정·시간·인물의 지식을 검토한다. 서버 저장본의 일반 텍스트 최대 12,000자, 같은 작품의 연결 설정 또는 제목이 시점 인물과 같은 문서 최대 8개 × 1,800자를 사용한다. 전체 장편·모든 설정·외부 과학 자료를 조회하지 않는다. API의 문서 종류는 scene으로 제한하지 않는다.

UI는 기기 저장·클라우드 동기화를 시도하고 서버가 작가 권한·작업 공간 소유권·문서 updatedAt을 확인한다. 검토 의견과 최대 5개의 수정 제안을 구조화 출력으로 받는다. 작가가 제안을 선택하면 적용 전 복구 지점을 만든다. 검토 후 원고가 바뀌면 적용을 막는다.

자동 적용은 인용이 단일 텍스트 노드에서 정확히 한 번 나타날 때만 가능하다. 각주·설정 mark를 보존한다. 한 제안을 적용한 뒤 다른 제안은 다시 검토해야 한다. AI 실패는 원고 저장을 멈추지 않는다.

## 제공자와 서버 설정

| 선택 | 서버 변수 | 공식 요청 형식 |
|---|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Responses, `text.format` JSON Schema, `store: false` |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Messages, `output_config.format` JSON Schema |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | generateContent, `responseMimeType` JSON, `responseJsonSchema` |

키와 모델을 함께 설정한 제공자만 선택·실행 가능하다. 고정 공식 URL을 사용하며 키는 서버 헤더로만 전송한다. 이전 OpenAI `AI_API_KEY`·`AI_MODEL` 별칭은 지원하지만 임의 `AI_API_URL`은 사용하지 않는다. 제공자를 자동 전환하거나 재시도해 원고를 추가 전송하지 않는다. 각 모델은 해당 구조화 출력 형식을 지원해야 한다.

세 제공자는 공유된 한국어 SF 지침과 출력 구조를 사용한다. 완료 상태·거부·중단을 검사하고 최종 결과도 로컬 Zod로 검증한다. Gemini의 thought 부분은 결과에서 제외한다. 타임아웃 45초, 출력 토큰 설정 2,200, 응답 바이트 한도 256KiB, 함수 maxDuration 60초다. 호출은 작가별 DB current_date 기준 **세 제공자 합계 하루 10회**이며 예약 후 제공자 실패도 포함한다. 키 미설정은 예약 전에 거절한다.

`store: false`는 OpenAI 요청 옵션이다. 제공자의 전체 보관·학습 정책을 보장하지 않는다. 실제 원고 사용 전 선택 제공자의 최신 정책과 예산을 확인한다. 비용 대시보드·월 예산 강제 상한은 앱에 없다.

## API

GET `/api/ai/providers`: 허용 작가의 Bearer 인증 필요. 제공자 ID·표시명·configured·모델만 반환하며 키는 반환하지 않는다. no-store다.

POST `/api/review`: 같은 인증, JSON 본문. Content-Length가 없어도 스트림 전체를 10,000바이트로 제한한다.

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

외부 제공자 계약은 모의 HTTP 응답으로 테스트했다. 실제 키로 성공·거부·한도·비용을 시험한 결과가 아니다. 선택 문단 검토·작품 전체 검색·결과 영구 보관·스트리밍·장편 작업 큐는 후속 기능이다.

구현: [어댑터](../src/lib/ai-provider.ts), [검토 라우트](../src/app/api/review/route.ts), [화면](../src/components/ai-review.tsx), [적용 로직](../src/lib/ai.ts). 공식 계약: [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini](https://ai.google.dev/api/generate-content).
