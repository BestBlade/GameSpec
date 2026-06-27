# Maintainer Guide

This guide is for people changing the GameSpec package itself.

## Public Surface

Public package files include:

- `README.md`
- `LICENSE`
- `package.json`
- `bin/`
- `docs/`
- `kernel/`
- `runtime/`
- `lib/`

Self-governance records live under `.meta/changes/`. They are intentionally ignored by git and excluded from package artifacts.

## Required Checks

Run these before publishing source changes:

```powershell
node .\bin\gamespec-check.js --project . --format json
node .\bin\gamespec-audit-package-readiness.js --format json
node .\bin\gamespec-audit-cli-smoke.js --format json
node .\bin\gamespec-audit-core-install-surface.js --format json
node .\bin\gamespec-audit-pack-install-smoke.js --format json
git diff --check
```

`gamespec-audit-pack-install-smoke` is the strongest package proof. It packs the current source, installs it in an isolated project, checks every bin shim, validates the default stable install, and verifies runtime host selection behavior.

## Release Posture

GameSpec is licensed under MIT. GitHub source release and npm registry publishing are separate decisions. The release readiness audit reports both, but does not push, tag, or publish.

## Documentation Rule

Public docs should explain product use. Historical extraction notes, local validation evidence, and non-public project traces belong in ignored self-governance records, not in the release surface.
