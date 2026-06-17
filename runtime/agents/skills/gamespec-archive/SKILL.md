---
name: gamespec-archive
description: "Archive a completed game design project to the archive directory"
license: MIT
compatibility: Requires gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
---

# GameSpec Archive

Archive a completed game design project. Moves the project directory to `gamespec/projects/archive/` with a date prefix.

## When to Use

- After all workflow phases are completed
- When design work is done and ready to be preserved
- To clean up the active projects list

## What This Does

1. Prompts user to select a project (if not specified)
2. Checks completion status (phases, unconfirmed drafts)
3. Warns about incomplete work (but doesn't block)
4. Moves project to `gamespec/projects/archive/YYYY-MM-DD-<name>/`
5. Displays archive summary

## Context Files

- `gamespec/projects/<name>/.gamespec-state.yaml` — project state

## Guardrails

- Always prompt for project selection — never auto-select
- Don't block on warnings — inform and confirm
- Preserve `.gamespec-state.yaml` in the archived directory
- Never archive without user confirmation
