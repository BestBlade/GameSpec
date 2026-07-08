# Getting Started

GameSpec can help in two different situations:

- You have a new game idea and want to decide whether it deserves commitment.
- You already have a game project and want a stable way to govern design truth with AI agents.

## New Idea

Start light.

1. Capture raw material as Sparks: references, questions, mechanics, scenes, mood, constraints, or contradictions.
2. If the first ideas feel narrow, use Spark Divergence to generate, compare,
   challenge, and remix multiple directions without choosing too early.
3. Explore promising lines as Threads.
4. Promote only consequential directions to Candidates.
5. Use Admission Review when the direction would create a project, change investment level, or cause a major pivot.
6. Accept Canon only after human confirmation and review evidence.

The important rule is simple:

```text
Ideas can stay cheap. Canon must be earned.
```

## Existing Project

Start with the stable core install. It gives the project a small contract without installing beta workflows or runtime entrypoints.

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --format json --out .\gamespec-install-plan.json
.\node_modules\.bin\gamespec-execute-install.cmd --plan .\gamespec-install-plan.json --format markdown
```

Review the dry-run output. If the plan is correct, run the executor with `--write`.

Then inspect project state:

```powershell
.\node_modules\.bin\gamespec-status.cmd --project <project-root> --format markdown
.\node_modules\.bin\gamespec-decision-pack.cmd --project <project-root> --format markdown
```

## Choose A Profile

Use the smallest install surface that solves the current problem.

| Need | Profile |
| --- | --- |
| Basic project contract | `stable-core` |
| Beta method assets, templates, roles, and workflows | `kernel-beta` |
| Beta method assets plus agent entrypoints | `full-beta` |

`full-beta` uses `--runtime-host auto` by default. It only installs runtime entrypoints for host directories that already exist in the target project.

## What To Avoid

Do not turn every idea into canon. Do not let an agent write project truth just because a conversation sounded confident. Do not install every runtime host unless the project actually uses those hosts.
