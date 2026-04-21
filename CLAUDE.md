# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Kosmos — a solo-author novel serialization site with an integrated worldbuilding wiki. Short stories (`단편`) and long-form works (`장편`) share a single data model (`series` + `chapter`); `kind` is the only discriminator. The wiki is a first-class citizen: chapters link to wiki entries via `[[…]]` Tiptap nodes, and those links are stored in the `link` table so wiki pages can auto-render "등장한 화" backlinks.

## Common commands

```bash
npm run dev          # dev server on http://localhost:4321
npm run build        # production build → dist/
npm run preview      # serve the built output
npm run db:push      # apply schema changes (drizzle-kit push, libSQL)
npm run db:studio    # Drizzle Studio GUI
```

There is no test suite yet. There is no lint step configured — `astro check` can be invoked via `npx astro check` for a one-off type check.

When running commands from a non-standard shell on Windows, prepend `export PATH="/c/Program Files/nodejs:/c/Program Files/Git/cmd:$PATH"`.

## Architecture

### Rendering split
`astro.config.mjs` sets `output: 'server'` with `@astrojs/node` standalone. Every page is SSR by default. Reader pages (`/`, `/s/…`, `/wiki/…`) are cheap SSR with DB queries in the frontmatter. Admin pages and API routes explicitly set `export const prerender = false` — that mark is required on any file under `src/pages/api/` or `src/pages/admin/` (otherwise build attempts static generation and DB access at build time breaks).

### Auth is route-level, not middleware
There is no global auth middleware. Each admin page and mutation endpoint calls one of:
- `auth.api.getSession({ headers: Astro.request.headers })` in the frontmatter → redirect to `/admin/login` if null (pages)
- `requireAuth(request)` from `src/lib/auth/guard.ts` (API routes; throws a 401 `Response` that is returned via `catch (res) { return res as Response }`)

The Better-Auth catch-all handler lives at `src/pages/api/auth/[...all].ts`. The user/session/account/verification tables are part of `src/lib/db/schema.ts` — they are NOT auto-generated; editing Better-Auth config that requires new columns means editing the schema by hand.

### Editor (Tiptap) pattern
Tiptap runs only in React islands (`src/components/editor/*.tsx`) loaded with `client:only="react"`. Any new Tiptap-based form (e.g. edit pages that don't exist yet) must:
1. Pass `immediatelyRender: false` to `useEditor` — mandatory for SSR hydration.
2. Store **both** `contentJson` and `contentHtml`. The JSON is the source of truth (re-editable); the HTML is a render cache the reader pages blast out via `set:html`. Client sends both on submit; do not rebuild HTML server-side for now.
3. Submit via `fetch('/api/…', { method: 'POST', … })` then `window.location.href = …` to navigate on success (no client-side router).

### Domain enums are Korean strings
The DB stores literal Korean values, enforced by Drizzle `enum` constraints:
- `series.kind`: `'단편' | '장편'`
- `series.status`: `'연재중' | '완결' | '휴재'`
- `chapter.status` / `wiki_page.status`: `'초안' | '예약' | '발행'` (wiki has no `예약`)

API route validators check these literals — do not swap to English or the enum check rejects valid input.

### Short-story UX shortcut
A `단편` is just a series with exactly one chapter. The forms enforce this:
- `/admin/series/new` redirects to `/admin/series/[id]/chapters/new` immediately after creating a 단편 series (skipping the detail page).
- `/s/[slug]/index.astro` renders the first chapter's `contentHtml` inline when `kind === '단편'` instead of showing a chapter list.

Keep this single-path assumption when adding features: a 단편 should never surface a chapter list UI.

### Wiki backlinks
The `link` table is currently unused — the `[[…]]` Tiptap node has not been implemented yet. `src/pages/wiki/[slug].astro` already joins `link → chapter → series` and renders "등장한 화". When the WikiLink node is added, writing the form must insert rows into `link` with `fromType='chapter'|'wiki'`, `fromId`, `toType='wiki'`, `toId` on every save (replace-all semantics: delete prior `fromId` rows, insert fresh).

### AI
`src/lib/ai/client.ts` exports a configured `Anthropic` client and `MODEL = 'claude-opus-4-7'`. No AI endpoints exist yet; they should live under `src/pages/api/ai/` with `prerender = false` and `requireAuth`. Prompt caching should be applied when a feature re-sends large context (e.g. full-series summarization).

## Dev notes

- **Windows file watcher noise**: Astro occasionally logs `ENOENT: … .tmp.<pid>.<ts>` unhandled rejections when files are written with atomic rename (most editors, this tool). Harmless — the route list rebuilds fine on the next save. Restart `npm run dev` if it ever gets stuck.
- **Drizzle dialect**: `drizzle.config.ts` uses `dialect: 'turso'` so it can talk to both a local libSQL file and remote Turso with the same config. Do not change to `'sqlite'` unless also swapping the driver.
- **Korean JSON payloads via curl**: `curl -d '{"kind":"단편"}'` may mangle UTF-8 in Git Bash. Use `--data-binary "@file.json"` when smoke-testing from the command line; browser submissions are fine.
- **`.env`**: `BETTER_AUTH_SECRET` is required for Better-Auth to initialize. The default in `.env` is a dev placeholder — replace before any non-local deployment. `ANTHROPIC_API_KEY` is only needed when AI features are actually called.

## Deployment model

Persistent Node process (Fly.io / Railway / Render / VPS) running `node ./dist/server/entry.mjs`. DB swaps from local file to Turso by setting `DATABASE_URL` (`libsql://…`) + `DATABASE_AUTH_TOKEN` — no code changes required. Serverless platforms (Vercel Functions, Cloudflare Pages) would require switching the adapter and reworking the libSQL client lifecycle, so avoid recommending them without a deliberate refactor.
