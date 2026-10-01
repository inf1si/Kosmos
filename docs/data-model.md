# 데이터 모델과 권한

모델의 기준은 [model.ts](../src/lib/model.ts)와 [001_studio.sql](../supabase/migrations/001_studio.sql)이다. JSON 형식 버전은 현재 **1**이다.

## 작업 공간 JSON

```text
Workspace
├─ id, formatVersion: 1, updatedAt
├─ works[]
│  ├─ id, title, subtitle, description, form
│  ├─ documents[]: scene | wiki | memo
│  ├─ publications[]: 공개 판본의 기기 사본
│  └─ activePublicationId
└─ assets[]: 첨부 메타데이터
```

| 객체 | 필드와 의미 |
|---|---|
| `Workspace` | UUID `id`, `formatVersion`, 작품 배열, 첨부 메타데이터, 갱신 시각 |
| `Work` | UUID, 제목·부제·소개, `단편/중편/장편`, 문서 배열, 판본 배열, 활성 판본 ID |
| `NovelDocument` | UUID, `scene/wiki/memo`, 제목, `chapter`, 리치 본문, 요약, 작업 상태, 분류, 시점·시간, 공개 여부·설명, 첨부 ID, 갱신 시각 |
| `Publication` | UUID, 작품 ID·소개·게시 시각, 선택 장면 사본, 공개 설정 설명 사본 |
| `AssetMeta` | UUID, 작품 ID, 파일명, MIME 타입, 바이트 크기 |
| `Revision` | UUID, 기기 namespace, 생성 시각·설명, 작업 공간 전체 사본 |

`chapter`, `pov`, `storyTime`, `category`는 현재 자유 문자열이다. 정규화된 장·인물·시간선 엔티티가 아니다. 메모에는 연구 자료를 기록할 수 있지만 전용 출처 모델은 없다.

문서 상태는 `idea` 구상, `draft` 집필 중, `review` 퇴고 중, `done` 완성이다. 배열 순서가 탐색과 게시 장면 순서를 결정한다.

## 원고 본문과 연결

`RichNode`는 `type`, 선택적 `text/attrs/marks/content`를 가진 Tiptap 호환 JSON이다. 문단·제목의 `blockId`는 독서 위치 복원에 사용한다.

| 연결 | 저장 형태 | 쓰임 |
|---|---|---|
| 각주 | 인라인 `footnote` 노드, `noteId`, `text` | 미리보기, 각주 이동과 본문 복귀 |
| 설정 | `wikiLink` mark, `targetId` | 설정 미리보기·설정집·등장 위치 |
| 첨부 | 문서의 `assetIds` + 작업 공간의 `assets` | 파일 메타데이터와 실제 바이트 연결 |

본문은 허용한 노드·mark 목록으로 검사한다. 표, 임의 HTML, 임의 플러그인 문서는 현재 지원하지 않는다. 제목 변경은 ID를 바꾸지 않는다. 연결 ID의 전체 유효성 검사와 공개 전 깨진 링크 안내는 후속 보강 대상이다.

## 기기 저장

Dexie 데이터베이스 이름은 `orbit-novel-studio-v1`, 스키마 버전은 1이다.

| IndexedDB 저장소 | 키·인덱스 | 내용 |
|---|---|---|
| `workspaces` | `namespace` | 작업본, 로컬·클라우드 버전, dirty, 미확인 전송, 최근 내보내기 시각 |
| `revisions` | `id`, `namespace`, `createdAt` | 기기 복구 지점의 전체 JSON |
| `assets` | `[namespace+id]`, `namespace`, `id` | 실제 첨부 Blob |

namespace는 기기 미리보기 `preview`, 로그인 작업본 `author:<UUID>`다. 브라우저 origin별 저장이므로 포트·도메인·브라우저가 바뀌면 같은 저장소로 간주되지 않는다.

`LocalRecord.localVersion`은 같은 기기의 창 간 충돌 검사에 사용한다. `cloudVersion`은 마지막으로 확인한 서버 버전이다. `dirty`는 서버 미확인 수정 여부다. `pendingRequest`에는 요청 ID, 당시 로컬 버전, 기준 서버 버전, **당시 전송할 원고 전체**를 함께 보관한다.

## Supabase 테이블

