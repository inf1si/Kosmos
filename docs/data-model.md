# 데이터 모델과 권한

모델의 기준은 [model.ts](../src/lib/model.ts)와 [001_studio.sql](../supabase/migrations/001_studio.sql)이다. JSON 형식 버전은 현재 **1**이다.

## 작업 공간 JSON

```text
Workspace
├─ id, formatVersion: 1, updatedAt
├─ aiPreferences?: version: 1, activePresetId, presets[], updatedAt
├─ notes[]?: 개인 노트 · 태그 · 수집함/아이스박스 · pinned? · 작품 연결 · aiMessages?
├─ noteNavigation?: version: 1, 노트/폴더 ID·부모·형제 순서
├─ trash?: 노트/문서 사본·시각·원래 위치·AI 기록 (최대 5,000개)
├─ works[]
│  ├─ id, title, subtitle, description, form
│  ├─ documents[]: scene | wiki | memo
│  ├─ navigation?: 대분류·문서/폴더 배치, version: 1
│  ├─ publications[]: 공개 판본의 기기 사본
│  ├─ activePublicationId
│  └─ aiConversations[]: 선택 필드, 문서별 작가·AI 대화
└─ assets[]: 첨부 메타데이터
```

| 객체 | 필드와 의미 |
|---|---|
| `Workspace` | UUID `id`, `formatVersion`, 작품 배열, 첨부 메타데이터, 갱신 시각 |
| `Work` | UUID, 제목·부제·소개, `단편/중편/장편`, 문서 배열, 판본 배열, 활성 판본 ID, 선택적 AI 대화·문서 트리 배열 |
| `NovelDocument` | UUID, `scene/wiki/memo`, 제목, `chapter`, 리치 본문, 요약, 작업 상태, 분류, 시점·시간, 공개 여부·설명, 첨부 ID, 갱신 시각 |
| `Publication` | UUID, 작품 ID·소개·게시 시각, 선택 장면 사본, 공개 설정 설명 사본 |
| `PersonalNote` | UUID, 선택 제목, 리치 본문, tags, box(inbox/icebox), linkedWorkIds, assetIds, 생성·갱신 시각, 선택적 aiMessages |
| `AssetMeta` | UUID, 작품 workId 또는 독립 노트 noteId 중 하나, 파일명, MIME 타입, 바이트 크기 |
| `Revision` | UUID, 기기 namespace, 생성 시각·설명, 작업 공간 전체 사본 |

`chapter`, `pov`, `storyTime`, `category`는 현재 자유 문자열이다. 정규화된 장·인물·시간선 엔티티가 아니다. 메모에는 연구 자료를 기록할 수 있지만 전용 출처 모델은 없다.

문서 상태는 `idea` 구상, `draft` 집필 중, `review` 퇴고 중, `done` 완성이다. `navigation`이 있으면 대분류와 형제 순서를 따르는 전위 순회로 `documents` 배열을 정렬한다(부모 문서가 하위 문서보다 먼저). 이 배열의 장면 순서가 다음 판본의 게시 순서가 된다. 폴더는 원고의 `chapter`와 독립된 정리 객체다. 문서 ID는 이동해도 바뀌지 않는다.

[트리 스키마](../src/lib/document-navigation-schema.ts)는 대분류 ID·이름·새 문서의 기본 종류와, 노드의 ID·종류·대분류 ID·부모 ID를 저장한다. 노드 배열에서 같은 부모의 순서를 읽는다. 문서 노드 ID는 문서 UUID와 같고 폴더는 자체 UUID·제목을 갖는다. 중복 ID·없는 문서/부모·다른 대분류의 부모·순환·24단계를 넘는 깊이를 거절한다. `navigation`이 없는 이전 형식 1 자료는 세 기본 대분류와 연속된 부·장별 폴더로 변환한다. [전환·가져오기 계약](document-navigation.md).

AI 대화는 작품당 최대 200개 문서에 연결하며 같은 문서의 대화 ID는 중복할 수 없다. 한 대화의 최대 메시지 수는 40개다. 작가 메시지에는 질문, AI 메시지에는 답변·수정안·제공자·모델·원고 시점·참고 자료 제목과 ID를 보관한다. 대화를 저장해도 원고의 `updatedAt`을 바꾸지 않는다. 전체 백업에는 포함하고 공개 판본에는 포함하지 않는다. 새 필드는 선택적이므로 이전 형식 1 백업도 계속 읽는다. [AI 제한](ai.md).

