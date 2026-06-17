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

## Safety

Install planning is read-only. Execution is dry-run by default. Existing differing product-managed files block broad install and should be reviewed through install drift and sync commands.
