---
name: gamespec-apply
description: "Continue a GameSpec workflow from Codex with proof-first project changes"
license: MIT
compatibility: Requires a project-local gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
  host: "codex"
---

# GameSpec Apply

Use this entrypoint when the user wants Codex to continue an accepted GameSpec workflow, apply a planned project update, or move a Candidate toward reviewed project truth.

## What This Does

1. Reads current project state, active driver, and relevant design truth.
2. Confirms the accepted workflow slice and proof signal.
3. Makes only scoped edits that match the accepted plan.
4. Runs available validation or audit commands.
5. Records evidence and reports remaining review or approval gates.

## Codex Behavior

- Use `git status`, local audits, and focused diffs to protect user work.
- Prefer small slices with explicit proof signals.
- Keep writes inside approved project boundaries.
- When a step requires user authority, stop at a clear decision point.

## Context Files

- `gamespec/AGENTS.md`
- `gamespec/install-surface.json`
- `gamespec/projects/<project-id>/active.md`, if present
- `gamespec/projects/<project-id>/.gamespec-state.yaml`, if present
- Relevant workflow, role, skill, and template files when installed

## Guardrails

- Never overwrite project truth as a side effect of product installation.
- Never apply a stale plan when base hashes or active state disagree.
- Do not treat a dry-run as approval for a physical write.
- Record evidence before asking the user to accept a project-truth transition.
