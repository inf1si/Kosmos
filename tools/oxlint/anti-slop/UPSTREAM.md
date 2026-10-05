# Anti Slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Exact source commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied source directory: `skills/install-anti-slop/assets/anti-slop/`
- Installed directory: `tools/oxlint/anti-slop/`
- Generic entry point: `tools/oxlint/anti-slop/index.ts`
- Copy command: `node .agents/skills/install-anti-slop/scripts/install.mjs`
- Matching development dependencies: `oxlint@1.86.0` and `@oxlint/plugins@1.86.0`.
- Configuration: `.oxlintrc.json`; all 18 generic rules and the native `oxc/no-accumulating-spread` companion are errors. Effect rules are not enabled because Kosmos has no direct Effect dependency.
- Source changes: none. This provenance file, the upstream root MIT license and a local `package.json` declaring ESM are added locally. The ESM marker avoids a Node module-type warning without changing the application's package type. The nested ESLint Stylistic license and provenance are preserved.
- Pristine skill assets, source hashes and third-party licenses are retained under `.agents/`; exact upstream references are in `.agents/upstream.json`.

Follow `.agents/skills/install-anti-slop/references/update.md` for updates. Do not overwrite this copy without reviewing local changes and re-running lint and typecheck.