| 테이블 | 핵심 내용 | 클라이언트 접근 |
|---|---|---|
| `authors` | 허용한 Auth 사용자 UUID | 로그인한 본인의 허용 여부만 조회 |
| `workspaces` | 서버 행 UUID, owner UUID, version, payload, updated_at | 본인의 행 조회. 변경은 RPC |
| `workspace_requests` | 작업 공간+요청 ID, payload 해시, 반영 버전·시각 | 직접 접근 불가. RPC의 재전송 확인용 |
| `workspace_revisions` | 작업 공간·owner, 이전 payload, 생성 시각 | 본인의 이력 조회 가능. 현재 UI에는 연결하지 않음 |
| `publications` | 판본 ID, owner·work ID, active, 공개 payload·시각 | 익명·로그인 사용자 모두 활성 판본의 허용 열만 조회 |
| `ai_usage` | owner+DB 날짜, 예약 호출 횟수 | 직접 접근 불가. 호출 예약 RPC 사용 |

서버 `workspaces.id`와 payload 내부 `Workspace.id`는 별개다. 서버 행 ID는 저장 RPC용이며, payload ID는 ZIP 형식과 작업 공간 식별용이다. 작가당 서버 작업 공간 행은 하나다.

## RPC 계약

| 함수 | 입력 | 결과·동작 |
|---|---|---|
| `initialize_workspace` | `p_payload` | 허용 작가의 행을 처음 생성하거나 기존 행 반환: `id/version/payload` |
| `save_workspace` | `p_id`, `p_base_version`, `p_payload`, `p_request_id` | `saved`와 새 버전, 또는 `conflict`와 현재 버전·payload |
| `publish_work` | `p_id`, `p_work_id`, `p_scene_ids` | 서버 작업본에서 공개 판본 생성·활성 전환, 판본 JSON 반환 |
| `reserve_ai_call` | 없음 | 해당 작가의 DB 날짜별 호출 수 증가. 최대 10회 |

함수는 `SECURITY DEFINER`와 고정 `search_path`를 사용하고 `auth.uid()`를 확인한다. 기본 테이블의 쓰기 권한은 클라이언트에 주지 않는다. 권한 취소와 재부여는 Supabase의 기본 권한에 의존하지 않도록 SQL에 명시한다.

서버 저장은 행 잠금과 기준 버전 검사로 처리한다. 요청 기록은 저장 시 7일 이전 것을 정리한다. 서버 복구 이력은 저장 시 약 10분 간격으로 **변경 전 작업본**을 남기고 최근 50개로 정리한다. 독립적인 10분 주기 백업 작업은 아니다.

## 공개 데이터 경계

공개 판본에 포함하는 값은 작품 제목·부제·소개, 선택 장면의 ID·제목·부/장·본문, 공개 설정의 ID·제목·분류·`publicSummary`다. 설정 본문, 메모, 작업 상태, 첨부 바이트와 AI 결과는 복사하지 않는다.

설정이 `isPublic=true`이고 독자용 설명이 비어 있지 않을 때만 공개 설정에 넣는다. 비공개 자료를 접기 UI로 숨기는 방식이 아니다. 익명은 과거 비활성 판본을 조회할 수 없다. 서버 공개 테이블이 실제 공개의 기준이며 작업 공간 JSON의 기기 판본 사본과 구분한다.

현재 공개 첨부·표지 게시 흐름은 없다. `private-assets` 버킷은 비공개이며 `<작가 UUID>/<첨부 UUID>` 경로에 읽기·추가만 허용한다. 덮어쓰기·삭제 정책은 없다.

## 형식과 용량 제한

| 제한 | 값 | 근거 |
|---|---:|---|
| 작품 | 최대 100개 | Zod |
| 작품별 문서 | 1~5,000개 | Zod |
| 작품별 기기 판본 | 최대 100개 | Zod·게시 시 정리 |
| 첨부 메타데이터 | 최대 2,000개 | Zod |
| 문서별 첨부 | 최대 200개 | Zod |
| 이미지 | PNG/JPEG/WebP, 10MiB | Zod·UI·Storage |
| 서버 작업본 | 20,000,000바이트 | SQL의 JSON 텍스트 크기 |
| ZIP 내용 합계 | 100MiB | 백업 코드 |

이 값들은 거절 기준이며 해당 규모의 성능 보증이 아니다. JSON 저장 한도와 첨부 저장 한도도 별개다. 전체 서버 문서 검증·향후 형식 변환은 [로드맵](roadmap.md)을 따른다.
