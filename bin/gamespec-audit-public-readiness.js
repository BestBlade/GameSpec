#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec public readiness audit

Usage:
  node bin/gamespec-audit-public-readiness.js --project <project-root> [--project-id <id>] [--root <package-root>] [--out <path>] [--format markdown|json] [--timeout-ms <ms>] [--workdir <path>] [--keep-workdir] [--skip-release]

Rules:
  - Read-only.
  - Runs package, CLI smoke, pack-install, release, and installed-project readiness audits.
  - Use --skip-release when running from an installed package where source git push readiness is not assessable.
  - Treats target-project approval as a human decision, not as unattended completion.
  - Writes reports only outside the target project.
  - Does not push, publish, tag, approve, sync, or write target project files.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    format: "markdown",
    root: resolvePackageRootFromBin(import.meta.url),
    timeoutMs: 30000,
    keepWorkdir: false,
    remote: "origin",
    branch: "master",
    skipRelease: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--project-id") {
      args.projectId = argv[++i];
    } else if (arg === "--root") {
      args.root = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--workdir") {
      args.workdir = argv[++i];
    } else if (arg === "--keep-workdir") {
      args.keepWorkdir = true;
    } else if (arg === "--remote") {
      args.remote = argv[++i];
    } else if (arg === "--branch") {
      args.branch = argv[++i];
    } else if (arg === "--skip-release") {
      args.skipRelease = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.project) {
    console.error("Missing --project <project-root>.");
    usage(1);
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${args.timeoutMs}`);
  }
  return args;
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function byteLength(text) {
  return Buffer.byteLength(text ?? "", "utf8");
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./\\:-]+$/u.test(text)) return text;
  return `"${text.replace(/(["^&|<>])/gu, "^$1")}"`;
}

function runCommand(command, args, options) {
  const spawnCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
  const spawnArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")]
    : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    ...options,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stdoutBytes: byteLength(result.stdout),
    stderrBytes: byteLength(result.stderr),
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error ? (result.error.code ?? result.error.message) : null
  };
}

function createScratch(args) {
  const base = args.workdir ? normalizePath(args.workdir) : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, "gamespec-public-readiness-"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function runAudit(root, reportsRoot, id, scriptName, scriptArgs, timeoutMs) {
  const outPath = path.join(reportsRoot, `${id}.json`);
  const scriptPath = path.join(root, "bin", scriptName);
  const args = [scriptPath, ...scriptArgs, "--format", "json", "--out", outPath];
  const spawnResult = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true
  });
  const result = {
    exitCode: spawnResult.status ?? null,
    signal: spawnResult.signal ?? null,
    stdout: spawnResult.stdout ?? "",
    stderr: spawnResult.stderr ?? "",
    stdoutBytes: byteLength(spawnResult.stdout),
    stderrBytes: byteLength(spawnResult.stderr),
    timedOut: spawnResult.error?.code === "ETIMEDOUT",
    error: spawnResult.error ? (spawnResult.error.code ?? spawnResult.error.message) : null
  };
  const data = readJsonIfExists(outPath);
  return {
    id,
    scriptName,
    reportPath: outPath,
    reportRelativePath: toPosix(path.relative(reportsRoot, outPath)),
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    timedOut: result.timedOut,
    error: result.error,
    stderrPreview: result.stderr.slice(0, 500),
    data,
    issues: [
      ...(result.error ? [`spawn_error:${result.error}`] : []),
      ...(!data ? ["report_missing"] : [])
    ]
  };
}

function auditState(run) {
  return run.data?.state ?? run.data?.status ?? (run.exitCode === 0 ? "pass" : "blocked");
}

function isRunBlocked(run) {
  if (run.issues.length > 0) return true;
  const state = auditState(run);
  return state === "blocked" || state === "warnings";
}

function summarizeRun(run) {
  const data = run.data;
  return {
    id: run.id,
    scriptName: run.scriptName,
    report: run.reportRelativePath,
    exitCode: run.exitCode,
    stderrBytes: run.stderrBytes,
    stderrPreview: run.stderrPreview,
    state: auditState(run),
    issues: run.issues,
    packageContext: data?.packageContext ?? null,
    summary: data?.summary ?? null
  };
}

