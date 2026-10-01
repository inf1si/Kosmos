# 검증 자료

[local-browser-2026-10-01.json](local-browser-2026-10-01.json)은 초기 로컬 구현의 별도 Edge 테스트에서 확인한 10개 흐름과 오류 배열을 기록한 결과 요약이다. 시험용 데이터만 사용했다.

이 파일은 전체 테스트 로그나 재실행 스크립트가 아니다. 코드 테스트는 프로젝트 `tests/`와 `pnpm test`로 재현한다. 브라우저 흐름은 [VERIFICATION.md](../../VERIFICATION.md)의 순서와 [운영 안내](../operations.md)에 따라 샘플 환경에서 다시 확인한다.

[supabase-anonymous-2026-10-01.json](supabase-anonymous-2026-10-01.json)은 실제 Supabase 최초 설치 후 공개 키만 사용하는 익명 REST 검사 7개의 결과다. 공개 판본 조회와 비공개 테이블·게시자 열 접근 제한을 확인했다. 작가 로그인·동기화·첨부·Realtime 송수신, Vercel과 AI 검증 결과는 포함하지 않는다. 키·계정 UUID·원고는 포함하지 않는다.

[documentation-2026-10-01.json](documentation-2026-10-01.json)은 문서의 로컬 파일 링크·코드 펜스·SQL 객체·환경 변수 포함 여부를 확인한 결과다. 앱 테스트를 다시 실행한 결과는 아니다. 외부 URL의 전체 검증이나 문장별 의미 검증을 자동으로 수행한 결과도 아니다.
