# CLI Reference

GameSpec currently exposes granular commands. Most commands are planners, audits, or narrow executors.

Planner commands are read-only. Executors are dry-run by default unless documented otherwise.

## Structure Checks

| Command | Purpose |
| --- | --- |
| `gamespec-check` | Check docs-mode change structure and optional capability-lane records. It validates structure, not design truth. |

## Installation

| Command | Purpose |
| --- | --- |
| `gamespec-plan-install` | Plan product-managed kernel/runtime installation into a target project. |
| `gamespec-execute-install` | Execute an install plan; dry-run unless `--write` is provided. |
| `gamespec-audit-install-drift` | Explain differing product-managed install targets. |
| `gamespec-plan-install-sync` | Convert reviewed drift into sync candidates. |
| `gamespec-plan-install-sync-approval` | Plan a project-local approval record for install sync. |
| `gamespec-execute-install-sync-approval-plan` | Write the planned approval record under explicit approval. |
| `gamespec-execute-install-sync-plan` | Apply an approved install sync plan with hash guards. |
| `gamespec-report-install-sync-apply-readiness` | Report whether install sync is ready, blocked, or awaiting approval. |

## Project Understanding

| Command | Purpose |
| --- | --- |
| `gamespec-status` | Read project state and report attention, active driver, parked work, and next safe action. |
| `gamespec-decision-pack` | Build a producer decision pack from status evidence. |
| `gamespec-impact` | Report impact across project documents from a proposed decision or update context. |

## Decision And Review

| Command | Purpose |
| --- | --- |
| `gamespec-plan-decision-record` | Plan a decision record from a decision pack. |
| `gamespec-execute-decision-record-plan` | Write the planned decision record under explicit approval. |
| `gamespec-plan-project-update` | Build a read-only project update plan. |
| `gamespec-plan-project-patch` | Convert an update plan into reviewable patch proposals. |
| `gamespec-check-project-patch-readiness` | Check readiness before project patch writes. |
| `gamespec-execute-project-patch-plan` | Apply an approved project patch plan with guards. |
| `gamespec-plan-post-patch-recheck` | Plan a follow-up recheck after patch evidence. |
| `gamespec-plan-review-document` | Prepare a candidate review document. |
| `gamespec-execute-review-document-plan` | Write the planned review artifact under explicit approval. |
| `gamespec-plan-workflow-state-update` | Plan an active-state transition after review evidence. |
| `gamespec-execute-workflow-state-update-plan` | Apply the planned active-state transition with guards. |

## Cross-Agent Spark Divergence

| Command | Purpose |
| --- | --- |
| `gamespec-hooks` | Configure project opt-in and install, inspect, or remove host lifecycle dispatchers. |
| `gamespec-cross-agent` | Run direct or file-coupled opposite-peer divergence and verify the latest primary selection. |
| `gamespec-audit-cross-agent-hooks` | Prove hook merge safety, activation boundaries, trace artifacts, and selection gating in isolation. |

## Product And Surface Audits

| Command | Purpose |
| --- | --- |
| `gamespec-audit-package-readiness` | Check package metadata, public hygiene, scripts, and ignored self-governance records. |
| `gamespec-audit-cli-smoke` | Run every package bin command with `--help`. |
| `gamespec-audit-pack-install-smoke` | Pack, install, and smoke-test the package in an isolated scratch project. |
| `gamespec-audit-installed-project-readiness` | Install the package into an isolated runner and inspect a target project read-only. |
| `gamespec-audit-release-readiness` | Check source repository readiness for a guarded GitHub push. |
| `gamespec-audit-public-readiness` | Roll up package, release, install, and target-project handoff readiness. |
| `gamespec-audit-core-install-surface` | Audit installed kernel/runtime surface structure. |
| `gamespec-audit-held-surfaces` | Audit held role/template surfaces before import. |
| `gamespec-filter-by-surface-audit` | Filter copy manifests by surface audit results. |

## Extraction Utilities

| Command | Purpose |
| --- | --- |
| `gamespec-classify` | Classify an existing GameSpec-like project surface. |
| `gamespec-plan-extraction` | Build a read-only extraction plan. |
| `gamespec-build-copy-manifest` | Build a candidate copy manifest. |
| `gamespec-review-copy-manifest` | Review copy manifest admission. |
| `gamespec-filter-copy-manifest` | Filter a copy manifest to approved surfaces. |
| `gamespec-execute-copy-manifest` | Execute approved manifest copies with guards. |