## 휴지통 계약

선택적 `Workspace.trash`는 note/document 구분, 원본과 같은 UUID, deletedAt(ISO), 전체 note/document 사본, 원래 parentId·다음 형제 beforeId·직접 childIds를 저장한다. 문서는 workId·workTitle·대분류 사본·별도 aiMessages도 보관한다. [모델](../src/lib/model.ts)과 [변환](../src/lib/workspace-trash.ts)은 활성 자료와 휴지통 ID 중복, 손상 첨부 연결, 하위 자기 참조를 거절한다. 총 5,000개·기존 20MB 서버 JSON 한도를 공유하며 형식 버전은 1이다.

이동은 활성 notes/documents·탐색 노드·해당 작품 AI 대화를 제거하고 직접 하위 항목을 기존 부모로 올린다. 첨부 메타데이터는 휴지통 복원을 위해 유지한다. notes: []는 허용하고 작품 documents는 최소 1개다. 복원은 저장한 부모/형제·대분류를 사용하고 유효한 후속 변경을 보존한다. 영구 삭제는 선택 사본과 현재/남은 휴지통에서 쓰지 않는 첨부 목록만 제거한다. 공개 판본·사본·복구 이력·Blob/Storage 바이트는 유지한다. [사용·호환성](workspace-trash.md).

## 계정의 독립 노트

선택적 Workspace.notes 배열은 최대 5,000개이며 제목은 빈 문자열을 허용하고 본문 첫 줄로 표시한다. 태그 최대 20개/40자, 작품 연결 최대 100개, 첨부 최대 200개다. 중복 ID·태그·연결, 없는 작품, 다른 소속의 첨부를 클라이언트에서 거절한다. 작품에 연결해도 원본은 계정 소속이고 여러 작품이 공유한다. 기존 작품 메모는 그대로 작품 문서다. 계정의 noteNavigation은 version: 1, nodes[]에 노트/폴더 UUID·parentId(null은 최상위)·폴더 title을 저장한다. 노드 순서는 형제 순서이며 7,500노드/24단계, 작품 및 노트·폴더 전체 ID 충돌·유실·순환을 검사한다. 이전 노트는 최근 순으로 최상위에 보충한다. aiMessages는 기존 질문/답변 스키마로 40메시지/노트, 대화 200노트 한도다. 선택 필드 pinned는 노트 홈 고정 여부다. 노트 본문만 작품 문서 노드에 더해 taskList·taskItem(checked: boolean)·noteImage(assetId, alt ≤300자, 같은 노트의 첨부를 가리킴)를 허용하며 작품 문서·공개 판본은 이 노드를 거절한다. 노트를 작품으로 복사하면 글머리표와 `[이미지: 이름]` 문단으로 바꾼다. 전체 ZIP·이력에 포함하고 공개판에서 제외하며 노트 AI는 현재 노트와 선택한 다른 노트/연결 작품 자료만 보낸다. [저장·복원·서버 보호 계약](personal-notes.md).

## 계정의 AI 프리셋

`Workspace.aiPreferences`는 모든 작품에서 공유하는 선택 필드다. version: 1, activePresetId, 사용자 presets[], updatedAt을 저장한다. 프리셋은 UUID id, title 1~80자, prompt 1~4,000자, updatedAt ISO 시각을 갖고 최대 20개다. 중복 ID·없는 활성 ID를 거절한다. 기본 6종은 코드의 builtin:* ID·버전으로 제공하며 편집은 사본으로 저장한다. 필드가 없으면 기본 집필 동료를 사용한다.

전체 ZIP·복구 이력에 포함한다. 이전 백업에 필드가 없으면 현재 라이브러리를 유지하고 있으면 백업의 설정을 복원한다. 문서 MD/HTML/ENEX 교환·공개 판본에는 프리셋을 넣지 않는다. API 키는 작업 공간에 넣지 않는다.

AI 답변의 선택 필드 promptPreset은 당시 ID·제목·revision을 남긴다. 기본 프리셋은 코드 버전, 사용자 프리셋은 갱신 시각이다. 답변마다 프롬프트 원문 사본을 저장하지 않으므로 과거 지침 전체의 재현은 보장하지 않는다.

[003_ai_preferences_guard.sql](../supabase/migrations/003_ai_preferences_guard.sql)은 기존 프리셋 객체가 다음 payload에서 사라지면 UPDATE를 거절한다. 데이터·권한·버전 검사를 유지한다. [프롬프트 계약](ai-prompts.md).

