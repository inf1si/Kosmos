# Google 집필실 로그인과 기존 계정 연결

2026-10-04: 앱 코드·로컬 검증을 추가했고 운영 Supabase의 Google 제공자와 수동 계정 연결을 활성화했다.
소스 `56c65d7`의 운영 배포, 기존 작가 로그인·원고 불러오기, 연결 버튼에서 Google 인증 화면 이동을 확인했다.
복귀 주소 등록은 사용자 완료 보고 기준이다. 실제 Google 계정 선택·연결 승인과 이후 Google 로그인 성공은 아직 확인하지 않았다.

## 기존 Naver 이메일 계정과 연결

현재 작가 계정은 Naver 이메일을 사용하는 Supabase 이메일·비밀번호 계정이다.
Google도 동일한 이메일이면 Supabase가 확인된 이메일을 기준으로 자동 연결할 수 있다.
Naver 이메일과 Gmail처럼 서로 다른 주소는 소유자 확인 없이 자동으로 합치지 않는다.

1. 기존 이메일·비밀번호로 집필실에 로그인한다.
2. 상단의 **로그인 계정** → **Google 계정 연결**을 누른다.
3. 연결할 Google 계정을 골라 인증을 승인한다.
4. 집필실로 돌아온 뒤 **Google 계정이 연결되어 있습니다.**를 확인한다.
5. 다음 로그인부터 로그인 화면의 **Google로 로그인**을 사용한다.

최초 연결은 Supabase `linkIdentity`로 기존 사용자에 Google 인증 수단을 추가한다.
작가 UUID, 원고 소유자, 첨부 경로, 백업 작가 지정은 그대로 유지한다.
기존 비밀번호 로그인도 계속 사용할 수 있다. 연결 해제·비밀번호 변경 UI는 추가하지 않았다.
다른 계정에 이미 연결된 Google 계정은 자동 병합하지 않고 연결 오류를 표시한다.
먼저 Google로 새 계정을 만들거나 작가 허용 목록에 Google 사용자를 별도로 추가하지 않는다.

## Google OAuth와 Supabase 설정

Google 로그인용 **Web application** OAuth 클라이언트를 준비한다.
Drive 백업 클라이언트·토큰은 로그인용으로 복사하거나 바꾸지 않는다.
같은 Google Cloud 프로젝트를 사용할 수 있지만 새 로그인 클라이언트를 사용하며,
프로젝트 전체의 동의 화면 범위를 바꾸는 경우 기존 Drive 백업과의 영향을 함께 확인한다.

- JavaScript origin: `https://kosmos-ashy.vercel.app`
- 개발 검증 origin: `http://127.0.0.1:3210`
- Google의 Authorized redirect URI:
  `https://krakjollsufgnwealroh.supabase.co/auth/v1/callback`
- 로그인 범위: `openid`, 이메일·기본 프로필. `drive.file`과 offline 접근을 로그인에 추가하지 않는다.

[Supabase Google 제공자 설정](https://supabase.com/dashboard/project/krakjollsufgnwealroh/auth/providers?provider=Google)에서
로그인 클라이언트의 Client ID·Client secret을 직접 입력하고 Google을 활성화한다.
Client secret은 채팅·Git·NEXT_PUBLIC 변수에 넣지 않는다. Google 계정의 승인·비밀키 입력은 계정 소유자가 수행한다.

Authentication 설정에서 **Allow manual linking**을 활성화한다.
공개 회원가입 비활성화는 유지하며, 이 변경 때문에 회원가입을 열지 않는다.
Authentication → URL Configuration의 Site URL을 운영 origin으로 설정하고 다음 복귀 주소를 추가한다.

```text
https://kosmos-ashy.vercel.app/auth/callback
http://127.0.0.1:3210/auth/callback
```

이 앱은 브라우저의 Supabase SDK로 PKCE 인증을 시작하고 같은 origin의 `/auth/callback`에서
코드를 교환한다. Google 콘솔의 callback은 **Supabase 주소**, Supabase의 허용 복귀 주소는
**Kosmos 주소**로 서로 다르다. 다른 기기나 origin에서 돌아오면 연결 의도·PKCE 검증이 실패하므로
인증을 시작한 브라우저에서 다시 시도한다.

현재 제공되는 Supabase 연결 도구에는 Auth provider·URL 설정을 수정하는 기능이 없다.
앱 설정값은 `.env.example`의 기존 Supabase URL·공개 키만 사용하며 별도 Google 비밀은 앱에 넣지 않는다.

## 인증과 데이터 경계

- 계정 연결 시작 전 인증된 사용자와 작가 허용 목록을 확인한다.
- 복귀 시 연결한 사용자 ID가 기존 사용자 ID와 같은지, Google identity가 있는지,
  작가 허용 목록에 들어 있는지 확인한다. 다른 사용자·10분 만료·미연결은 거절한다.
- 서버 API·DB RLS는 기존 `authors`/UUID 검사를 유지한다. 이메일·사용자 metadata로 작가 권한을 부여하지 않는다.
- 연결 시작 전 기기 저장 큐·클라우드 동기화를 요청한다. 원고 충돌 중에는 연결 버튼을 비활성화한다.
- OAuth 취소·오류는 안내 후 집필실로 돌아갈 수 있다. Google 설정이 꺼져 있으면
  인증 화면으로 이동하지 않고 기존 비밀번호 입력을 계속 사용할 수 있다.
- Google 인증은 Drive 백업 승인과 별개다. 사용자 이메일은 세션 인증에 사용하며
  임의 원고·백업 파일을 Google 로그인 요청에 포함하지 않는다.

## 활성화 후 실제 확인

기존 이메일 로그인 → Google 연결 → 같은 작가·원고 확인 → 다시 Google 로그인 → 새로고침을 확인한다.
별도 인증 계정에 작가 권한을 추가하거나 실제 원고를 시험 편집하지 않는다.
두 번째 Google 계정·승인 취소·이미 다른 계정에 연결된 identity도 확인한다.
로컬의 합성 OAuth 시험은 실제 Google 승인·서비스 활성화 성공을 대신하지 않는다.
검증 결과는 [최신 검증 기록](../VERIFICATION.md)을 따른다.

공식 기준 확인: [Supabase 계정 연결](https://supabase.com/docs/guides/auth/auth-identity-linking),
[Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google),
[인증 복귀 주소](https://supabase.com/docs/guides/auth/redirect-urls).
