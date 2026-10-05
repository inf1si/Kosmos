<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Documentation

## Installed agent tools

Read [the agent tools guide](docs/agent-tools.md). Before coding, follow [Karpathy Guidelines](.agents/skills/karpathy-guidelines/SKILL.md); before a completion claim, commit or PR, follow [Verification Before Completion](.agents/skills/verification-before-completion/SKILL.md). For Anti Slop installation or updates, follow [its official installer skill](.agents/skills/install-anti-slop/SKILL.md).

Use [Attention Span's Attention-kind style](.agents/styles/attention-kind.md) for replies, subject to higher-priority instructions and these local adaptations: keep the user's language (Korean by default), do not assume a medical diagnosis, and finish authorized work with full verification. Brevity governs the report, not the investigation. The other Attention Span skills are available when explicitly requested.

Read [docs/status.md](docs/status.md) and the relevant feature guide before changing behavior. For a functional change, update the feature guide, [CHANGELOG.md](CHANGELOG.md), [VERIFICATION.md](VERIFICATION.md), and [docs/status.md](docs/status.md) in the same commit. Separate goals, local tests, deployed checks, and user reports. Do not mark unperformed checks complete.

Run `pnpm docs:check` before finishing. CI compares changed paths to the base commit and requires those documentation updates. This checks links and changed files, not factual accuracy; review feature, storage/sync, import/export/backup, privacy, deployment, and design documentation for semantic consistency. Follow [docs/maintenance.md](docs/maintenance.md). Never record credentials or private manuscript text.

# Design

Before building or changing any UI (public pages, the studio, dialogs), read [docs/design-guide.md](docs/design-guide.md) and follow it. It is the single source for colour tokens, the three palettes (violet, cassette, cyber) × light/dark, type, layout, copy rules (Korean, data-based wording, no slogans or English decorative headings) and where studio features go.

- Build new screens from the existing parts listed in section 0 of the guide (board-bar, segmented, `.button`, `.chip`, `.status-dot`, document icons, the reference-panel layout, `Popover`/`.menu`). Do not invent new shapes, header rows, font sizes or weights; compare the new screen side by side with an existing one such as the plot board.
- Shape tokens (`--ctl-r`, `--r-in`, `--panel-r`, `--led-r`) are only defined for cyber; always write a fallback such as `var(--ctl-r,6px)`.
- Use tokens, never raw colours: `--pub-*` on public pages, the unprefixed base tokens in the studio and dialogs. Use shape tokens instead of branching on a palette name.
- Check every new screen in all six palette × mode combinations and at 360px width.
- Before finishing, go through section 11 (새 기능 체크리스트). If you add a token or pattern, update the guide and `CHANGELOG.md`.
- Mockups and the design-system artifact live on claude.ai and may not be reachable from your tool; the guide's values are authoritative.

# Implementation acceptance

Follow [interaction verification](docs/interaction-verification.md) for UI changes.

- Fetch the current main revision and inspect intervening changes before implementing or publishing. Preserve changes made by other agents and designers; do not rebuild from an older local snapshot.
- Define each changed control's target and expected outcome, including selected text versus the whole document and device preferences versus persisted content.
- Verify the real browser workflow, including consecutive controls, focus/selection, visible results, undo and persistence where relevant. A control in the DOM, a click without an outcome, schema tests or a build alone do not establish UI completion. Check computed styles and the actual browser control when rendering matters.
- Check shared controls in their affected consumers. Keep local, CI, deployed and user-reported evidence separate, and name unverified behaviors. Add regression checks for defects that actually occurred; do not claim that a documentation checklist automatically tests the UI.
