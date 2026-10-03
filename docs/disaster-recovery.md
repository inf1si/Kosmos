# Orbis Tertius 백업 보강과 연결 절차

기준: 2026-10-03 · 0.2.1. 앱 ZIP, DB 복구용 암호화 파일, Markdown 사본은 각각 다른 목적이다. 새 DB 백업의 첫 복원 훈련을 통과하기 전 기존 Drive ZIP을 유지한다.

## 최신 운영 경계 — 2026-10-03

Drive ZIP 저장·재다운로드·임시 IndexedDB 복원은 완료했다. R2·GitHub 인증 설정과 DB 인증·역할·스키마 수집은 통과했지만 데이터 덤프 옵션 수정 후 실제 R2 저장·전체 DB 복원은 확인하지 않았다. 첫 복원 훈련 전 DB cron은 비활성이다. 완료 백업 자동 삭제는 없다.

Healthchecks DB 실패 신호 도착을 확인했고 실패 메일·키 폴더의 다른 장소 보관은 사용자 완료 보고를 받았다. 개인키 사본 바이트는 읽지 않았다. Drive 예약 신호·누락 알림은 별도 시험한다. 아래 과정은 당시 기록이며 현재 판정은 이 절과 [최신 검증](../VERIFICATION.md)을 따른다.

## 현재 확인한 것

- 운영 집필실에서 2026-10-02 04:58:49 KST의 정상 백업 표시를 확인했다. 표시만으로 cron 실행 로그까지 검증했다고 해석하지 않는다.
- 21:47:36 KST에 수동 Drive 백업도 성공했다. 9개 문서·1개 첨부·약 0.02MB이며 서버 코드는 업로드 파일을 다시 읽어 ZIP·SHA-256을 검증한 뒤 성공 기록을 쓴다.
- 소스 `88f40105cd9c7257c4a8ba9914d17245033d0923`의 Vercel 배포 성공과 운영 첫 화면·집필실의 Orbis Tertius 표시, 소개 문구 제거를 확인했다. GitHub CI에서 타입 검사·28개 테스트·운영 빌드와 age 암호화/복호화 합성 파일 비교도 통과했다. 합성 파일 검사는 실제 DB 복원을 대신하지 않는다.
- 22:24:33 KST에 운영 Drive 백업을 다시 만들고 서버에서 ZIP을 다운로드해 별도 IndexedDB 공간에 복원했다. 작품 2개·문서 9개·이력 2개·첨부 1개를 다시 읽고 비교하는 시험이 통과했다. 현재 원고는 유지됐으며 브라우저의 별도 파일 저장 경로는 확보하지 못했다.
- 암호화 DB·첨부 R2 실행 스크립트와 GitHub Actions workflow는 구현 단계다. R2 구독 활성화와 비공개 Standard/APAC 버킷 생성, daily/·monthly/ 각각 30일 삭제·덮어쓰기 잠금 저장을 확인했다. 사용자의 영구 삭제 금지 요청에 따라 준비했던 일별 35일·월별 365일 만료 규칙은 저장하지 않고 취소했다. GitHub에서 R2 계정·버킷·접근 키 두 항목과 암호화 공개키·Supabase URL의 등록된 이름을 확인했다. 실제 R2 인증·업로드, pg_dump·운영 파일 age 암호화, 복호화·DB 복원 훈련, 누락 알림의 실제 수신은 완료로 기록하지 않는다.
- 공식 age v1.3.2 Windows 배포 파일의 GitHub SHA-256을 검사한 뒤 로컬 키를 만들고 합성 파일 암호화·복호화 비교를 통과했다. 개인키는 소스 폴더 밖에 두었고 출력·업로드하지 않았다. 개인키의 다른 장소 사본 보관은 아직 확인하지 않았다.
- 실제 Supabase 대시보드에서 서울 리전과 Postgres 17.11.0.002, Session pooler 5432 주소를 확인했다. DB 비밀번호 보관은 사용자 보고이며 값은 읽지 않았다. Direct 주소가 db.<project>.supabase.co인 것도 확인해 업로더의 호스트 검증을 수정했다.
- 이후 사용자 보고와 GitHub 목록에서 DB URI·service role 항목 이름 등록도 확인했다. 이 이름의 존재는 실제 DB 인증 성공을 의미하지 않는다. 외부 감시는 사용자의 정정된 선택에 따라 Healthchecks 연결을 진행하며 로그인·URL 등록·수신 시험은 남아 있다.

