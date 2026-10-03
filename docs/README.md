# Orbis Tertius 프로젝트 문서

문서 기준일: **2026-10-03** · 앱 버전: **0.2.1** · 단계: **Vercel 첫 배포와 기본 클라우드 검증 완료**

SF 중단편·장편을 쓰는 개인 작가를 위한 집필실, 공개 독서 화면, 작품별 설정집 프로젝트다. 사이트 이름은 Orbis Tertius이며 샘플 작품명은 임시 이름이다. 계정 연결과 배포 전에 제품 의도, 실제 코드, 운영 절차를 한곳에 기록했다.

## 먼저 읽을 문서

| 목적 | 문서 |
|---|---|
| 현재 무엇이 되는지 확인 | [구현 상태](status.md) |
| 직접 원고를 쓰고 게시·복원하기 | [사용 안내](user-guide.md) |
| 문서·폴더·사용자 대분류 정리 | [문서 트리](document-navigation.md) |
| 제품의 목적과 SF 집필 방향 이해 | [제품 요구사항](product.md) · [상세 목표 설계](product-spec.md) |
| UI 참고 자료와 선택한 방향 확인 | [디자인 레퍼런스](design-references.md) |
| 새 화면·기능을 기존 디자인에 맞추기 | [디자인 가이드](design-guide.md) |
| 다른 개발자가 프로젝트 인수 | [현재 아키텍처](architecture.md) → [데이터 모델](data-model.md) → [동기화](synchronization.md) |
| 계정 연결과 실제 배포 | [환경 설정·배포](setup-deployment.md) |
| 기존 Kosmos main을 새 프로젝트로 교체 | [저장소 교체 절차](repository-transition.md) |
| 백업과 복원 범위 확인 | [백업·복구](backup-restore.md) |
| 장애에 대응하고 운영하기 | [운영 안내](operations.md) |
| Notion·Evernote 파일 교환 | [가져오기·내보내기](import-export.md) |
| Google Drive 무료 공간 자동 백업 | [백업 구조](offsite-backup.md) · [연결 순서](service-connection.md) |
| DB·첨부 암호화 백업·누락 감시·실제 복원 | [재해 복구 절차](disaster-recovery.md) |
| AI 연결·제한·API 이해 | [AI 기능](ai.md) |
| 다음 개발 순서 결정 | [로드맵](roadmap.md) · [설계 결정 기록](decisions.md) |
| 어떤 검증이 실제로 끝났는지 확인 | [검증 기록](../VERIFICATION.md) |
| 초기 기술 제안과 운영비 근거 확인 | [기술 제안 원문](technical-proposal.md) |

## 현재 상태 한눈에 보기

[문서 트리 사용법](document-navigation.md): 문서·폴더 하위 계층, 이동 손잡이·이동 폼, 사용자 대분류, 백업·교환 계약.

[문서 그래프 사용법](document-graph.md): 작품별 관계 지도, 본문 링크·시점 인물의 기준, 필터·키보드·표시 한도.

- **구현·로컬 검증 완료:** 원고 편집, 작품별 문서, 탭·2분할, 기기 저장, 복구 이력, ZIP 백업·복원, 공개 판본, 각주·설정 연결, 독서 화면.
- **실제 Supabase 초기 설정 완료:** 테이블 6개와 RLS, RPC 4개, 비공개 첨부 버킷, Realtime 대상 테이블, 공개 회원가입 차단, 익명 REST 접근 검사 7개.
- **운영 기본 검증 완료:** Vercel 배포, 작가 로그인·원고 저장·새로고침·서버 변경 반영, 첨부 업로드, 샘플 게시·각주·공개 설정·비공개 정보 제외.
- **추가 검증 필요:** 다른 기기 첨부 다운로드, 오프라인 기기 간 충돌, 실제 ZIP 파일의 내려받기·복원, AI 호출.
- **이번 추가:** 외부 문서 교환, AI 3종 어댑터, Drive/S3 자동 백업 코드·일정. AI 키·Drive OAuth는 미연결.
- **미구현:** 문서별 서버 저장·자동 병합, 완전한 오프라인 앱, 장편 전체 AI 검토, DOCX/EPUB.
- **계정·서비스:** Supabase 서울 프로젝트에 최초 SQL을 적용했다. 작가 계정 1명과 Vercel GitHub 연결·운영 배포를 완료했다. 기본 주소는 [kosmos-ashy.vercel.app](https://kosmos-ashy.vercel.app)이며 AI 키·모델과 사용자 도메인은 미연결이다.

현재 기기 저장을 클라우드 동기화 완료로 해석하면 안 된다. SQL 테스트 통과는 Supabase 실서비스 연결 완료를 뜻하지 않는다. 자세한 경계는 [구현 상태](status.md)에 기록했다.

## 문서의 기준과 유지 규칙

1. **코드와 검증 기록**이 현재 동작의 근거다. 현재 상태를 설명하는 문서는 `status.md`, `architecture.md`, 각 운영 안내다.
2. `product-spec.md`, `technical-proposal.md`는 **목표 설계**다. 현재 구현과 다른 항목이 있을 수 있으며 상태 문서에서 차이를 확인한다.
3. 계정 연결·배포·복원·AI 검증을 수행한 뒤에는 결과와 날짜를 남긴다. 수행하지 않은 검증을 완료로 표시하지 않는다.
4. 기능을 변경하면 해당 안내, 상태 표, 검증 기록, [변경 기록](../CHANGELOG.md)을 함께 갱신한다.
5. 비밀번호, 실제 원고, 계정 토큰과 비밀 키는 문서·소스 ZIP에 넣지 않는다. 예제에는 자리표시자만 사용한다.
6. 의존성의 정확한 버전은 `pnpm-lock.yaml`을 기준으로 한다. 서비스 가격·플랜·대시보드 메뉴는 연결 시 공식 문서를 다시 확인한다.

## 인수인계 시작점

프로젝트 루트에서 `pnpm install --frozen-lockfile`, `pnpm dev`를 실행한다. 필요한 Node.js 버전, 환경 변수, 운영 배포의 닫힌 집필실 정책은 [환경 설정·배포](setup-deployment.md)를 따른다. 신규 개발자는 프로젝트의 [AGENTS.md](../AGENTS.md)도 먼저 읽는다.

공개 사이트의 기본 방향은 **문학 서재**이며, 색·글꼴·테마·문구 규칙은 [디자인 가이드](design-guide.md)를 따른다. 집필실은 사이드바와 편집 패널 구조이며 Muvel·Novela·Pensiv의 문서 탐색·분할·참조 패턴을 참고한다. 참고 서비스의 모든 기능을 구현했다는 뜻은 아니다.
