---
name: gamespec-propose
description: "Propose a new game design project — create project directory and generate initial design artifacts"
license: MIT
compatibility: Requires gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
---

# GameSpec Propose

Create a new game design project with initial artifacts based on the appropriate workflow.

## When to Use

- Starting a new game project from scratch
- Designing a new game system (combat, equipment, etc.)
- Beginning worldbuilding for a game
- Starting narrative design work
- Initiating level design

## What This Does

1. Determines the appropriate workflow based on user intent
2. Creates the project directory under `gamespec/projects/<name>/`
3. Initializes project state (`.gamespec-state.yaml`)
4. Reads workflow, agent, skill, and template definitions
5. Executes Phase 1 of the workflow, generating initial artifacts
6. Presents artifacts and next steps to the user

## Workflow Mapping

| User Intent | Workflow | Duration |
|------------|----------|----------|
| New game / 立项 | game-conception | 5 weeks |
| System design | system-design | 8-13 days |
| Numerical design | numerical-design | 9-14 days |
| Worldbuilding | worldbuilding | 2-4 weeks |
| Narrative design | narrative-design | 2-4 weeks |
| Level design | level-design | 1-3 weeks |
| Gameplay iteration | gameplay-iteration | 1-2 weeks/round |

## Context Files

- `gamespec/AGENTS.md` — global constitution (must read)
- `gamespec/workflows/<id>.md` — workflow definition (must read)
- `gamespec/agents/*.md` — agent definitions for participating agents
- `gamespec/skills/*.md` — skill definitions as needed
- `gamespec/templates/**/*.md` — document templates

## Guardrails

- Always read workflow definition before starting
- Always read AGENTS.md global constitution
- Only execute Phase 1 — remaining phases use `/gmsx:apply`
- All generated documents use `.ai.md` suffix (draft status)
- Never skip template sections or use shortcuts like "(略)"
- All numbers must use `{{VAR_}}` variables