GitHub Actions는 Supabase의 DB·Auth·설정과 Storage 파일을 수집해 암호화하는 실행 환경이다. GitHub Secrets에는 접속 설정을 두고 완성된 암호화 백업 파일은 R2에 보관한다. 저장소 소스의 migration SQL도 복원용으로 함께 넣지만, 주된 백업 대상은 운영 DB·원고·첨부다.

## 이름 변경과 기존 데이터

화면·페이지 제목·내보내기 표시는 Orbis Tertius로 변경하고 소개 문구를 제거했다. Drive에 앱이 만든 기존 폴더가 있으면 다음 새 백업 때 이름을 변경하며 새 폴더를 중복 생성하지 않는다. 기존 IndexedDB 이름·백업 format·교환 format·Drive appProperties·저장 prefix를 유지해 이전 파일과 기기 원고를 계속 읽는다. GitHub 저장소와 Vercel URL은 기존 주소다. Google OAuth 앱 표시명은 별도 콘솔 설정이다.

## Drive ZIP 다운로드와 복원 시험

집필실 → 백업과 복구 → 지금 클라우드 백업 → 저장된 백업 복원 시험.

새 성공 기록에 파일 위치·SHA-256이 포함된다. 다운로드 API는 로그인한 허용 작가와 백업 소유자가 같아야 하고, 다른 소유자 경로·상태 파일·경로 이탈을 거절한다. 서버에서 ZIP을 검증한 뒤 내려준다. 예전 성공 기록은 새 백업을 한 번 만든 뒤 사용할 수 있다.

복원 시험은 별도 임시 namespace에 원고·이력·첨부를 써서 다시 읽고 내용·첨부 해시를 비교한다. 현재 집필 workspace와 Supabase에는 쓰지 않고 시험 자료는 완료 뒤 정리한다. 이 시험은 앱 데이터의 기기 복원이다. 서버의 로그인·RLS·Storage 복원과 구분한다.

Vercel 응답 제한 때문에 집필실 직접 다운로드는 4MiB 이하로 제한한다. 더 큰 ZIP은 Drive에서 직접 내려받는다. ZIP 생성 자체의 100MiB 한도와 다르다.

## R2 버킷

