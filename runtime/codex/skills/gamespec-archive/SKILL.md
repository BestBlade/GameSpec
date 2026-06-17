---
name: gamespec-archive
description: "Archive accepted GameSpec work from Codex with explicit evidence and user confirmation"
license: MIT
compatibility: Requires a project-local gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
  host: "codex"
---

# GameSpec Archive

Use this entrypoint when accepted GameSpec work needs to be preserved, closed, or moved out of active flow without losing evidence.

## What This Does

1. Identifies what is being archived: design truth, rejected branch, admission decision, review evidence, or completed workflow.
2. Checks that the relevant decision and review evidence exists.
3. Summarizes accepted facts, unresolved risks, and rollback notes.
4. Asks for explicit confirmation before moving or writing archive artifacts.
5. Reports the final archive location and remaining follow-up actions.

## Codex Behavior

- Keep archive records project-visible.
- Preserve why a branch was rejected or parked.
- Make the difference between "done", "parked", "rejected", and "canonized" explicit.
- Use git and local filesystem checks to avoid moving unrelated user files.

## Guardrails

- Never archive without user confirmation.
- Never delete project truth to make an archive look clean.
- Do not convert parked or rejected material into canon.
- Do not archive a workflow as complete if review or approval gates are still open.
