# Kosmos

개인 소설 연재 + 세계관 위키 사이트.

- **소설**: 장편(다화) / 단편(단화) 동일 데이터 모델로 처리, 유형만 분기
- **위키**: 세계관·인물·용어 문서. 본문에서 위키 문서를 참조하면 해당 위키 페이지에 "등장한 화" 자동 역참조(백링크)
- **에디터**: Tiptap 기반 커스텀 에디터 (예정 노드: WikiLink, SceneBreak, ImageBlock, Footnote, Spoiler, Aside, Ruby, CharacterCard, ChapterLink, Dialogue)
- **AI 보조 (예정)**: 선택 영역 퇴고 · 맞춤법 교정 · 화 요약 · 위키 초안 생성

## 스택

- **Astro 6** (`output: 'server'`, `@astrojs/node` standalone 어댑터)
- **React** 아일랜드 (에디터 전용)
- **Tailwind CSS 4** + `@tailwindcss/typography`
- **Drizzle ORM** over **libSQL** (로컬 dev = SQLite 파일, 배포 = Turso 호환)
- **Better-Auth** (이메일/비밀번호)
- **Tiptap** 3 (StarterKit + 커스텀 확장 예정)
- **Anthropic SDK** — Claude 기반 AI 기능

## 개발 세팅

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수
cp .env.example .env
# .env 열고 BETTER_AUTH_SECRET 채우기 (예: openssl rand -hex 32)
# ANTHROPIC_API_KEY는 AI 기능 켤 때만 필요

# 3. 로컬 DB 생성 + 스키마 반영
npm run db:push

# 4. 실행
npm run dev
```

브라우저에서 http://localhost:4321 로 접속. 첫 사용은 `/admin/login`에서 "처음이면 가입" 버튼으로 관리자 계정 생성.

## 스크립트

| 명령 | 동작 |
| --- | --- |
| `npm run dev` | dev 서버 (localhost:4321) |
| `npm run build` | 프로덕션 빌드 → `dist/` |
| `npm run preview` | 빌드 결과 로컬 미리보기 |
| `npm run db:push` | 스키마 변경을 DB에 반영 |
| `npm run db:studio` | Drizzle Studio (DB GUI) |

## 디렉터리 구조

```
src/
├── components/editor/     # Tiptap 기반 에디터 아일랜드 (React)
├── layouts/Layout.astro   # 공통 레이아웃
├── lib/
│   ├── ai/client.ts       # Anthropic SDK 클라이언트
│   ├── auth/              # Better-Auth 설정 + 가드
│   └── db/                # Drizzle 스키마 & 클라이언트
├── pages/
│   ├── index.astro        # 홈 (작품 목록)
│   ├── s/[slug]/          # 독자용 작품/화 페이지
│   ├── wiki/              # 독자용 위키 페이지
│   ├── admin/             # 관리자 UI (인증 필수)
│   └── api/               # POST 엔드포인트 (series/chapters/wiki/auth)
└── styles/global.css      # Tailwind 엔트리
```

## 데이터 모델 요약

| 테이블 | 내용 |
| --- | --- |
| `series` | 작품 — `kind: 단편 \| 장편`, `status: 연재중 \| 완결 \| 휴재` |
| `chapter` | 화 — 시리즈당 `number` 유니크, Tiptap `contentJson` + 캐시된 `contentHtml` |
| `wiki_page` | 위키 문서 — 작품 종속(`seriesId`) 또는 전역(`seriesId = null`) |
| `link` | 본문 → 위키 백링크 (에디터에서 `[[…]]` 입력 시 자동 기록 예정) |
| `tag`, `chapter_tag`, `wiki_tag` | 태그 |
| `asset` | 업로드 이미지 |

## 배포 메모

- **Node 상주 호스팅** (Fly.io / Railway / Render / VPS) + `node ./dist/server/entry.mjs`
- **DB는 Turso** (libSQL 관리형). `.env`에서 `DATABASE_URL` + `DATABASE_AUTH_TOKEN`만 바꾸면 코드 그대로 동작
- `BETTER_AUTH_SECRET`은 반드시 강력한 값으로 교체, `BETTER_AUTH_URL`은 실제 도메인으로
