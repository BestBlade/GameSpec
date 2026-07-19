# GameSpec

GameSpec is a memory and decision layer for AI-assisted game creation.

It helps a game project keep rough ideas light, canon protected, producer decisions explicit, and implementation handoffs traceable across long conversations with agents.

## Why It Exists

AI can generate game design material quickly. The hard part is keeping the project stable after many sessions, pivots, reviews, and implementation attempts.

GameSpec gives the project a durable place to answer:

- What is only an idea?
- What is being explored?
- What is ready for review?
- What is accepted canon?
- What evidence supports a decision?
- What can engineering safely consume?

## Core Model

GameSpec separates creative motion from project truth:

```text
Spark -> Thread -> Candidate -> Canon
```

| State | Meaning |
| --- | --- |
| Spark | A raw idea, question, reference, line, mechanic, mood, or maybe-later fragment. |
| Thread | A longer exploration path that can branch, contradict itself, or fail. |
| Candidate | A design direction that may affect project truth, implementation cost, or downstream dependencies. |
| Canon | Accepted project truth with explicit review, decision, and evidence. |

Sparks may use multi-agent divergence to widen the idea pool before commitment.
That is not review evidence and does not make the strongest spark canon; it is a
way to generate, compare, remix, and park options while they are still cheap.

For high-value questions that need more than one pass, GameSpec v0.6 adds an
optional Creative Studio:

```text
Expander -> Frame Breaker -> Deepener -> Curator -> human choice
```

The Studio preserves selected context, per-round identity, surviving fragments,
parked material, and reopen reasons across interruptions. It ends in a curation
map, not an automatic winner, acceptance verdict, or project-truth write.

GameSpec also separates reusable method from project-owned truth:

| Layer | Owned By | Purpose |
| --- | --- | --- |
| Kernel | GameSpec | Stable method, contracts, review language, templates, and workflows. |
| Runtime entrypoints | GameSpec | Optional host-specific entrypoints for agent tools. |
| Overlay | Project or producer | Optional taste, genre, or project-specific judging principles. |
| Project truth | Target project | The actual game design state, decisions, reviews, archives, and implementation handoffs. |

The project owns canon. GameSpec installs method and entrypoints, but it must not silently rewrite project truth.

## Main Workflows

### Start With A New Idea

Use creative capture first. Keep raw material cheap until the idea is ready for a real commitment gate.

When a single agent is not producing enough variety, use Spark Divergence:
separate agents or role lenses generate options, run sameness checks, challenge
the frame, and remix promising fragments. Keep the result in Sparks or Threads
until a human explicitly promotes a direction.

Choose the lightest creative density that helps:

| Explore density | Use |
| --- | --- |
| E0 | Ordinary exploratory conversation; no runtime artifact required. |
| E1 | One-shot Spark Divergence using solo passes, role lenses, or a peer agent. |
| E2 | Bounded, resumable Creative Studio for a question that needs several purposeful passes. |

These are Explore-density labels, not the existing GameSpec L0-L3 role
permissions. Ordinary brainstorming remains Explore E0. Project hooks support
explicit Explore E1 requests; Explore E2 starts deliberately through the
Studio CLI.

Optional project-scoped host hooks can automate this divergence without making
every conversation multi-agent. Install the global dispatcher once, then opt in
per project with `ask` (recommended) or `auto`:

```powershell
gamespec-hooks configure --project-root <project-root> --mode ask
gamespec-hooks install --target both
```

The dispatcher routes Codex to Claude and Claude to Codex. It writes a
session-scoped request and injects `run-request` / `check-request`; the primary
agent executes the peer CLI in the same task. Hooks never run a long model
process. The auxiliary output and the primary agent's selection record stay under
`gamespec/.runtime/cross-agent/`. They are traceable but non-canon; the user must
explicitly promote any surviving fragment into a project Spark.

An Explore E2 Studio session is also local and non-canon:

