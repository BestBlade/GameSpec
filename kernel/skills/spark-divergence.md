---
id: spark-divergence
name: Spark Divergence
description: Use multiple passes, role lenses, or agents to widen a Spark pool before commitment; detect same-core reskins and preserve remixable fragments without promoting them to project truth.
input:
  description: Spark question, source material, optional role lenses, and truth boundary.
  fields:
    - name: prompt
      type: string
      description: The idea question or creative problem.
    - name: source_material
      type: array
      description: References, prior Sparks, Threads, constraints, or fragments to use.
    - name: mode
      type: string
      description: solo-diverge | role-lens | cross-agent-diverge | sameness-check | remix
    - name: role_lenses
      type: array
      description: Optional GameSpec roles or creative viewpoints.
    - name: truth_boundary
      type: string
      description: Must state Spark or Thread; never Candidate or Canon by default.
output:
  format: SPARK_DIVERGENCE record
  sections:
    - Boundary
    - Source Prompt
    - Divergence Passes
    - Sameness Check
    - Frame Challenge
    - Remix Pool
    - Parked And Promoted Fragments
    - Trace And Limits
---

# Spark Divergence

`spark-divergence` is for creative breadth before review. It helps a project
generate options that are structurally different, not just different skins over
the same core.

Use it when:

- early ideas feel too similar;
- one agent keeps converging on safe or familiar shapes;
- the user asks for stronger, broader, stranger, or more multi-perspective
  directions;
- reference works need to become reusable design principles;
- a Spark needs a concrete player-action layer before it can become a Thread.

Do not use it as:

- Candidate Review;
- Admission Review;
- canon acceptance;
- implementation readiness evidence;
- proof of independent validation.

## Procedure

1. State the truth boundary. The output remains Spark or Thread material unless
   the user explicitly promotes it later.
2. Generate divergent options. Require differences in world engine, player
   action, conflict source, and long-horizon consequence, not just theme or job
   labels.
3. Run a sameness check. Group options that share the same core and mark them as
   duplicates, variants, or genuinely distinct.
4. Challenge the frame. Name assumptions the prompt smuggles in and what would
   change if each assumption were false.
5. Remix after checking sameness. Combine strong fragments only after the pool
   has enough contrast.
6. Park generously. A parked fragment is preserved for later, not failed.
7. Trace contributors. Record which agent, role lens, or pass produced each
   option and where it was remixed, parked, or rejected.

## Quality Checks

- Every promoted Spark should have a distinct core engine.
- At least one concrete player action should appear before a direction becomes
  a Thread candidate.
- Cross-links should not force all ideas into one fate-bound mainline.
- If multiple agents or role lenses were used, record the model or role limit:
  agreement across lenses is not independent validation.
