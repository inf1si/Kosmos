# 궤도 서재 — 개인 소설 집필·공개·설정집

Next.js + Tiptap + Supabase 기반 개인 SF 소설 사이트의 첫 구현입니다. ‘궤도 서재’와 샘플 작품은 임시 이름입니다.

**[전체 프로젝트 문서](docs/README.md)**에서 요구사항, 디자인 연구, 실제 구현, 개발 인수인계, 배포와 운영 절차를 확인할 수 있습니다.

## 현재 상태

원고 편집·탭·2분할·작품별 문서·기기 저장·복구 이력·ZIP 백업·공개 판본·각주·설정 연결·독서 화면을 로컬에서 구현하고 검증했습니다. 서울 지역의 실제 Supabase 프로젝트에 최초 SQL을 적용하고 익명 접근 제한을 확인했습니다. 작가 로그인·동기화 시험, Vercel 배포, AI와 독립 저장소 자동 백업은 아직 완료하지 않았습니다.

기기 미리보기의 원고는 현재 브라우저에 저장됩니다. 클라우드가 연결되거나 외부에 공개된 상태는 아닙니다. 목표 기능과 실제 동작의 차이는 [구현 상태](docs/status.md)에 기록했습니다.

## 빠른 실행

프로젝트 폴더에서 Node.js 22 또는 24와 pnpm 11.19.0을 사용합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

[로컬 집필실](http://127.0.0.1:3210/studio)을 엽니다. Windows에서는 [start-studio.ps1](start-studio.ps1)도 사용할 수 있습니다. 소스 ZIP에는 의존성·빌드 결과·비밀 키를 포함하지 않습니다.

## 목적별 문서

- [작가 사용 안내](docs/user-guide.md): 작품·문서·분할·각주·설정·게시.
- [백업·복구](docs/backup-restore.md): 실제 첨부 포함 ZIP, 복구 이력, 원고 이동.
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

기존 타입 검사·운영 빌드·6개 테스트·10개 브라우저 흐름은 통과했습니다. 실제 Supabase에는 테이블 6개·RPC 4개·비공개 버킷·Realtime 대상 테이블을 설치했고 익명 REST 접근 검사 7개가 통과했습니다. 작가 세션과 원격 첨부·동기화는 후속 검증 범위입니다. [검증 기록](VERIFICATION.md).

## 원고 보존과 운영 경계

백업과 복구에서 **백업 내려받기**로 ZIP을 만들고 별도 저장소에 보관합니다. 현재 자동 복구 지점은 열린 집필실의 기기 이력이며 자동 외부 백업은 아닙니다. 복원·충돌 선택은 작업 공간 전체에 적용합니다.

운영 환경에서는 Supabase 연결과 작가 권한을 설정해야 합니다. `ALLOW_LOCAL_PREVIEW`는 공개 배포에서 켜지 않습니다. 실제 원고를 옮기기 전 [운영 전 단계](docs/roadmap.md)를 확인합니다.