## 원고 본문과 연결

`RichNode`는 `type`, 선택적 `text/attrs/marks/content`를 가진 Tiptap 호환 JSON이다. 문단·제목의 `blockId`는 독서 위치 복원에 사용한다.

| 연결 | 저장 형태 | 쓰임 |
|---|---|---|
| 각주 | 인라인 `footnote` 노드, `noteId`, `text` | 미리보기, 각주 이동과 본문 복귀 |
| 설정 | `wikiLink` mark, `targetId` | 설정 미리보기·설정집·등장 위치 |
| 첨부 | 문서의 `assetIds` + 작업 공간의 `assets` | 파일 메타데이터와 실제 바이트 연결 |

본문은 허용한 노드·mark 목록으로 검사한다. 표는 table → tableRow → tableCell/tableHeader → block 구조다. colspan·rowspan은 정수 1~40, colwidth 배열은 각 너비 1~2,000px와 colspan에 맞는 길이를 검사한다. 새 mark는 superscript·subscript·highlight와 선택한 글자 크기 `fontSize`(`size` 10~72, 0.5 단위)다. 글머리·번호 목록의 선택 속성 `listStyle`은 글머리 disc·circle·square, 번호 decimal·hangul·hangul-consonant·lower-alpha·upper-alpha·lower-roman만 허용하고 null/미지정은 기본 모양이다. 붙여넣은 번호 목록의 Tiptap `type`(a·A·i·I)은 `listStyle`이 없을 때만 표시에 쓴다. 문단·제목의 선택 속성은 lineHeight 1~3, indent 0~8, firstLineIndent 0~4, spaceBefore/spaceAfter 0~48이며 null/미지정은 기존 기본값이다. 유한한 숫자와 허용 CSS 속성만 사용한다. 임의 HTML·플러그인은 지원하지 않는다. [편집 서식 계약](editor-tools.md).

새 노드는 기존 작업 공간 JSON·공개 장면 사본·전체 ZIP 복구 경로를 따른다. 형식 1과 IndexedDB 버전 1을 유지하며 SQL 마이그레이션은 없다. 신규 노드를 읽지 못하는 이전 클라이언트는 가져오기를 거절할 수 있으므로 편집·복원에는 최신 앱이 필요하다. 제목 변경은 ID를 바꾸지 않는다. 연결 ID의 전체 유효성 검사와 공개 전 깨진 링크 안내는 후속 보강 대상이다.

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
| 작품별 대분류 / 문서·폴더 노드 | 40개 / 7,500개 | Zod |
| 문서 트리 깊이 | 24단계 | Zod·이동 검증 |
| 작품별 기기 판본 | 최대 100개 | Zod·게시 시 정리 |
| 첨부 메타데이터 | 최대 2,000개 | Zod |
| 문서별 첨부 | 최대 200개 | Zod |
| 이미지 | PNG/JPEG/WebP, 10MiB | Zod·UI·Storage |
| 서버 작업본 | 20,000,000바이트 | SQL의 JSON 텍스트 크기 |
| ZIP 내용 합계 | 100MiB | 백업 코드 |

이 값들은 거절 기준이며 해당 규모의 성능 보증이 아니다. JSON 저장 한도와 첨부 저장 한도도 별개다. 전체 서버 문서 검증·향후 형식 변환은 [로드맵](roadmap.md)을 따른다.

## 이전 클라이언트의 트리 손실 방지

[002_document_navigation_guard.sql](../supabase/migrations/002_document_navigation_guard.sql)은 기존 작품의 `navigation`이 다음 저장에서 통째로 사라지면 UPDATE를 거절한다. 오래 열린 이전 버전 집필실의 Zod 파싱이 새 필드를 제거하는 경우를 막는다. 기존 권한·RLS·RPC·행 버전 검사를 유지하며 기존 원고를 수정하지 않는다. 서버는 계층 전체의 의미까지 검증하지 않으므로 현재 세부 검증의 기준은 클라이언트 스키마다.

커서 AI 요청의 `noteRange`(선택/문단, 편집기 from/to, 원문)는 임시 API 입력이다. 저장되는 답변은 기존 노트 aiMessages 형식이며 범위 검색으로 다른 반복 문장을 적용하지 않도록 suggestions를 비운다. 본문은 기존 리치 노드로 저장하므로 DB 마이그레이션·백업 버전 변경이 없다. AI 제공자 선택은 계정별 브라우저 설정이고 키·모델과 함께 작업 공간에 넣지 않는다.
