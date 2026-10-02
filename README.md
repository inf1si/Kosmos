# Orbis Tertius — 개인 소설 집필·공개·설정집

Next.js + Tiptap + Supabase 기반 개인 SF 소설 사이트입니다. 사이트 이름은 Orbis Tertius이며 소개 문구는 사용하지 않습니다.

**[전체 프로젝트 문서](docs/README.md)**에서 요구사항, 디자인 연구, 실제 구현, 개발 인수인계, 배포와 운영 절차를 확인할 수 있습니다.

## 현재 상태

원고 편집·공개·설정집과 Notion·Evernote 파일 교환을 구현했습니다. 실제 작가 로그인·저장·첨부·샘플 게시와 Google Drive 백업 업로드·재다운로드 검증을 확인했습니다. 0.2.1에는 백업 파일 내려받기·별도 기기 복원 시험·실행 누락 감시 연결·암호화 DB와 첨부의 R2 백업 workflow를 추가했습니다. 운영 배포와 Drive ZIP의 서버 다운로드·임시 IndexedDB 복원 시험을 확인했습니다. R2 비공개 버킷·30일 삭제 및 덮어쓰기 잠금, GitHub 백업 설정과 외부 감시 항목·연결 변수 등록을 확인했습니다. 첫 DB 백업은 실패했고 감시 서비스의 실패 신호와 실제 이메일 수신을 확인했습니다. 실제 R2 저장 성공·DB 복원과 개인키의 별도 보관은 남아 있습니다. 완료된 백업 파일은 자동 삭제하지 않으며, 버킷 9GB 상한에 닿으면 새 업로드를 중단하고 기존 파일을 보존합니다. AI 키·모델은 미연결입니다.

기기 미리보기의 원고는 현재 브라우저에 저장됩니다. 로컬 미리보기의 원고가 운영 사이트로 자동 이동하지는 않습니다. 운영 집필실은 별도 작가 계정으로 Supabase에 연결됩니다. 목표 기능과 실제 동작의 차이는 [구현 상태](docs/status.md)에 기록했습니다.

운영 주소: [집필실](https://kosmos-ashy.vercel.app/studio) · [공개 서재](https://kosmos-ashy.vercel.app/library). 시험 공개판은 비활성화했고 현재 공개 작품은 없습니다.

홈페이지는 Orbis Tertius 이름과 서재·집필실 링크만 표시합니다. `/privacy`는 실제 저장·Drive 백업·선택적 AI 데이터 처리를 안내합니다. 기존 source `41114a1`의 배포 확인과 이번 변경의 운영 배포 확인은 구분합니다.

Google OAuth Production·drive.file·기존 키 비활성화를 확인했고 사용자가 refresh token과 서버 환경 변수를 입력했습니다. 운영 집필실에서 2026-10-02의 Drive 백업과 저장 후 무결성 확인 기록을 확인했습니다. 값 자체를 문서나 채팅에 기록하지 않습니다. [백업 보강·연결·복원 절차](docs/disaster-recovery.md).

## 빠른 실행

프로젝트 폴더에서 Node.js 22 또는 24와 pnpm 11.19.0을 사용합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

[로컬 집필실](http://127.0.0.1:3210/studio)을 엽니다. Windows에서는 [start-studio.ps1](start-studio.ps1)도 사용할 수 있습니다. 소스 ZIP에는 의존성·빌드 결과·비밀 키를 포함하지 않습니다.

## 목적별 문서

- [작가 사용 안내](docs/user-guide.md): 작품·문서·분할·각주·설정·게시.
- [디자인 가이드](docs/design-guide.md): 색 토큰·라이트/다크 테마·글꼴·문구 규칙과 집필실 목표 시안.
- [백업·복구](docs/backup-restore.md): 실제 첨부 포함 ZIP, 복구 이력, 원고 이동.
- [외부 문서 교환](docs/import-export.md): Notion ZIP·ENEX·MD·HTML 등.
- [DB·첨부 암호화 백업과 복원 훈련](docs/disaster-recovery.md).
- [Drive 자동 백업](docs/offsite-backup.md) · [Google·AI 연결 순서](docs/service-connection.md).
- [환경 설정·배포](docs/setup-deployment.md): Supabase 프로젝트·작가 권한·환경 변수·Vercel.
- [Kosmos main 교체](docs/repository-transition.md): 기존 Astro 코드 보존과 Next.js 소스 교체.
- [현재 아키텍처](docs/architecture.md): 파일·데이터 경로·기술 경계.
- [데이터 모델](docs/data-model.md) · [동기화](docs/synchronization.md) · [AI](docs/ai.md).
- [운영·장애 대응](docs/operations.md) · [검증 기록](VERIFICATION.md).
- [로드맵](docs/roadmap.md) · [설계 결정](docs/decisions.md) · [변경 기록](CHANGELOG.md).

## 검사

```powershell
pnpm typecheck
pnpm test
pnpm build
```

최종 타입 검사·운영 빌드·24개 테스트를 통과했습니다. 초기 10개 브라우저 흐름과 새 문서 교환 UI·기존 시험 ZIP의 로컬 복원을 확인했습니다. 실제 Supabase에는 테이블 6개·RPC 4개·비공개 버킷·Realtime 대상 테이블을 설치했고 익명 REST 접근 검사 7개가 통과했습니다. 작가 세션의 저장·새로고침·서버 변경 반영과 실제 첨부 업로드, 샘플 공개판의 비공개 정보 제외를 확인했습니다. 다른 기기 첨부 다운로드·오프라인 충돌·실제 ZIP 복원은 후속 검증 범위입니다. [검증 기록](VERIFICATION.md).

## 원고 보존과 운영 경계

백업과 복구에서 **백업 내려받기**로 ZIP을 만들고 별도 저장소에 보관합니다. 기기 복구 이력은 같은 브라우저에 있습니다. Drive 자동 백업은 Google OAuth·서버 변수 연결 후 사용할 수 있습니다. 복원·충돌 선택은 작업 공간 전체에 적용합니다.

운영 환경에서는 Supabase 연결과 작가 권한을 설정해야 합니다. `ALLOW_LOCAL_PREVIEW`는 공개 배포에서 켜지 않습니다. 실제 원고를 옮기기 전 [운영 전 단계](docs/roadmap.md)를 확인합니다.
