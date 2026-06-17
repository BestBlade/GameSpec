---
name: gamespec-review
description: "Run L3 document review on game design artifacts — format, logic, and standards checks"
license: MIT
compatibility: Requires gamespec directory structure.
metadata:
  author: gamespec
  version: "1.0"
  system: "GameSpec v1.2.0"
---

# GameSpec Review

Run the document review workflow on game design artifacts. Triggers the L3 quality layer with three parallel checks.

## When to Use

- After generating design documents to check quality
- Before confirming drafts (`.ai.md` → `.md`)
- When unsure if a document meets GameSpec standards

## What This Does

1. Reads target documents (project-wide or single file)
2. Loads L3 agent definitions and review skills
3. Runs three parallel checks:
   - **Format check**: YAML frontmatter, Markdown standards, magic number detection, naming conventions
   - **Logic validation**: Causal completeness, definition consistency, boundary conditions, contradiction detection
   - **Standards compliance**: MDA consistency, template conformance, reference integrity
4. Generates a review report in `reviews/`

## Context Files

- `gamespec/agents/game-规范审查.md` — format reviewer agent
- `gamespec/agents/game-逻辑验证.md` — logic validator agent
- `gamespec/agents/game-Spec架构师.md` — spec architect agent
- `gamespec/skills/document-validator.md`
- `gamespec/skills/logic-review.md`
- `gamespec/skills/spec-standard-enforcer.md`
- `gamespec/skills/structure-diff.md`

## Guardrails

- L3 agents are READ-ONLY — never modify source documents
- Be specific: include line numbers or section references
- Distinguish blocking issues from suggestions
- If 3+ rejections on same document, flag for L1 escalation
- Save review reports to project's `reviews/` directory
