---
name: gamespec-propose
description: "Start formal GameSpec work from Codex — new project admission or design workflow proposal"
license: MIT
compatibility: Requires a project-local gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
  host: "codex"
---

# GameSpec Propose

Use this entrypoint when the user wants to start formal GameSpec work: a new project, an existing project normalization path, a major design workflow, or an Admission Review.

## What This Does

1. Identifies the user's scenario: new project, existing project adoption, major pivot, or scoped design workflow.
2. Reads the installed GameSpec profile and available kernel assets.
3. Selects an appropriate workflow or explains what is missing.
4. Defines expected artifacts, owners, and proof signals before writes.
5. Presents the plan and waits for user confirmation when project truth would change.

## Scenario Routing

| User intent | Recommended route |
| --- | --- |
| New game idea with no project | Admission Review, then `game-conception` if beta workflows are installed |
| Existing project wants GameSpec | Adoption / archaeology first; Admission Review is optional |
| Major pivot | Admission Review as a serious commitment gate |
| System, narrative, level, world, numerical design | Matching beta workflow if installed |
| Loose brainstorm | `gamespec-explore` first |

## Codex Behavior

- Prefer read-only planning before writes.
- Use local CLI proof where available.
- Record decisions in project-visible files only after explicit approval.
- Keep Codex goal/plan state aligned with GameSpec evidence, but do not treat chat state as project truth.

## Guardrails

- Do not require Admission Review for every existing project adoption.
- Do not create project truth from brainstorm material without explicit promotion.
- Do not assume optional workflows, roles, skills, or templates exist under `stable-core`.
- Never skip human confirmation for GO / CONDITIONAL-GO / NO-GO or canon-changing decisions.