R2 Standard의 무료 제공량은 계정 합계 월 10 GB-month다. 다른 버킷·사용자·서비스도 함께 계산한다. 무료 범위를 넘으면 과금되는 구독이며 코드의 제한은 Cloudflare 계정 전체의 과금 차단 장치가 아니다. [가격](https://developers.cloudflare.com/r2/pricing/).

권장 버킷 이름: `orbis-tertius-backups`. 비공개, Standard, Public Development URL과 custom domain 비활성.

| prefix | 삭제·덮어쓰기 잠금 | 자동 삭제 |
|---|---|---|
| `daily/` | 30일 | 없음, 기한 없이 보관 |
| `monthly/` | 30일 | 없음, 기한 없이 보관 |
| `status/` | 없음 | 파일 만료 없이 최신 성공 기록 갱신 |

**완료된 원고 백업은 자동 영구 삭제하지 않는다.** 30일 잠금은 삭제·덮어쓰기 방지 기간이며 만료 삭제 시점이 아니다. 30일 뒤에도 백업 파일은 남는다. Cloudflare의 기본 7일 multipart abort 규칙은 완료되지 않은 업로드 조각만 정리하며, 정상 업로드된 백업 ZIP의 만료 규칙이 아니다. R2 관리자가 잠금 규칙을 제거할 수 있으므로 관리자도 영구히 삭제할 수 없다는 보장과는 구분한다. [잠금](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

코드는 한 번의 DB·첨부 원본 합계 100MiB, 해당 버킷 저장량 9GB를 상한으로 둔다. 자동 만료가 없으므로 일별·월별·수동 백업과 실패 후 남은 파일은 계속 누적된다. **다음 백업을 더하면 9GB를 넘는 경우 새 업로드를 중단하고 이전 백업과 마지막 성공 기록을 보존한다.** 공간을 만들기 위해 과거 백업을 지우거나 상한을 자동으로 늘리지 않는다. 연결 후에는 실패 신호와 누락 감시로 중단을 알리며, 현재는 외부 알림 연결·수신 시험이 남아 있다. 한도에 닿으면 별도 저장소로 사본을 옮겨 검증하거나 용량·주기를 사용자가 결정한다. R2 계정 전체의 과금을 차단하는 장치라는 뜻은 아니다.

업로더는 **이 버킷 하나**의 Object Read & Write만 사용한다. bucket lock·lifecycle·공개 접근을 변경하는 관리자 토큰은 CI에 넣지 않는다.

## GitHub 연결 값

GitHub 저장소 Settings → Secrets and variables → Actions → Repository secrets를 사용한다. 인증 비밀은 사용자가 직접 입력·저장하며, 계정 ID·버킷 이름·공개 암호화 키·공개 API URL은 준비된 값으로 등록한다. Vercel의 Drive 값을 R2로 바꾸지 않는다.

| Secret | 확인·준비 위치 |
|---|---|
| `SUPABASE_DB_URL` | Supabase Connect → Session pooler 5432, 비밀번호 URL 인코딩, TLS 연결. Transaction pooler 제외 |
| `SUPABASE_URL` | 현재 프로젝트 API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 현재 서버용 키. NEXT_PUBLIC로 넣지 않음 |
| `R2_ACCOUNT_ID` | Cloudflare R2의 계정 ID |
| `R2_BUCKET` | 비공개 버킷 이름 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 위 버킷만 허용하는 R2 토큰 |
| `BACKUP_AGE_RECIPIENT` | 아래에서 만든 age 공개키만 |
| `DB_BACKUP_HEALTHCHECK_URL` | DB 백업용 Healthchecks.io check의 ping URL |

DB 접속 암호와 service role은 새로 발급할 필요 없이 보관한 현재 값을 입력한다. 이 값들은 채팅·문서·로그·소스에 넣지 않는다. Supabase CLI 2.119.0과 Postgres major 17을 고정하고 덤프의 서버·pg_dump 버전도 검사한다. 실제 프로젝트가 17이 아니라면 설정과 훈련을 맞추기 전 실행하지 않는다. [공식 백업·복원 절차](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Windows에서 `.ps1` 도우미가 `PSSecurityException`으로 차단되면 실행 정책을 변경하지 않는다. `Restricted`는 개별 명령을 허용하므로 필요한 명령을 PowerShell 창에 직접 입력한다. DB 비밀번호는 `Read-Host -AsSecureString`으로 받고 URI 암호 부분을 `Uri.EscapeDataString`으로 인코딩한 뒤 완성한 접속 주소를 `Set-Clipboard`로 복사한다. 접속 주소는 화면에 출력하지 않고 GitHub Secret 칸에 직접 붙여 넣는다. 변환용 BSTR은 `ZeroFreeBSTR`, SecureString은 `Dispose`로 정리한다. 실제 비밀번호와 연결 주소가 없는 구문 검사와 사용자의 입력·저장 완료 확인은 구분한다. [Microsoft 실행 정책 안내](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies).

## 암호화 키

이번 연결에서는 공식 age v1.3.2를 검증해 설치하고 로컬 키를 생성했다. 개인키 위치는 사용자 Documents/Codex 아래의 별도 private-backup-keys 폴더이며 소스 ZIP·저장소에는 포함하지 않는다. 다른 환경에서 새 키가 필요하면 공식 age 도구를 설치한 사용자 컴퓨터에서 `age-keygen -o orbis-backup-identity.agekey`로 만든다. 파일은 개인키이므로 소스 폴더 밖에 보관한다. `age-keygen -y orbis-backup-identity.agekey`로 얻은 공개키만 CI에 입력한다. **정기 실행 전 개인키의 별도 사본을 USB·다른 컴퓨터 등 안전한 독립 위치에 보관하고 실제로 읽을 수 있는지 확인한다.** 현재 이 별도 보관 확인은 남아 있다. 개인키가 없으면 DB·첨부를 복구할 수 없다. [age](https://github.com/FiloSottile/age).

## 실제 실행과 보관 범위

GitHub Actions에서 Encrypted database and assets backup → Run workflow로 첫 실행한다. 정기 실행은 `DB_BACKUP_ENABLED=true` Repository variable을 설정하기 전 비활성이다.

스크립트는 CLI의 roles/schema/data SQL과 현재 앱의 public·auth·storage 데이터, Storage API의 파일 바이트·bucket 설정, 버전 관리된 SQL을 수집한다. managed schema를 새로 만드는 덤프가 아니며 Storage RLS 사용자 정의는 기존 migration의 해당 부분으로 따로 복원한다. Vector Storage·Vault·추가 managed service를 이 앱의 완전한 복구 범위로 주장하지 않는다.

첨부 목록을 전후 비교해 업로드·삭제·수정이 발견되면 중단한다. 모든 SQL·첨부·파일별 해시·경로 대응 manifest를 ZIP에 넣고 전체 ZIP을 age로 암호화한다. 고유 파일명으로 `daily/`, UTC 매월 1일에는 `monthly/`에도 저장한다. 업로드 파일을 다시 읽어 해시를 비교한 뒤 잠금 밖의 `status/latest.json`을 갱신한다. 원고·덤프·연결 문자열을 로그나 Actions artifact에 남기지 않는다.

## 첫 DB 복원 훈련

복호화 파일은 별도 로컬 Supabase 환경에서 다룬다. Docker와 공식 CLI를 준비하고 실제 서버와 같은 Postgres major를 쓴다. 운영 DB에 시험 복원하지 않는다.

1. R2의 암호화 파일을 내려받아 `age --decrypt --identity orbis-backup-identity.agekey --output restore.zip backup.zip.age`로 복호화한다.
2. manifest의 각 파일 크기·SHA-256과 첨부 경로를 검증하고 ZIP을 별도 시험 디렉터리에 푼다.
3. 공식 가이드의 역할·기본 권한·schema·data 복원 순서를 따른다. `ON_ERROR_STOP`, 단일 트랜잭션과 필요한 trigger 처리를 적용한다. 새 local stack에 public 테이블을 미리 중복 생성하지 않는다.
4. managed Storage 정책은 원본 migration의 해당 정책만 재적용한다. `001_studio.sql` 전체를 이미 복원된 public schema에 다시 실행하지 않는다. Realtime publication도 확인한다.
5. manifest의 bucket·원래 object 경로로 실제 파일을 Storage API에 복원하고 해시를 재검사한다. Storage 메타데이터 SQL만 복원해서 끝내지 않는다.
6. 작가 로그인, 원고·각주·위키 연결, 서버 저장, 공개판 조회, 비공개 RLS, 첨부 접근을 실제로 확인한다. API 키·OAuth·Vercel 설정은 별도로 재연결한다.
7. 날짜·도구 버전·결과만 검증 기록에 남긴 후 `DB_BACKUP_ENABLED=true`를 켠다. 성공 업로드 기록의 `restoreVerified:false`는 복원 훈련 완료 표시가 아니다.

## 미실행 감시

실제 Healthchecks 계정에서 Drive·DB 항목을 만들고 아래 주기를 저장했다. 두 항목의 이메일 채널은 ON·Ready to deliver 상태다. 비공개 ping URL을 각각 GitHub·Vercel에 입력하는 사용자 작업과 신호·이메일 수신 검증은 아직 남아 있다.

이후 사용자가 두 주소 저장을 보고했고 변수 이름을 확인했다. 첫 DB 백업이 실패한 뒤 Healthchecks에 실패 신호가 도착했지만 이후 사용자가 실패 메일 수신을 확인했다. 누락 알림은 별도 시험한다. 업로더는 고정된 단계와 오류 분류만 출력한다. CLI 원문에는 연결 주소·SQL 등이 포함될 수 있으므로 원문을 공개 로그로 전환하지 않는다. Drive 감시 변수는 새 Vercel 배포에 반영한 뒤 실제 신호를 확인한다.

Healthchecks.io에서 Drive와 DB용 check를 따로 만들고 각 알림 연결을 시험한다. Drive: 24시간 주기 + 12시간 grace. DB: UTC `23 18 * * *` + 12시간 grace. DB 작업은 30분 제한이며 start 신호를 사용하므로 실행 중 grace도 맞춘다. 최초 정상 ping 후 알림을 활성화하고 fail 신호·36시간 누락을 시험한다. [감시 API](https://healthchecks.io/docs/http_api/).

Vercel Production의 `BACKUP_HEALTHCHECK_URL`은 Drive check, GitHub의 `DB_BACKUP_HEALTHCHECK_URL`은 DB check를 쓴다. 시간·성공/실패만 전송하고 오류 본문·원고·계정 식별자는 보내지 않는다. URL 값은 공개하지 않는다. 설정된 URL이 있다는 것과 실제 알림을 수신했다는 것은 다르다.

GitHub schedule은 지연·누락될 수 있고 공개 저장소가 60일 동안 활동이 없으면 비활성화될 수 있다. 외부 check가 바로 이 미실행을 감시한다. [GitHub 제약](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## 다음 단계

Drive ZIP의 운영 다운로드·기기 복원 시험은 완료했다. R2 연결·잠금·보존량 측정, DB 복원 훈련과 누락 알림을 먼저 완성한다. 이후 문서별 저장과 Yjs/DO 전환을 별도 migration으로 수행하고, 공개판·문단별 위키 공개 시점·Reader ISR을 보강한다. 원고를 두 저장 구조의 독립 원본으로 동시에 수정하지 않는다. Drive의 Markdown 자동 사본은 ZIP과 독립된 읽기용 출력으로 추가한다.
