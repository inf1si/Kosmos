# Google Drive 독립 자동 백업

전체 작업 공간 ZIP/Drive/DB 백업은 계정 휴지통 사본과 참조 첨부 바이트를 포함한다. 휴지통 영구 삭제는 이미 만들어진 백업 파일을 지우지 않는다. [휴지통 계약](workspace-trash.md).

Google Drive는 원고·이력·첨부의 앱 복원 ZIP을 계속 보관한다. 2026-10-02 운영 집필실에서 오늘 백업 기록과 새 수동 백업 성공·저장 후 무결성 확인을 검증했다. 0.2.1의 백업 파일 다운로드·별도 기기 복원 시험·누락 감시 연결과 R2 암호화 DB 백업은 [추가 절차](disaster-recovery.md)를 따른다. 코드 준비, 실제 연결, 복원 성공과 알림 수신을 구분한다.

## 백업 범위와 실행

Vercel이 매일 UTC 19시에 `/api/backup/cron`을 실행한다. 한국 시간으로 다음 날 **04시대**다. Hobby 일정은 해당 시간 안에서 실행되므로 정확한 04:00을 보장하지 않는다. 브라우저가 닫혀 있어도 실행되지만 클라우드에 아직 저장하지 못한 기기 원고는 포함하지 않는다. [Vercel 일정 안내](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

설정한 작가 UUID 하나의 Supabase 서버 작업 공간과 서버 복구 이력 최근 50개 이내, 현재·이력의 모든 참조 이미지 바이트를 수집한다. 서버 작업 공간 JSON이 보유한 공개 판본은 포함하지만 Auth 사용자, DB 스키마·정책, 다른 DB 테이블 전체, 브라우저 전용 이력을 덤프하지 않는다. 이 용도의 보관은 소스·SQL과 별도다. 이력·첨부 포함 한도 100MiB를 적용한다.

1. 권한과 Production 환경을 확인하고 서버의 저장된 버전을 읽는다.
2. 참조 첨부가 모두 있고 크기가 일치하는지 검사한다.
3. 기존 전체 백업 형식으로 ZIP 생성·검증한다.
4. Google Drive의 비공개 **Orbis Tertius 백업** 폴더에 새 파일로 업로드한다.
5. 저장된 ZIP을 다시 읽어 SHA-256과 전체 백업 형식을 검증한다.
6. 성공할 때만 `latest.json`의 마지막 검증 시각·서버 버전·문서·이력·첨부 수를 갱신한다.

파일명은 날짜·버전·임의 ID를 포함해 기존 정상 백업을 덮어쓰지 않는다. 재실행도 새 파일을 만들며 자동 중복 제거·보관 기간 정리는 없다. 폴더·파일은 공유 설정을 추가하지 않는다. ZIP 내용은 앱에서 따로 암호화하지 않는다. 접근 취소는 Google 계정의 앱 연결 관리에서 수행한다.

## 무료 공간·권한·운영 경계

일반 Google 계정의 무료 공간은 최대 15GB이며 Gmail·사진과 공유한다. 실제 계정의 남은 용량을 먼저 확인한다. Kosmos는 저장 공간을 구매하거나 자동 유료 전환하지 않는다. 공간이 부족하면 실패로 표시한다. [Google 저장 공간 안내](https://support.google.com/drive/answer/9312312?hl=en).

OAuth는 `https://www.googleapis.com/auth/drive.file` 하나만 사용한다. 앱이 만든 파일·폴더에 접근하는 권한이며 일반 문서·사진을 전체 조회하는 `drive` 권한은 요청하지 않는다. 응답에 다른 범위가 있으면 연결을 거절한다. [공식 권한 안내](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

표준적인 개인 백업 사용량은 현재 Drive API의 일일 과금 기준 이내에서 추가 사용료가 없다. Google은 향후 과금 변경을 예고할 수 있으므로 연결 시 정책을 확인한다. API가 영구히 무제한 무료라는 뜻은 아니다. [Drive API 한도](https://developers.google.com/workspace/drive/api/guides/limits).

용량은 보관한 전체 ZIP 수에 비례한다. 예를 들어 ZIP 20MiB를 매일 남기면 30일 약 600MiB가 추가된다. 오래된 백업은 새 파일의 복원 성공 후 사용자가 직접 관리한다. 자동 삭제는 구현하지 않았다. Healthchecks.io의 실행 신호·누락 감시 연결 코드는 추가했으며 실제 알림 수신은 미검증이다. 현재는 앱에서 마지막 성공 시각을 확인하고 Vercel 실행 로그를 살펴본다.

서버 백업용 Supabase `service_role`은 RLS를 우회할 수 있는 강한 비밀이다. 이 기능에만 Production 서버 변수로 두고 브라우저·Preview·Git·문서에 값 자체를 넣지 않는다. 코드 조회는 설정한 작가·작업 공간·Storage 경로에 한정한다.

## 작가 화면과 복원

**백업과 복구** 아래에 연결 여부·마지막 검증 기록·**지금 클라우드 백업**이 표시된다. 수동 실행도 서버 저장본을 보관한다. 다른 기기의 미전송 수정이 걱정되면 해당 기기에서 전체 ZIP을 먼저 만든다.

Drive에서 날짜별 ZIP을 내려받아 별도 시험 origin의 **백업과 복구**로 읽고 원고·설정·각주·첨부를 확인한다. 운영에서 복원할 때에는 현재 작업을 먼저 ZIP으로 보관한다. [복원 절차](backup-restore.md).

## 서버 계약

| 경로 | 권한·동작 |
|---|---|
| GET `/api/backup/cron` | 최소 32자 `CRON_SECRET`의 정확한 Bearer 인증. Production만 실행 |
| GET `/api/backup/status` | 로그인한 허용 작가·설정된 백업 소유자 일치. 미설정이면 `configured: false` |
| GET `/api/backup/download` | 같은 작가 인증, Production, 성공 파일 ZIP·해시 검증, 응답 4MiB 이하 |
| POST `/api/backup/run` | 같은 작가 인증, Production만 실행 |

미설정·인증 실패·Preview 실행·저장소 오류·용량 초과는 성공으로 기록하지 않는다. 마지막 성공 표시가 오래된 채 남으면 정상 백업이 지속된다고 해석하지 않는다. 60초 함수 한도와 작업 제한 때문에 큰 첨부·느린 연결은 실패할 수 있다. 장편 규모 실측 후 실행 환경을 확장한다.

S3/R2 어댑터도 옵션으로 구현했다. 사용자가 Drive를 선택해 현재 연결 대상은 Drive다. 변경하려면 `BACKUP_STORAGE_PROVIDER=s3`와 비공개 버킷·서버 키를 설정한다. 별도 R2/S3 실서비스 검증은 하지 않았다.

구현: [백업 핵심](../src/lib/offsite-backup.ts), [서버 수집](../src/lib/offsite-backup-server.ts), [Drive 어댑터](../src/lib/google-drive-backup.ts), [일정](../vercel.json), [화면](../src/components/offsite-backup-panel.tsx).
