# Workflows

GameSpec workflows are meant to keep design work moving without letting project truth drift.

## Creative Capture

Use Sparks and Threads for low-friction exploration.

Good captured material includes:

- raw mechanics
- reference notes
- scene fragments
- unresolved design questions
- contradictory options
- dead ends and why they stopped

Nothing in capture becomes canon automatically.

## Candidate Review

Promote material to Candidate when it could affect project truth, implementation cost, dependencies, or producer commitment.

A Candidate should name:

- intent
- source Sparks or Threads
- affected project truth
- risks
- proof signal
- decision owner

## Optional Capability Lane

Use the capability lane only when a Candidate has a real direction fork, evidence risk, high-impact direction choice, or low-ceiling risk. It is not part of routine Spark or Thread capture.

Optional records:

- `direction-map.md` records promoted, parked, and rejected directions.
- `evidence-contract.md` binds important claims to proof, falsifiers, source labels, and coverage limits.
- `findings.md` may record selection findings when a selection or debate pass happens.
- `## Mainline Decision` belongs inside `proposal.md` or `archive.md` when the default path matters.

Parked means intentionally preserved for later reconsideration. It is not the same as failed.

## Canonization

Canonization requires a human-owned decision and enough evidence for future work to trust the result.

At minimum, canon should carry:

- the accepted statement
- review evidence
- dependencies and affected surfaces
- implementation readiness when relevant
- archive or status update

## Docs Change Structure Check

Docs-backed changes can use `gamespec-check` to audit proposal, apply, verify, and archive structure. This is a support command, not a design decision maker.

The checker can report useful structure warnings even when a docs project has no change records yet. When a project uses OpenSpec, OpenSpec remains the owner of its own change schema and lifecycle.

## Admission Review

Use Admission Review when a direction deserves a serious commitment check. It should remain uncommon and high weight.

Typical triggers:

- new project creation
- major pivot
- vertical slice commitment
- funding, staffing, schedule, or platform escalation
- long drift period requiring a hard reality check

## Project Adoption

For existing projects, install the stable core first. Then read current state, identify project truth, and decide which surfaces should be governed. Admission Review can happen later if the user wants a serious health check.
