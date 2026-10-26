# 글꼴 라이선스 전수조사 · 2026-10-23

**웹폰트 33종은 모두 상업용 웹 사용이 허용된다. 유료 구매나 폰트 교체가 필요한 항목은 발견하지 않았다.** 아래는 고지 추가 전 조사 결과이며, 후속 작업으로 저작권·라이선스 파일을 동봉했다. 폰트 자체와 화면 디자인은 유지한다.

## 후속 조치: 글꼴 라이선스 동봉

- [`public/licenses/fonts.txt`](../public/licenses/fonts.txt)를 `/licenses/fonts.txt` 경로에서 제공한다. 메뉴·페이지 링크·팝업·화면 문구를 추가하지 않는다.
- 33종 각각의 저작권, 원문에 선언된 예약 글꼴명, 전달 방식·출처와 라이선스 전문을 담았다. 29종은 조사 때 고정한 Google Fonts 커밋의 원문을, 프리텐다드·원티드 산스는 고정 npm 버전의 원문을 줄바꿈과 줄끝 공백만 정리해 보존한다. 마루부리·나눔바른고딕은 네이버 공식 저작권/RFN 안내와 OFL 1.1 전문을 담는다. 운영 폰트의 저작권 메타데이터도 함께 보존했다.
- 나눔·마루부리의 공식 저작권 안내를 공통으로 넣고, Syncopate의 Apache 2.0 전문은 OFL과 구분했다. 폰트 바이너리·메타데이터·서브셋·CDN 경로는 수정하지 않는다.
- 파일 해시·글꼴별 출처는 [JSON 기록](font-license-audit-2026-10-23.json)의 `notices`에 있다. 배포 검증은 [검증 기록](../VERIFICATION.md)을 따른다.
- [PR #81](https://github.com/inf1si/Kosmos/pull/81), main `8bae034`로 운영에 반영했다. 실제 www·root·기존 Vercel 주소에서 HTTP 200·UTF-8 평문·전체 파일 해시 일치를 확인했다. 공개 파일은 [여기](https://www.orbiter.ink/licenses/fonts.txt)서 열 수 있다.
- 글꼴 추가·교체나 패키지 버전 변경 시 공용 `layout.tsx`, `manuscript-fonts.ts`의 실제 목록과 이 파일을 다시 대조하고 해당 저작권·라이선스도 갱신한다. 기기 글꼴 파일을 앱에 포함할 때는 별도 재배포 권한을 확인한다.

## 범위와 방법

- 기준 main: `bf881a961be4331e7f8f273ebd6acd493b444343`. 최신 테마(노스트로모)의 Jost·VT323을 포함한다.
- [`layout.tsx`](../src/app/layout.tsx)의 Google Fonts CSS 요청 20종, [`manuscript-fonts.ts`](../src/components/manuscript-fonts.ts)의 Next Font 12종·npm 패키지 4종, [`editor-preferences.ts`](../src/lib/editor-preferences.ts)의 20개 선택지, 전체 `src`의 CSS·SVG·내보내기/백업 코드를 대조했다.
- Google CDN 20종 + 자체 제공 16종 − 중복 3종(고운바탕·IBM Plex Sans KR·나눔고딕코딩) = **고유 웹폰트 33종**. 글꼴 선택지 20개는 웹폰트 16개와 기기/시스템 선택 4개이므로 앱 전체 폰트 수와 다르다.
- Google Fonts의 개별 라이선스·메타데이터는 원본 저장소 커밋 `45e3d5269e4a17d823f6d84470bc084dc5ae46f6`로 고정해 29종을 직접 확인했다. 이 중 28종은 OFL 1.1, Syncopate는 Apache 2.0이다. npm 4종은 고정 설치 버전의 패키지·배포 파일과 권리자 자료를 확인했다.
- 실제 `www.orbiter.ink` 공개 독서 응답의 스타일시트 14개, `@font-face` 선언 3,210개를 수집했다. **33종 모두에 대해 배포 경로·굵기·스타일별 대표 파일 64개**를 내려받아 이름 테이블의 저작권(0)·버전(5)·라이선스(13)·라이선스 URL(14)을 확인했다. 대표 파일은 각 CSS 묶음에서 마지막 범위(대체로 라틴)를 골랐다. 모든 글리프 범위를 처음부터 64개로 간주한 것이 아니다.
- npm에서 실제 import한 CSS가 참조하는 **202개 파일 전부**도 로컬에서 검사했다. 프리텐다드 92개·원티드 산스 92개는 OFL 정보가 있고, 마루부리 10개·나눔바른고딕 8개에는 없다.
- 상세 출처·해시·64개 배포 파일의 실제 메타데이터는 [기계 판독 기록](font-license-audit-2026-10-23.json)에 보존했다. 원고·로그인 계정은 사용하지 않았다.

## 조사 당시 판정과 보완할 항목

### 1. 직접 제공하는 네이버 글꼴 5종의 고지가 부족하다

| 글꼴 | 공급 방식 | 운영 대표 파일의 라이선스 필드 | 확인 결과 |
|---|---|---|---|
| 나눔고딕 | Next Font | 설명 없음 · 기존 회사 주소만 존재 | 고지 보완 |
| 나눔명조 | Next Font | 설명 없음 · 기존 회사 주소만 존재 | 고지 보완 |
| 나눔손글씨 붓 | Next Font | 설명·라이선스 URL 없음 | 고지 보완 |
| 나눔바른고딕 | `@kfonts/nanum-barun-gothic@0.3.0` | 회사 이름·주소만 존재 | 패키지에도 별도 LICENSE/OFL 파일 없음 |
| 마루부리 | `@kfonts/maruburi@0.1.0` | 설명·라이선스 URL 없음 | 패키지에도 별도 LICENSE/OFL 파일 없음 |

파일에 저작권자 표시는 남아 있다. 문제는 라이선스 설명/원문이 동반되지 않았다는 점이다. 두 `@kfonts` 패키지의 `package.json`에 있는 `OFL-1.1` 한 줄은 실제 폰트 저작권 안내·라이선스 전문과 구분해야 한다. 조사 당시 `src`·`public`에는 별도 글꼴 라이선스 원문이나 사용자 고지 경로도 없었다. Next Font가 Google에서 내려받았다는 사실만으로 원본 저장소의 `OFL.txt`까지 앱에 배포된다고 볼 수 없다.

[네이버 공식 안내](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko)는 나눔·마루부리의 상업용 사용과 번들/재배포를 허용하면서 저작권 안내·라이선스 전문 동봉을 명시한다. 전문 동봉이 어려울 때 출처 표기를 권장하지만, 현재 앱에서는 그 별도 고지도 확인하지 못했다. [OFL 조건 2](https://openfontlicense.org/open-font-license-official-text/) 역시 저작권과 라이선스를 별도 파일·읽을 수 있는 헤더·메타데이터 중 한 방식으로 제공하도록 한다. **사용권이 없는 폰트를 발견한 것이 아니라, 배포 조건 충족 근거가 부족한 항목을 발견한 것이다.**

보완안: 폰트별 저작권·Reserved Font Name·출처와 라이선스 전문을 담은 고지 파일을 실제 배포물에 포함하고 사용자가 열 수 있는 경로를 둔다. `node_modules`나 개발 저장소 문서에만 추가하면 최종 사용자에게 함께 제공된다고 보장할 수 없다. 33종 전체를 한곳에서 관리하면 이 5종과 향후 누락을 함께 막을 수 있다. 후속 작업으로 이 문서 위의 제공 방식을 적용했다.

### 2. Syncopate는 OFL이 아닌 Apache 2.0이다

Syncopate는 [Google Fonts의 개별 LICENSE](https://github.com/google/fonts/blob/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/apache/syncopate/LICENSE.txt)와 실제 400·700 배포 파일의 메타데이터에서 Apache 2.0을 확인했다. **상업용 사용은 허용된다.** 현재 앱은 Google CDN에서 제공하는 파일을 참조하며 이를 자체 호스팅하지 않는다. 조사한 원본 디렉터리에는 별도 `NOTICE` 파일이 없다.

향후 파일을 자체 배포하거나 패키지에 넣으면 [Apache 2.0 제4조](https://www.apache.org/licenses/LICENSE-2.0)의 라이선스 사본 제공, 관련 고지 보존, 수정한 파일의 변경 표시와 원본 NOTICE가 있는 경우의 동봉 조건을 적용한다. 전체 폰트를 일괄 OFL로 표기하면 안 된다.

### 3. 나머지 27종 OFL 웹폰트의 대표 파일에는 OFL 정보가 있다

이 27종의 대표 파일은 저작권과 OFL 설명 또는 OFL URL을 보존한다. 프리텐다드·원티드 산스는 npm에 별도 라이선스 원문도 들어 있다. [OFL FAQ 1.10](https://openfontlicense.org/ofl-faq/)는 메타데이터 방식과 OFL 링크를 설명한다. 따라서 외부 고지 페이지가 없다는 이유만으로 모든 폰트를 일괄 위반으로 판단하지 않았다. 다만 원문과 출처를 한곳에서 제공하면 사용자가 확인하기 쉽고 빌드/패키지 변경에도 덜 취약하다.

## 33종 전체 목록

G = 공용 레이아웃에서 Google Fonts CDN 사용. N = Google Fonts를 Next Font가 내려받아 앱에서 직접 제공. P = npm CSS·파일을 앱에서 직접 제공. 같은 이름의 G+N은 하나의 글꼴로 센다. ‘OFL 명시’는 검사한 대표 파일의 선언 확인이며 모든 재배포 조건에 대한 법률 보증을 뜻하지 않는다.

| 글꼴 | 전달 방식 | 라이선스 | 배포 메타데이터/조치 | 권리자·배포 원문 |
|---|---|---|---|---|
| Chakra Petch | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/chakrapetch/OFL.txt) |
| Cinzel | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/cinzel/OFL.txt) |
| Fredoka | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/fredoka/OFL.txt) |
| Gothic A1 | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/gothica1/OFL.txt) |
| Gowun Batang | G + N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/gowunbatang/OFL.txt) |
| Gowun Dodum | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/gowundodum/OFL.txt) |
| Hahmlet | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/hahmlet/OFL.txt) |
| IBM Plex Mono | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/ibmplexmono/OFL.txt) |
| IBM Plex Sans KR | G + N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/ibmplexsanskr/OFL.txt) |
| Jost | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/jost/OFL.txt) |
| Jua | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/jua/OFL.txt) |
| M PLUS 1 Code | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/mplus1code/OFL.txt) |
| Marcellus SC | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/marcellussc/OFL.txt) |
| Michroma | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/michroma/OFL.txt) |
| Nanum Brush Script | N | OFL-1.1 | **고지 보완** | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/nanumbrushscript/OFL.txt) |
| Nanum Gothic | N | OFL-1.1 | **고지 보완** | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/nanumgothic/OFL.txt) |
| Nanum Gothic Coding | G + N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/nanumgothiccoding/OFL.txt) |
| Nanum Myeongjo | N | OFL-1.1 | **고지 보완** | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/nanummyeongjo/OFL.txt) |
| Nanum Pen Script | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/nanumpenscript/OFL.txt) |
| Noto Sans KR | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/notosanskr/OFL.txt) |
| Noto Serif KR | N | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/notoserifkr/OFL.txt) |
| Orbitron | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/orbitron/OFL.txt) |
| Oxanium | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/oxanium/OFL.txt) |
| Saira Semi Condensed | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/sairasemicondensed/OFL.txt) |
| Saira Stencil One | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/sairastencilone/OFL.txt) |
| Share Tech Mono | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/sharetechmono/OFL.txt) |
| Shrikhand | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/shrikhand/OFL.txt) |
| Syncopate | G | Apache-2.0 | Apache 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/apache/syncopate/LICENSE.txt) |
| VT323 | G | OFL-1.1 | OFL 명시 | [원문](https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/vt323/OFL.txt) |
| Pretendard | P · `pretendard@1.3.9` | OFL-1.1 | OFL 명시 | [원문](https://github.com/orioncactus/pretendard/blob/v1.3.9/LICENSE) |
| Wanted Sans | P · `wanted-sans@1.0.3` | OFL-1.1 | OFL 명시 | [원문](https://github.com/wanteddev/wanted-sans/blob/main/packages/wanted-sans/fonts/OFL.txt) |
| MaruBuri | P · `@kfonts/maruburi@0.1.0` | OFL-1.1 | **고지 보완** | [원문](https://hangeul.naver.com/font) |
| NanumBarunGothic | P · `@kfonts/nanum-barun-gothic@0.3.0` | OFL-1.1 | **고지 보완** | [원문](https://hangeul.naver.com/font) |

## 기기 글꼴과 일반 글꼴 이름

| 이름 | 앱의 사용 방식 | 판단 |
|---|---|---|
| Batang / 바탕 | 원고 옵션·명조 대체 | 기기에 설치된 파일을 이름으로 참조 |
| Gulim / 굴림 | 원고 옵션 | 기기에 설치된 파일을 이름으로 참조 |
| Malgun Gothic / 맑은 고딕 | 원고 옵션·한글 UI 대체 | 기기에 설치된 파일을 이름으로 참조 |
| Apple SD Gothic Neo | 시스템·한글 UI 대체 | 기기에 설치된 파일을 이름으로 참조 |
| Arial | 테마 SVG 내부 글자 | 기기에 설치된 파일을 이름으로 참조 |
| Helvetica | 같은 SVG의 대체 글꼴 | 기기에 설치된 파일을 이름으로 참조 |

이 6종의 파일을 다운로드·복사·웹폰트로 재배포하는 코드는 발견하지 않았다. `system-ui`, `ui-monospace`, `serif`, `sans-serif`, `monospace`, `cursive`는 특정 폰트 상품명이 아닌 브라우저의 일반 글꼴 선택이다. [Microsoft 공식 FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq#web)는 Windows 글꼴 이름을 CSS 대체 목록에 쓰는 것과 Windows 폰트 파일을 서버에 복사하는 것을 구분하며, 전자를 허용한다. 이 참조를 유료 웹폰트 무단 배포로 계산하지 않았다. 기기에서 복사한 파일을 향후 앱에 넣는다면 별도 재배포 권한을 다시 확인해야 한다.

## 허용되는 사용과 유지할 조건

- **웹앱 유료화·상업용 사이트·작품 출판:** 이번에 확인한 OFL·Apache 글꼴은 상업용 사용을 허용한다. 페이지뷰/도메인/이용자 수에 따른 폰트 사용료나 별도 웹폰트 구매 조건은 발견하지 않았다. 앱과 글/그림 자체를 OFL로 공개해야 하는 것도 아니다.
- **번들·재배포:** OFL 파일에는 해당 저작권·라이선스를 함께 제공하고 폰트만 단독 상품으로 팔지 않는다. Apache 파일에는 해당 사본·고지 조건을 적용한다. 저장소를 비공개로 바꿔도 글꼴의 원래 라이선스나 최종 사용자 고지 조건이 없어지지 않는다.
- **수정·서브셋·이름 변경:** 제공자가 배포한 파일을 사용했다. 앱이 직접 폰트 바이너리를 수정하거나 글리프를 잘라내는 별도 스크립트는 발견하지 않았다. 향후 직접 수정·변환·서브셋을 만들면 OFL과 각 글꼴의 Reserved Font Name 조건을 별도로 확인해야 한다. 단순 CSS 별칭과 원본 파일 자체의 수정은 구분한다. [OFL 웹폰트 FAQ](https://openfontlicense.org/ofl-faq/).
- **내보내기·백업:** 현재 HTML·Markdown·ENEX 내보내기와 앱 백업 생성 코드는 선택한 웹폰트 파일을 자동으로 묶지 않는다. 원고의 글자 크기 같은 서식은 폰트 프로그램의 재배포와 다르다. [책 내보내기](book-export.md)는 예외다. 기존 OFL 1.1 글꼴 마루부리·원티드 산스의 원본 WOFF2 보통/굵은 네 파일과 원본 TTF/고지를 압축한 두 PDF용 묶음을 `/book-fonts/`에서 제공하고 PDF에는 원본 TTF 전체를 임베딩, 단일 HTML·EPUB에는 원본 WOFF2를 포함한다. 원본 가족 이름을 유지하며 fonts.txt의 저작권·예약 글꼴명·라이선스 전문을 PDF 첨부/HTML 숨김 텍스트/EPUB 텍스트 파일로 동봉한다. 2026-10-26부터 두 글꼴에 없는 글자(한자·가나·전각 기호 등)는 이미 감사한 OFL 1.1 글꼴 Noto Serif KR·Noto Sans KR(npm `@expo-google-fonts/*@0.4.4`, sha512 확인)의 부분집합으로 채운다. 글리프 윤곽은 바꾸지 않고 문자 범위만 줄인 수정본이므로 가족 이름을 `NotoSerifKR`·`NotoSansKR`로 두고 예약 글꼴명(Noto Sans KR의 'Source')을 쓰지 않는다. fonts.txt의 해당 항목 Delivery에 이 경로를 적었고 같은 고지를 함께 동봉한다. 글꼴 종류 수는 늘지 않는다. DOCX에 폰트 파일을 넣는 기능은 없다.

## 검증 경계

33개 폰트 계열의 라이선스·전달 경로는 전부 조사했다. 운영 폰트의 모든 글리프 범위에 대해 처음부터 전부 바이너리 검사를 했다고 주장하지 않는다. 기준 스캔은 64개 대표 파일이다. 고지 보완 대상으로 분류한 5종은 CSS가 참조하는 운영 파일 **470개 전부**를 추가 검사했다. 나눔고딕 184개·나눔명조 184개·나눔손글씨 붓 93개·나눔바른고딕 4개·마루부리 5개 모두 저작권은 있고 OFL 설명/URL은 없었다. 다운로드·분석 오류는 없었다. 상세 파일 목록의 SHA-256과 요약은 JSON 기록에 남겼다.

다른 28종의 모든 글리프 범위까지 바이너리 전수 검사를 했다는 뜻은 아니다. 개발 도구에 포함된 폰트나 사용자가 업로드한 첨부 전체의 권리 관계는 조사 범위가 아니다. 원래 조사 단계에서는 앱 코드·폰트·운영 설정을 바꾸지 않았으며 기능 테스트·새 빌드·배포를 수행하지 않았다. 이후 고지 파일 동봉의 별도 검증 범위는 [검증 기록](../VERIFICATION.md)을 따른다.
