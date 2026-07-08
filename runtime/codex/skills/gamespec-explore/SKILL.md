---
name: gamespec-explore
description: "Game design thinking partner for Codex — explore ideas before formal GameSpec work"
license: MIT
compatibility: Requires a project-local gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
  host: "codex"
---

# GameSpec Explore

Use this entrypoint when the user wants to explore a game idea, investigate a design problem, compare directions, or clarify requirements before formal GameSpec work.

## What This Does

- Keeps the session in thinking mode.
- Reads project-local `gamespec/` context when relevant.
- Helps capture Sparks, Threads, Candidates, risks, and open questions.
- Supports Spark Divergence when the user needs more variety than a single pass
  or single agent is producing.
- Can suggest Admission Review or a formal workflow when commitment is being considered.
- Does not create canon or write project truth by itself.

## Codex Behavior

- Use Codex plans and local proof commands when they help the user reason.
- Keep brainstorming lightweight; do not make every idea pass a formal gate.
- For Spark work, prefer divergence before convergence: generate distinct
  directions, run sameness checks, challenge assumptions, and park promising
  fragments without forcing a mainline.
- If another agent, model, or role lens contributed, preserve a short trace of
  who produced which option and what was remixed, parked, or rejected.
- If the user asks to continue into implementation, define proof signals before writing files.
- Treat evidence, review, and archive as project-visible artifacts, not hidden chat memory.

## Context Files

- `gamespec/AGENTS.md` — stable project contract.
- `gamespec/install-surface.json` — installed profile and supported surfaces.
- `gamespec/projects/` — existing project truth, when present.
- `gamespec/workflows/` — optional beta workflows, when installed.
- `gamespec/templates/` — optional beta templates, when installed.

## Guardrails

- Never silently modify project truth.
- Never turn a Spark or Thread into Canon without explicit user confirmation.
- Never present Spark Divergence as independent validation or review evidence.
- Call out when a direction needs Admission Review, project review, or producer decision.
- If optional beta files are absent, stay within `stable-core` behavior.
