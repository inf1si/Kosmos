# 문서 유지와 완료 기준

기준: 2026-10-04. 기존 docs/README의 갱신 규칙을 AGENTS와 CI로 명시·강화하고, 실제 조작을 빠뜨린 편집 도구 검증을 보완했다.

## 변경할 때

1. 현재 main의 기준 커밋과 이후 변경을 먼저 확인한다. 다른 에이전트·디자이너의 수정은 보존한다. [상태](status.md)·관련 안내·코드를 읽고 목표 설계와 실제 구현을 구분한다.
2. 기능 변경과 같은 커밋에 **관련 기능 안내, CHANGELOG, VERIFICATION, docs/status**를 갱신한다. 데이터·저장·교환·개인정보·배포·디자인에 영향이 있으면 해당 문서도 고친다.
3. 사용법은 실제 버튼·제한·오류에 맞춰 쓰고 새 필드의 이전 데이터 처리와 백업 범위를 기록한다.
4. 검증 결과는 날짜·환경·범위·실패·남은 항목을 남긴다. 로컬 모의 시험, 운영 연결, 사용자 완료 보고, 실제 복원·AI 품질을 혼용하지 않는다.
5. `pnpm docs:check`와 변경에 맞는 타입·테스트·빌드를 실행한다. UI는 [실제 조작 검증](interaction-verification.md)에 따라 결과·적용 범위·연속 조작·초점·되돌리기·저장을 확인하고, 디자인 가이드의 여섯 테마·360px을 확인한다.
6. 배포 후 운영 확인을 했다면 결과를 후속 문서 커밋에 남긴다. 문서만 바꾼 경우 기능 테스트 전체를 다시 요구하지 않는다.

## 자동 검사

[검사기](../scripts/check-documentation.mjs)는 README·AGENTS·CHANGELOG·VERIFICATION와 docs의 Markdown 내부 링크, 경로 대소문자·파일·제목 앵커를 확인한다. 외부 URL의 상태와 코드 블록 안 링크는 검사하지 않는다.

[CI](../.github/workflows/verify.yml)는 `pnpm docs:check --base <기준 SHA>`로 변경 파일도 검사한다. src·supabase·scripts·workflow·package·lock 변경이 있으면 CHANGELOG·VERIFICATION·docs/status와 이 둘 외의 docs 기능 안내 최소 하나가 함께 바뀌어야 한다. docs/README만 바꾸는 것으로 기능 안내를 대체할 수 없다.

로컬 기본 명령은 링크만 검사한다. Git 체크아웃에서 기준 커밋을 지정하면 갱신 파일도 검사한다. 첫 push의 영 SHA는 링크 검사만 수행한다. 규칙은 파일 변경 여부를 보장하며 문장 내용이 올바르다는 보장은 아니므로 아래 검토가 필요하다.

## 사실 관계 검토

| 변경 | 함께 살필 문서 |
|---|---|
| UI·사용법 | user-guide, 기능 안내, design-guide |
| 필드·이전 자료 | data-model, architecture, synchronization |
| 가져오기·복원·프리셋 | import-export, backup-restore, offsite-backup |
| 외부 제공자 전송·키 보관 | ai, service-connection, privacy 화면 |
| SQL·서비스 연결·운영 | setup-deployment, operations, disaster-recovery |
| 완료·후속 개발 | status, roadmap, README, VERIFICATION, CHANGELOG |

과거의 실패·미완료 기록은 날짜를 보존하고 최신 상태의 위치를 안내한다. 현재 안내에 과거의 “미연결”을 방치하지 않는다. 가격·플랜·모델·API가 달라지는 사항은 공식 자료를 다시 확인하고 확인일·링크를 남긴다. 실제 원고·키·토큰·DB 비밀번호는 문서·증거에 넣지 않는다.

다음 대규모 작업 시작 전에도 [이번 감사](documentation-audit-2026-10-03.md)처럼 변경 범위와 안내를 대조한다.