function deriveState(runs, installedProject, skipRelease) {
  const critical = [
    runs.packageReadiness,
    runs.cliSmoke,
    runs.packInstallSmoke,
    ...(skipRelease ? [] : [runs.releaseReadiness]),
    installedProject
  ].filter(Boolean);
  const blocked = critical.filter(isRunBlocked);
  if (blocked.length > 0) return "blocked";

  const flowState = installedProject?.data?.flowState ?? null;
  const prefix = skipRelease ? "installed_ready" : "source_ready";
  if (flowState === "awaiting_approval_record") return `${prefix}_project_approval_required`;
  if (flowState === "ready_for_sync_write") return `${prefix}_project_sync_write_ready`;
  if (flowState === "already_current" || flowState === "no_drift") return `${prefix}_project_current`;
  return `${prefix}_project_review_required`;
}

function requiredHumanDecisions(state, releaseReadiness, installedProject) {
  const decisions = [];
  if (state === "blocked") {
    decisions.push("Resolve blocked readiness checks before push or project apply.");
    return decisions;
  }
  const pushCommand = releaseReadiness.data?.summary?.suggestedPushCommand;
  if (pushCommand) {
    decisions.push(`Decide whether to push the source release with: ${pushCommand}`);
  }
  const handoff = installedProject.data?.handoff;
  if (handoff?.humanDecisionRequired) {
    decisions.push(`Decide whether to approve target-project sync for ${handoff.operationHighlights?.[0]?.targetPath ?? "the reported operation"}.`);
  }
  return decisions;
}

function renderCommandEntries(lines, commands) {
  for (const [name, value] of Object.entries(commands)) {
    lines.push(`- ${name}:`);
    lines.push(`  \`${value}\``);
  }
}

function buildProjectApplyPreflight(handoff) {
  if (!handoff?.available) {
    return {
      available: false,
      status: "missing_handoff",
      reason: "No project handoff was produced by installed project readiness.",
      requiresExplicitApproval: true,
      executionPlanUsable: false,
      commands: null,
      approvalRecordTarget: null,
      candidateApprovalRecordMarkdown: null,
      executionCwd: null,
      suggestedReportPaths: null,
      dryRunRehearsal: null,
      decisionBrief: null,
      shellContextCommands: null,
      operationCount: 0,
      operationTargets: [],
      guardrails: [
        "No project write can be performed from this report."
      ]
    };
  }

  const operationTargets = (handoff.operationHighlights ?? []).map((operation) => operation.targetPath);
  const executionPlanUsable = handoff.executionPlanUsable === true && Boolean(handoff.nextCommands);
  return {
    available: executionPlanUsable,
    status: handoff.status ?? null,
    reason: executionPlanUsable
      ? "Fresh retained handoff contains the approval and sync command sequence."
      : "Rerun public readiness with --keep-workdir before using approval or sync commands.",
    requiresExplicitApproval: true,
    executionPlanUsable,
    approvalRecordTarget: handoff.approvalRecordTarget ?? null,
    approvalReportStatus: handoff.approvalReportStatus ?? null,
    operationCount: operationTargets.length,
    operationTargets,
    operationHighlights: handoff.operationHighlights ?? [],
    candidateApprovalRecordMarkdown: handoff.candidateApprovalRecordMarkdown ?? null,
    executionCwd: executionPlanUsable ? handoff.executionCwd ?? null : null,
    suggestedReportPaths: executionPlanUsable ? handoff.suggestedReportPaths ?? null : null,
    dryRunRehearsal: handoff.dryRunRehearsal ?? null,
    decisionBrief: handoff.decisionBrief ?? null,
    commands: executionPlanUsable ? handoff.nextCommands : null,
    contextCommands: executionPlanUsable ? handoff.contextCommands ?? null : null,
    shellContextCommands: executionPlanUsable ? handoff.shellContextCommands ?? null : null,
    guardrails: [
      "This preflight is read-only.",
      "It is not approval.",
      "Approval record write still requires --write --approve.",
      "Sync write still requires --write --approve and a matching approval report.",
      "Executors re-check source and target hashes before physical writes.",
      "Do not use these commands after the target project or retained reports change."
    ]
  };
}

