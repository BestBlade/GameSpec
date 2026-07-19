# Installation

GameSpec is currently consumed from the GitHub source package.

Use a separate runner project so the product package, target game project, and development checkout stay independent.

```powershell
mkdir .\gamespec-runner
cd .\gamespec-runner
npm init -y
npm install --ignore-scripts --no-audit --no-fund git+https://github.com/BestBlade/GameSpec.git
```

## Stable Core

Plan the default install:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --format json --out .\gamespec-install-plan.json
```

Dry-run the executor:

```powershell
.\node_modules\.bin\gamespec-execute-install.cmd --plan .\gamespec-install-plan.json --format markdown
```

Write only after review:

```powershell
.\node_modules\.bin\gamespec-execute-install.cmd --plan .\gamespec-install-plan.json --format markdown --write
```

## Profiles

| Profile | Kernel assets | Runtime entrypoints |
| --- | --- | --- |
| `stable-core` | Stable contract only | None |
| `kernel-beta` | Full beta method surface | None |
| `full-beta` | Full beta method surface | Auto-selected by default |

## Runtime Hosts

Runtime entrypoints make GameSpec visible to agent hosts. They are optional.

Use auto-selection:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface all --profile full-beta --runtime-host auto --format markdown
```

Install only Codex entrypoints:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface runtime --profile full-beta --runtime-host codex --format markdown
```

Install all supported runtime entrypoints deliberately:

```powershell
.\node_modules\.bin\gamespec-plan-install.cmd --project <project-root> --surface runtime --profile full-beta --runtime-host all --format markdown
```

## Optional Cross-Agent Hooks

Host hooks are installed globally as silent dispatchers, but they do nothing
unless the current repository has explicitly opted in. Configure the project
first, using `ask` as the recommended single-user default:

```powershell
.\node_modules\.bin\gamespec-hooks.cmd configure --project-root <project-root> --mode ask
.\node_modules\.bin\gamespec-hooks.cmd install --target both
```

If the local auxiliary host is authenticated through environment variables,
name only the required variables explicitly. GameSpec never forwards secrets by
default:

```powershell
.\node_modules\.bin\gamespec-hooks.cmd configure --project-root <project-root> --mode ask --pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
```

`ask` makes an eligible GameSpec Explore turn ask whether to work solo, through
role lenses, or through cross-agent divergence. `auto` creates a file-coupled
request only for an explicit Spark Divergence or multi-agent creative request.
The primary agent follows the injected `run-request` command in the same task:
Codex routes to Claude, and Claude routes to Codex. Hooks stay below 30 seconds
and never launch a long model process. Ordinary conversations and ordinary
explore turns remain silent.

Hooks cover Explore E1 one-shot requests. They do not silently promote an
ordinary Explore turn into a multi-round Explore E2 session. Start Creative
Studio explicitly when the user or primary agent has a concrete reason to
preserve attention across several bounded creative actions:

```powershell
.\node_modules\.bin\gamespec-creative-studio.cmd start --project-root <project-root> --project-id <id> --prompt "<creative question>" --context-file <project-relative-file> --action diverge --max-rounds 3 --json
```

The session is stored locally under `gamespec/.runtime/creative-studio/` and
uses the configured cross-agent peer for each round. Changing selected context
stops the session until a reason-bound reopen.

Cross-agent artifacts are local runtime evidence under
`gamespec/.runtime/cross-agent/`. The auxiliary agent cannot read the repository
or write project truth; Claude packet-only invocation also disables `Task` so it
cannot delegate around the tool boundary. The primary agent must complete `selection.md` before
the run is complete. Promotion into `gamespec/projects/` remains an explicit user
decision.

Codex user-level hooks must be trusted in Codex Settings after installation.
Stop on either host writes durable pending state and returns a continuation block until
`check-request` succeeds; the block asks Codex to keep working rather than
rejecting the user's turn. Evidence-check exceptions fail closed with the same
continuation behavior.

## Safety

Install planning is read-only. Execution is dry-run by default. Existing differing product-managed files block broad install and should be reviewed through install drift and sync commands.
