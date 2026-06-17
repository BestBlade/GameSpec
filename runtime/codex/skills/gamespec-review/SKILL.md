---
name: gamespec-review
description: "Review GameSpec artifacts from Codex — inspect quality, risks, evidence, and truth boundaries"
license: MIT
compatibility: Requires a project-local gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
  host: "codex"
---

# GameSpec Review

Use this entrypoint when the user asks Codex to review GameSpec artifacts, project changes, admission evidence, or workflow outputs.

## What This Does

- Checks whether the artifact matches the user's intent and GameSpec truth boundaries.
- Separates blocking issues, risks, suggestions, and open questions.
- Uses available validators and audits when they apply.
- Produces review evidence that can support a later decision.

## Review Targets

- Admission Review report or supporting evidence.
- Project truth documents.
- Decision records.
- Review reports and archive summaries.
- Install, sync, or project patch plans.
- Workflow state transitions.

## Codex Behavior

- Lead with findings when doing code or artifact review.
- Cite concrete files, sections, lines, hashes, or command results where possible.
- Distinguish host entrypoint limitations from GameSpec product limitations.
- Recommend the next safe action without pretending to own the producer decision.

## Guardrails

- Review is read-only unless the user explicitly asks for edits.
- Do not assign GO / NO-GO as final truth without human confirmation.
- Do not hide uncertainty inside polished summaries.
- Do not treat optional beta files as installed unless they exist or the profile says so.