function buildAudit(args) {
  const root = normalizePath(args.root);
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(root)) throw new Error(`Package root does not exist: ${root}`);
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root does not exist: ${projectRoot}`);

  const scratchRoot = createScratch(args);
  const reportsRoot = path.join(scratchRoot, "reports");
  fs.mkdirSync(reportsRoot, { recursive: true });

  let runs = null;
  try {
    runs = {
      packageReadiness: runAudit(root, reportsRoot, "package-readiness", "gamespec-audit-package-readiness.js", [
        "--root", root,
        ...(args.skipRelease ? ["--installed"] : [])
      ], args.timeoutMs),
      cliSmoke: runAudit(root, reportsRoot, "cli-smoke", "gamespec-audit-cli-smoke.js", [
        "--root", root
      ], args.timeoutMs),
      packInstallSmoke: runAudit(root, reportsRoot, "pack-install-smoke", "gamespec-audit-pack-install-smoke.js", [
        "--root", root,
        "--workdir", path.join(scratchRoot, "pack-install-smoke"),
        ...(args.keepWorkdir ? ["--keep-workdir"] : [])
      ], args.timeoutMs),
      installedProjectReadiness: runAudit(root, reportsRoot, "installed-project-readiness", "gamespec-audit-installed-project-readiness.js", [
        "--root", root,
        "--project", projectRoot,
        ...(args.projectId ? ["--project-id", args.projectId] : []),
        "--workdir", path.join(scratchRoot, "installed-project-readiness"),
        ...(args.keepWorkdir ? ["--keep-workdir"] : [])
      ], args.timeoutMs),
      ...(args.skipRelease
        ? {}
        : {
            releaseReadiness: runAudit(root, reportsRoot, "release-readiness", "gamespec-audit-release-readiness.js", [
              "--root", root,
              "--remote", args.remote,
              "--branch", args.branch
            ], args.timeoutMs)
          })
    };

    const state = deriveState(runs, runs.installedProjectReadiness, args.skipRelease);
    const release = runs.releaseReadiness?.data ?? null;
    const installed = runs.installedProjectReadiness.data;
    const handoff = installed?.handoff ?? null;
    const projectApplyPreflight = buildProjectApplyPreflight(handoff);

    return {
      generated: new Date().toISOString(),
      mode: "public_readiness_audit_read_only",
      root,
      projectRoot,
      projectId: installed?.projectId ?? args.projectId ?? null,
      state,
      scratch: {
        root: scratchRoot,
        kept: args.keepWorkdir,
        reportsRoot,
        reportsRetained: args.keepWorkdir
      },
      summary: {
        sourceReleaseChecked: !args.skipRelease,
        sourcePushReady: args.skipRelease ? null : release?.state === "ready_for_git_push",
        npmPublishReady: release?.package?.npmPublishReady ?? false,
        packageReady: runs.packageReadiness.data?.state === "pass",
        cliSmokeReady: runs.cliSmoke.data?.state === "pass",
        packInstallReady: runs.packInstallSmoke.data?.state === "pass",
        installedProjectReady: installed?.state === "pass",
        projectFlowState: installed?.flowState ?? null,
        projectGitUnchanged: installed?.projectGitStatus?.unchanged ?? null,
        projectHandoffAvailable: handoff?.available ?? false,
        projectExecutionPlanUsable: handoff?.executionPlanUsable ?? false,
        requiredHumanDecisions: requiredHumanDecisions(state, release ? runs.releaseReadiness : { data: null }, runs.installedProjectReadiness)
      },
      sourceRelease: {
        checked: !args.skipRelease,
        state: args.skipRelease ? "skipped" : release?.state ?? null,
        note: args.skipRelease ? "Skipped because this audit is running from an installed package or runner context." : null,
        remoteUrl: release?.git?.remoteUrl ?? null,
        publicStatusEntries: release?.git?.publicStatus?.length ?? null,
        packMetaIncluded: release?.pack?.metaIncluded ?? null,
        suggestedPushCommand: release?.summary?.suggestedPushCommand ?? null
      },
      projectHandoff: handoff
        ? {
            status: handoff.status,
            humanDecisionRequired: handoff.humanDecisionRequired,
            recommendedDecision: handoff.recommendedDecision,
            approvalRecordTarget: handoff.approvalRecordTarget,
            executionPlanUsable: handoff.executionPlanUsable,
            executionCwd: handoff.executionCwd,
            suggestedReportPaths: handoff.suggestedReportPaths,
            contextCommands: handoff.contextCommands,
            shellContextCommands: handoff.shellContextCommands,
            dryRunRehearsal: handoff.dryRunRehearsal,
            decisionBrief: handoff.decisionBrief,
            operationHighlights: handoff.operationHighlights,
            snapshotWarning: handoff.snapshotWarning
          }
        : null,
      projectApplyPreflight,
      runs: Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, summarizeRun(value)])),
      guardrails: [
        "Read-only public readiness audit.",
        "Runs existing read-only package and project audits rather than inventing separate proof.",
        "Does not push to remote.",
        "Does not publish to npm.",
        "Does not write approval records or sync files into the target project.",
        "Treats target-project approval as a required human decision."
      ]
    };
  } finally {
    if (!args.keepWorkdir) {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Public Readiness Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Package root: \`${audit.root}\``);
  lines.push(`Project root: \`${audit.projectRoot}\``);
  lines.push(`Project id: \`${audit.projectId ?? "unknown"}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Source release checked: ${audit.summary.sourceReleaseChecked}`);
  lines.push(`- Source push ready: ${audit.summary.sourcePushReady}`);
  lines.push(`- NPM publish ready: ${audit.summary.npmPublishReady}`);
  lines.push(`- Package ready: ${audit.summary.packageReady}`);
  lines.push(`- CLI smoke ready: ${audit.summary.cliSmokeReady}`);
  lines.push(`- Pack install ready: ${audit.summary.packInstallReady}`);
  lines.push(`- Installed project ready: ${audit.summary.installedProjectReady}`);
  lines.push(`- Project flow state: \`${audit.summary.projectFlowState ?? "missing"}\``);
  lines.push(`- Project git unchanged: ${audit.summary.projectGitUnchanged}`);
  lines.push(`- Project handoff available: ${audit.summary.projectHandoffAvailable}`);
  lines.push(`- Project execution plan usable: ${audit.summary.projectExecutionPlanUsable}`);
  lines.push(`- Scratch kept: ${audit.scratch.kept}`);
  lines.push("");

  if (audit.summary.requiredHumanDecisions.length > 0) {
    lines.push("## Required Human Decisions");
    lines.push("");
    for (const decision of audit.summary.requiredHumanDecisions) lines.push(`- ${decision}`);
    lines.push("");
  }

  lines.push("## Source Release");
  lines.push("");
  lines.push(`- Checked: ${audit.sourceRelease.checked}`);
  lines.push(`- State: \`${audit.sourceRelease.state ?? "missing"}\``);
  if (audit.sourceRelease.note) lines.push(`- Note: ${audit.sourceRelease.note}`);
  lines.push(`- Remote URL: \`${audit.sourceRelease.remoteUrl ?? "missing"}\``);
  lines.push(`- Public status entries: ${audit.sourceRelease.publicStatusEntries ?? "missing"}`);
  lines.push(`- Pack .meta included: ${audit.sourceRelease.packMetaIncluded ?? "missing"}`);
  lines.push(`- Suggested push: \`${audit.sourceRelease.suggestedPushCommand ?? "not ready"}\``);
  lines.push("");

  if (audit.projectHandoff) {
    lines.push("## Project Handoff");
    lines.push("");
    lines.push(`- Status: \`${audit.projectHandoff.status ?? "missing"}\``);
    lines.push(`- Human decision required: ${audit.projectHandoff.humanDecisionRequired}`);
    lines.push(`- Recommended decision: ${audit.projectHandoff.recommendedDecision ?? "missing"}`);
    lines.push(`- Approval record target: \`${audit.projectHandoff.approvalRecordTarget ?? "missing"}\``);
    lines.push(`- Execution plan usable: ${audit.projectHandoff.executionPlanUsable}`);
    lines.push(`- Execution cwd: \`${audit.projectHandoff.executionCwd ?? "missing"}\``);
    lines.push(`- Approval write report: \`${audit.projectHandoff.suggestedReportPaths?.approvalWriteReport ?? "missing"}\``);
    lines.push(`- Sync write report: \`${audit.projectHandoff.suggestedReportPaths?.syncWriteReport ?? "missing"}\``);
    if (audit.projectHandoff.dryRunRehearsal) {
      lines.push(`- Dry-run approval exits zero: ${audit.projectHandoff.dryRunRehearsal.commandsExitZero.approvalDryRun}`);
      lines.push(`- Dry-run sync exits zero: ${audit.projectHandoff.dryRunRehearsal.commandsExitZero.syncDryRun}`);
      lines.push(`- Dry-run post-check exits zero: ${audit.projectHandoff.dryRunRehearsal.commandsExitZero.postCheck}`);
    }
    if (audit.projectHandoff.decisionBrief) {
      lines.push(`- Decision scope: \`${audit.projectHandoff.decisionBrief.scope}\``);
      lines.push(`- Targets outside project truth: ${audit.projectHandoff.decisionBrief.allTargetsOutsideProjectTruth}`);
      lines.push(`- Whitespace-equivalent operations: ${audit.projectHandoff.decisionBrief.allOperationsWhitespaceEquivalent}`);
      lines.push(`- Dry-run rehearsal passed: ${audit.projectHandoff.decisionBrief.dryRunRehearsalPassed}`);
    }
    lines.push(`- Snapshot warning: ${audit.projectHandoff.snapshotWarning ?? "missing"}`);
    if (audit.projectHandoff.shellContextCommands?.powershell) {
      lines.push("");
      lines.push("### PowerShell Context Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectHandoff.shellContextCommands.powershell);
    }
    if (audit.projectHandoff.shellContextCommands?.cmd) {
      lines.push("");
      lines.push("### Cmd Context Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectHandoff.shellContextCommands.cmd);
    }
    if (audit.projectHandoff.operationHighlights?.length > 0) {
      lines.push("");
      lines.push("### Operation Highlights");
      lines.push("");
      for (const operation of audit.projectHandoff.operationHighlights) {
        lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
        lines.push(`  - status: \`${operation.status}\``);
        if (operation.reason) lines.push(`  - reason: \`${operation.reason}\``);
        lines.push(`  - same ignoring trailing whitespace: ${operation.sameIgnoringTrailingWhitespace}`);
        lines.push(`  - same ignoring all whitespace: ${operation.sameIgnoringAllWhitespace}`);
        if (operation.firstDifferingLine) {
          lines.push(`  - first differing line: ${operation.firstDifferingLine.line}`);
          lines.push(`  - source line: \`${operation.firstDifferingLine.source ?? ""}\``);
          lines.push(`  - target line: \`${operation.firstDifferingLine.target ?? ""}\``);
        }
      }
    }
    lines.push("");
  }

  if (audit.projectApplyPreflight) {
    lines.push("## Project Apply Preflight");
    lines.push("");
    lines.push(`- Available: ${audit.projectApplyPreflight.available}`);
    lines.push(`- Status: \`${audit.projectApplyPreflight.status ?? "missing"}\``);
    lines.push(`- Reason: ${audit.projectApplyPreflight.reason}`);
    lines.push(`- Requires explicit approval: ${audit.projectApplyPreflight.requiresExplicitApproval}`);
    lines.push(`- Execution plan usable: ${audit.projectApplyPreflight.executionPlanUsable}`);
    lines.push(`- Execution cwd: \`${audit.projectApplyPreflight.executionCwd ?? "missing"}\``);
    lines.push(`- Approval write report: \`${audit.projectApplyPreflight.suggestedReportPaths?.approvalWriteReport ?? "missing"}\``);
    lines.push(`- Sync write report: \`${audit.projectApplyPreflight.suggestedReportPaths?.syncWriteReport ?? "missing"}\``);
    if (audit.projectApplyPreflight.dryRunRehearsal) {
      lines.push(`- Dry-run approval exits zero: ${audit.projectApplyPreflight.dryRunRehearsal.commandsExitZero.approvalDryRun}`);
      lines.push(`- Dry-run sync exits zero: ${audit.projectApplyPreflight.dryRunRehearsal.commandsExitZero.syncDryRun}`);
      lines.push(`- Dry-run post-check exits zero: ${audit.projectApplyPreflight.dryRunRehearsal.commandsExitZero.postCheck}`);
    }
    if (audit.projectApplyPreflight.decisionBrief) {
      lines.push(`- Decision scope: \`${audit.projectApplyPreflight.decisionBrief.scope}\``);
      lines.push(`- Targets outside project truth: ${audit.projectApplyPreflight.decisionBrief.allTargetsOutsideProjectTruth}`);
      lines.push(`- Whitespace-equivalent operations: ${audit.projectApplyPreflight.decisionBrief.allOperationsWhitespaceEquivalent}`);
      lines.push(`- Dry-run rehearsal passed: ${audit.projectApplyPreflight.decisionBrief.dryRunRehearsalPassed}`);
    }
    lines.push(`- Approval report: \`${audit.projectApplyPreflight.approvalReportStatus ?? "missing"}\``);
    lines.push(`- Approval record target: \`${audit.projectApplyPreflight.approvalRecordTarget ?? "missing"}\``);
    lines.push(`- Operation count: ${audit.projectApplyPreflight.operationCount}`);
    if (audit.projectApplyPreflight.operationTargets.length > 0) {
      for (const target of audit.projectApplyPreflight.operationTargets) {
        lines.push(`- Operation target: \`${target}\``);
      }
    }
    if (audit.projectApplyPreflight.commands) {
      lines.push("");
      lines.push("### Preflight Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectApplyPreflight.commands);
    }
    if (audit.projectApplyPreflight.shellContextCommands?.powershell) {
      lines.push("");
      lines.push("### PowerShell Context Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectApplyPreflight.shellContextCommands.powershell);
    }
    if (audit.projectApplyPreflight.shellContextCommands?.cmd) {
      lines.push("");
      lines.push("### Cmd Context Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectApplyPreflight.shellContextCommands.cmd);
    }
    if (audit.projectApplyPreflight.contextCommands) {
      lines.push("");
      lines.push("### Legacy Context Commands");
      lines.push("");
      renderCommandEntries(lines, audit.projectApplyPreflight.contextCommands);
    }
    if (audit.projectApplyPreflight.candidateApprovalRecordMarkdown) {
      lines.push("");
      lines.push("### Candidate Approval Record");
      lines.push("");
      lines.push("```markdown");
      lines.push(audit.projectApplyPreflight.candidateApprovalRecordMarkdown.trimEnd());
      lines.push("```");
    }
    lines.push("");
    lines.push("### Preflight Guardrails");
    lines.push("");
    for (const guardrail of audit.projectApplyPreflight.guardrails) lines.push(`- ${guardrail}`);
    lines.push("");
  }

  lines.push("## Audit Runs");
  lines.push("");
  lines.push("| Audit | State | Exit | Report | Issues |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [key, run] of Object.entries(audit.runs)) {
    lines.push(`| \`${key}\` | \`${run.state}\` | ${run.exitCode ?? "null"} | \`${run.report}\` | ${run.issues.length === 0 ? "" : run.issues.join(", ")} |`);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of audit.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = normalizePath(args.project);
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write public readiness audit inside target project: ${outPath}`);
    }
  }

  const audit = buildAudit(args);
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
  if (audit.state === "blocked") process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-public-readiness: ${error.message}`);
  process.exit(1);
}
