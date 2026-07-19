---
id: creative-studio
name: Creative Studio
description: Run bounded, resumable creative passes for a high-value Spark or Thread, then curate a traceable possibility portfolio for human choice without promoting project truth.
input:
  description: Creative question, explicit project-bounded context, initial action, optional role lenses, desired contrast, and round budget.
  fields:
    - name: prompt
      type: string
      description: The creative objective that remains stable across the session.
    - name: action
      type: string
      description: diverge | counterframe | deepen | cross-pollinate | contrast
    - name: context_files
      type: array
      description: Optional project-relative files to include in the packet with hashes and clipping metadata.
    - name: role_lenses
      type: array
      description: Optional creative viewpoints; lenses do not become independent validators.
    - name: max_rounds
      type: integer
      description: Finite budget from 1 to 6; default 3.
output:
  format: local Creative Studio session
  sections:
    - State And Context Identity
    - Round Trace
    - Direction And Fragment Map
    - Human Questions
    - Limits
---

# Creative Studio

Use this skill for Explore E2: the question matters enough to
benefit from multiple distinct passes, attention must survive interruption, and
the output should remain a possibility portfolio rather than a selected winner.

Do not use it for ordinary brainstorming, Candidate Review, canon acceptance,
implementation validation, or automatic repair-until-pass loops.

## Procedure

1. State the Spark / Thread truth boundary and a stable creative objective.
2. Select only relevant project-local context. Record desired contrast and
   missing perspectives rather than loading the whole repository by default.
3. Start a finite session. Use `diverge` for breadth, `counterframe` or
   `contrast` for frame breaking, and `deepen` or `cross-pollinate` for useful
   continuation.
4. After every peer run, complete every direction row in `selection.md` with
   `keep`, `remix`, `park`, `reject-duplicate`, or `needs-user`, including a
   reason and surviving fragment where applicable.
5. Run `advance` only after exact-run verification. Continue only when another
   action has a concrete purpose; otherwise curate, park, or abandon.
6. End with curation for human choice. Never infer Candidate or Canon promotion
   from agent agreement, repetition, or machine checks.

## Recovery

- If selected context changes, stop; use reason-bound `reopen` only when the
  user accepts a new lineage.
- If state publication or orchestration is interrupted, inspect status and use
  `recover-previous` with a reason. Do not invent missing output.
- If the round budget is exhausted, return to the user. Start a new session only
  with an explicit new budget or objective.

## Quality Checks

- Directions differ in core engine, concrete player action, conflict, cost, or
  long-horizon consequence, not only names and visual skins.
- Frame-breaking work names which assumption it challenges.
- Deepening work preserves source identity and distinctive risk.
- Curation keeps parked fragments and reopen triggers visible.
- The final carrier says what it cannot prove and routes the next choice to a
  human.