```powershell
gamespec-creative-studio start --project-root <project-root> --project-id <id> --prompt "<creative question>" --context-file <project-relative-file> --action diverge --max-rounds 3 --json
gamespec-creative-studio run --project-root <project-root> --session <session-id> --json
```

After the primary agent completes every generated `selection.md` row, it can
advance with a purposeful next action (`counterframe`, `deepen`,
`cross-pollinate`, or `contrast`) or finish with `curate` / `park`. The resulting
`curation.md` routes the next choice to the human.

Admission Review is the heavier step: it asks whether a game direction deserves project-level commitment. It is meant for new project admission, major pivots, or serious re-greenlight checks.

### Adopt An Existing Project

Install the stable core contract, inspect current project state, then decide what should become governed project truth. Existing projects do not need to pass Admission Review before adoption, but they can request it later as a health check.

### Move Toward Implementation

GameSpec should not let implementation reinterpret game truth. A design should become an implementation handoff only after intent, dependencies, review state, and acceptance criteria are clear enough for downstream work.

### Check Change Structure

Docs-backed change records can be checked without requiring OpenSpec:

```powershell
.\node_modules\.bin\gamespec-check.cmd <change-id-or-path> --project <project-root> --phase proposal --format markdown
```

The checker validates structure only. It does not prove semantic correctness, independent review, implementation readiness, or canon acceptance.

### Use The Capability Lane Only When Needed

High-uncertainty work can add optional records such as a direction map, evidence contract, selection findings, and a conditional Mainline Decision section. These records are for meaningful forks, evidence risk, or high-impact direction choices. Routine creative capture should stay light.

## Install Profiles

The default install profile is intentionally small:

| Profile | Behavior |
| --- | --- |
| `stable-core` | Installs only `gamespec/config.yaml`, `gamespec/AGENTS.md`, and `gamespec/install-surface.json`. |
| `kernel-beta` | Installs the full beta method surface without runtime entrypoints. |
| `full-beta` | Enables beta runtime entrypoints; host selection defaults to `auto`, so only existing host directories receive entrypoints. |

Runtime hosts can also be selected explicitly with `--runtime-host codex`, `--runtime-host claude,codex`, or `--runtime-host all`.

## Quick Start

Install from the GitHub source into a separate runner project:

```powershell
mkdir .\gamespec-runner
cd .\gamespec-runner
npm init -y
npm install --ignore-scripts --no-audit --no-fund git+https://github.com/BestBlade/GameSpec.git
```

Plan a stable-core install into a game project:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --format json --out .\gamespec-install-plan.json
.\node_modules\.bin\gamespec-execute-install.cmd --plan .\gamespec-install-plan.json --format markdown
```

The executor is dry-run by default. Add `--write` only after reviewing the plan.

Inspect an existing project:

```powershell
.\node_modules\.bin\gamespec-status.cmd --project <project-root> --format markdown
.\node_modules\.bin\gamespec-decision-pack.cmd --project <project-root> --format markdown
```

Plan beta method assets without runtime entrypoints:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --profile kernel-beta --format markdown
```

Plan beta method assets with auto-selected runtime entrypoints:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --profile full-beta --runtime-host auto --format markdown
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Core Concepts](docs/concepts.md)
- [Installation](docs/installation.md)
- [Workflows](docs/workflows.md)
- [CLI Reference](docs/cli-reference.md)
- [Maintainer Guide](docs/maintainer-guide.md)

## Safety Defaults

GameSpec prefers reversible, inspectable steps:

- planning before writes
- dry-run execution by default
- explicit profile selection for beta surfaces
- runtime entrypoint auto-detection instead of blanket host installation
- protected project truth under `gamespec/projects/`
- finite, stale-aware Creative Studio sessions that stop for human choice
- package self-governance records excluded from release artifacts

## License

GameSpec is released under the [MIT License](LICENSE).
