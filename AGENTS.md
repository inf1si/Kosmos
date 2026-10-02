<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design

Before building or changing any UI (public pages, the studio, dialogs), read [docs/design-guide.md](docs/design-guide.md) and follow it. It is the single source for colour tokens, the three palettes (violet, cassette, cyber) × light/dark, type, layout, copy rules (Korean, data-based wording, no slogans or English decorative headings) and where studio features go.

- Use tokens, never raw colours: `--pub-*` on public pages, the unprefixed base tokens in the studio and dialogs. Use shape tokens instead of branching on a palette name.
- Check every new screen in all six palette × mode combinations and at 360px width.
- Before finishing, go through section 11 (새 기능 체크리스트). If you add a token or pattern, update the guide and `CHANGELOG.md`.
- Mockups and the design-system artifact live on claude.ai and may not be reachable from your tool; the guide's values are authoritative.
