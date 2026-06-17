---
name: gamespec-apply
description: "Execute the next phase of a game design workflow — advance through remaining phases"
license: MIT
compatibility: Requires gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
---

# GameSpec Apply

Execute the next phase of a game design workflow. Picks up where `/gmsx:propose` left off.

## When to Use

- Continuing a game design project after Phase 1
- Advancing through workflow phases
- Resuming work on an existing project

## What This Does

1. Reads project state from `.gamespec-state.yaml`
2. Determines the next pending phase
3. Loads workflow, agent, skill, and template definitions
4. Reads all previously completed artifacts for context
5. Generates new artifacts for the current phase
6. Applies quality gates (L1 approval, L3 review)
7. Updates project state

## Quality Gate Handling

- **L1 gates**: Present artifacts to user for approval. Pause until confirmed.
- **L3 gates**: Run document review checks, generate review report. If 3+ rejections, escalate to L1.
- **Phase transitions**: Update `.gamespec-state.yaml` after each completed phase.

## Context Files

- `gamespec/projects/<name>/.gamespec-state.yaml` — project state
- `gamespec/AGENTS.md` — global constitution
- `gamespec/workflows/<id>.md` — workflow definition
- `gamespec/agents/*.md` — participating agent definitions
- `gamespec/skills/*.md` — required skill definitions
- `gamespec/templates/**/*.md` — document templates
- Previously generated artifacts in the project directory

## Guardrails

- Always read workflow and constitution before starting
- Always read previously completed artifacts for context
- Apply quality gates strictly — don't skip approvals
- Update `.gamespec-state.yaml` after each phase
- All documents use `.ai.md` suffix
- Respect agent layer permissions
- Pause on unclear requirements — don't guess
