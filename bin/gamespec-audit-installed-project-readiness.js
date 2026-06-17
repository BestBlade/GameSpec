#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec installed project readiness audit

Usage:
  node bin/gamespec-audit-installed-project-readiness.js --project <project-root> [--project-id <id>] [--root <package-root>] [--out <path>] [--format markdown|json] [--timeout-ms <ms>] [--workdir <path>] [--keep-workdir]

Rules:
  - Read-only against the target project.
  - Packs and installs GameSpec into an isolated runner.
  - Runs installed node_modules/.bin commands against the target project.
  - Writes reports only in scratch or requested output outside the target project.
  - Verifies target project git status is unchanged when git is available.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    format: "markdown",
    root: resolvePackageRootFromBin(import.meta.url),
    timeoutMs: 30000,
    keepWorkdir: false
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

function runNpm(args, cwd, timeoutMs) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(command, args, { cwd, timeout: timeoutMs });
}

function createScratch(args) {
  const base = args.workdir ? normalizePath(args.workdir) : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, "gamespec-installed-project-"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parsePackJson(stdout) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --json returned no package entries.");
  }
  return parsed[0];
}

function resolvePackedTarball(scratchRoot, packInfo) {
  const filename = packInfo.filename ?? packInfo.name;
  if (!filename) throw new Error("npm pack result has no filename.");
  return path.isAbsolute(filename) ? filename : path.join(scratchRoot, filename);
}

function installedShimPath(runnerRoot, name) {
  const shimBase = path.join(runnerRoot, "node_modules", ".bin", name);
  return process.platform === "win32" && fs.existsSync(`${shimBase}.cmd`)
    ? `${shimBase}.cmd`
    : shimBase;
}

function runInstalledShim(runnerRoot, name, args, timeoutMs) {
  const shimPath = installedShimPath(runnerRoot, name);
  if (!fs.existsSync(shimPath)) {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      timedOut: false,
      error: "shim_missing"
    };
  }
  return runCommand(shimPath, args, { cwd: runnerRoot, timeout: timeoutMs });
}

function pathIncludesNodeModulesPackage(inputPath) {
  const normalized = inputPath.split(path.sep).join("/");
  return /\/node_modules\/gamespec$/u.test(normalized) || normalized.endsWith("node_modules/gamespec");
}

function gitStatus(projectRoot, timeoutMs) {
  const result = runCommand("git", ["status", "--short", "--branch"], { cwd: projectRoot, timeout: timeoutMs });
  return {
    available: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderrBytes: result.stderrBytes,
    error: result.error
  };
}

function runStage(stage, runnerRoot, commandName, args, timeoutMs, outputPath, issues) {
  const result = runInstalledShim(runnerRoot, commandName, args, timeoutMs);
  if (result.error) issues.push(`${stage}_spawn_error:${result.error}`);
  if (result.exitCode !== 0) issues.push(`${stage}_nonzero_exit:${result.exitCode ?? "null"}`);
  const data = readJsonIfExists(outputPath);
  if (!data) issues.push(`${stage}_output_missing`);
  return {
    result: {
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      timedOut: result.timedOut,
      error: result.error
    },
    data
  };
}

function summarizeDryRunRehearsal(approvalDryRun, syncDryRun, postCheck) {
  if (!approvalDryRun && !syncDryRun && !postCheck) return null;
  const reviewScoring = (postCheck?.data?.operations ?? []).find((operation) => operation.targetPath === "gamespec/skills/review-scoring.md");
  return {
    commandsExitZero: {
      approvalDryRun: approvalDryRun?.result?.exitCode === 0,
      syncDryRun: syncDryRun?.result?.exitCode === 0,
      postCheck: postCheck?.result?.exitCode === 0
    },
    approval: {
      statusCounts: approvalDryRun?.data?.statusCounts ?? null,
      targetPath: approvalDryRun?.data?.operation?.targetPath ?? null,
      issues: approvalDryRun?.data?.operation?.issues ?? null
    },
    sync: {
      statusCounts: syncDryRun?.data?.statusCounts ?? null,
      operationCount: syncDryRun?.data?.operations?.length ?? null,
      firstTargetPath: syncDryRun?.data?.operations?.[0]?.targetPath ?? null
    },
    postCheck: {
      statusCounts: postCheck?.data?.statusCounts ?? null,
      reviewScoringStatus: reviewScoring?.status ?? null
    }
  };
}

function isProjectTruthTarget(targetPath) {
  return targetPath === "gamespec/projects" || targetPath?.startsWith("gamespec/projects/");
}

function buildDecisionBrief(status, recommendedDecision, operationHighlights, dryRunRehearsal) {
  const projectTruthTargets = operationHighlights.filter((operation) => isProjectTruthTarget(operation.targetPath));
  const dryRunRehearsalPassed = dryRunRehearsal
    ? Object.values(dryRunRehearsal.commandsExitZero).every(Boolean) &&
      (dryRunRehearsal.approval.statusCounts?.blocked ?? 0) === 0 &&
      (dryRunRehearsal.sync.statusCounts?.blocked ?? 0) === 0
    : false;
  return {
    decisionRequired: status === "awaiting_approval_record" || status === "ready_for_sync_write",
    recommendedDecision,
    decisionType: status === "awaiting_approval_record"
      ? "approve_product_surface_sync_record"
      : status === "ready_for_sync_write"
        ? "apply_approved_product_surface_sync"
        : "none",
    scope: "product_managed_install_surface",
    operationCount: operationHighlights.length,
    operationTargets: operationHighlights.map((operation) => operation.targetPath),
    projectTruthTargetCount: projectTruthTargets.length,
    allTargetsOutsideProjectTruth: projectTruthTargets.length === 0,
    allOperationsWhitespaceEquivalent: operationHighlights.every((operation) => operation.sameIgnoringAllWhitespace === true),
    allOperationsTrailingWhitespaceOnly: operationHighlights.every((operation) => operation.sameIgnoringTrailingWhitespace === true),
    dryRunRehearsalPassed,
    dryRunRehearsalSummary: dryRunRehearsal,
    remainingHumanGate: status === "awaiting_approval_record"
      ? "Explicitly approve the project-local approval record write before any sync write."
      : status === "ready_for_sync_write"
        ? "Explicitly approve the guarded sync write using the matching approval report."
        : "No human apply gate is currently required."
  };
}

function renderCommandEntries(lines, commands) {
  for (const [name, value] of Object.entries(commands)) {
    lines.push(`- ${name}:`);
    lines.push(`  \`${value}\``);
  }
}

function buildProjectHandoff(readiness, flowState, scratchRoot, paths, scratchKept, dryRunRehearsal) {
  if (!readiness) {
    return {
      available: false,
      status: flowState,
      scratchKept,
      reportsRetained: scratchKept,
      executionPlanUsable: false,
      humanDecisionRequired: false,
      recommendedDecision: flowState === "no_drift"
        ? "No product-managed install drift is currently detected."
        : "No automated handoff packet is available; inspect the generated stage summaries.",
      approvalRecordTarget: null,
      approvalReportStatus: null,
      readinessReport: null,
      operationHighlights: [],
      candidateApprovalRecordMarkdown: null,
      executionCwd: null,
      suggestedReportPaths: null,
      nextCommands: null,
      contextCommands: null,
      shellContextCommands: null,
      dryRunRehearsal: null,
      decisionBrief: null,
      snapshotWarning: "No readiness packet was generated for this audit run."
    };
  }

  const decisionPacket = readiness.decisionPacket ?? {};
  const status = readiness.status ?? flowState;
  const recommendedDecision = decisionPacket.recommendedDecision ?? null;
  const operationHighlights = decisionPacket.operationHighlights ?? readiness.operations?.map((operation) => ({
    id: operation.id,
    status: operation.status,
    targetPath: operation.targetPath,
    sourcePath: operation.sourcePath,
    surface: operation.surface ?? null,
    reason: operation.reason ?? null,
    sameIgnoringTrailingWhitespace: operation.sameIgnoringTrailingWhitespace ?? false,
    sameIgnoringAllWhitespace: operation.sameIgnoringAllWhitespace ?? false,
    firstDifferingLine: operation.firstDifferingLine ?? null
  })) ?? [];
  const displayedRecommendedDecision = scratchKept || status === "already_current"
    ? recommendedDecision
    : `${recommendedDecision ?? "Review the handoff before any apply."} Rerun this audit with --keep-workdir before using generated approval or sync execution commands.`;
  return {
    available: true,
    status,
    scratchKept,
    reportsRetained: scratchKept,
    executionPlanUsable: scratchKept,
    humanDecisionRequired: decisionPacket.humanDecisionRequired ?? false,
    recommendedDecision: displayedRecommendedDecision,
    approvalRecordTarget: decisionPacket.approvalRecordTarget ?? readiness.approvalRecord?.plannedTarget ?? null,
    approvalReportStatus: readiness.summary?.approvalReportStatus ?? null,
    readinessReport: scratchKept ? toPosix(path.relative(scratchRoot, paths.readiness)) : null,
    operationHighlights,
    candidateApprovalRecordMarkdown: decisionPacket.candidateApprovalRecordMarkdown ?? null,
    executionCwd: scratchKept ? readiness.executionCwd ?? null : null,
    suggestedReportPaths: scratchKept ? readiness.suggestedReportPaths ?? null : null,
    nextCommands: scratchKept ? readiness.nextCommands ?? null : null,
    contextCommands: scratchKept ? readiness.contextCommands ?? null : null,
    shellContextCommands: scratchKept ? readiness.shellContextCommands ?? null : null,
    dryRunRehearsal,
    decisionBrief: buildDecisionBrief(status, displayedRecommendedDecision, operationHighlights, dryRunRehearsal),
    snapshotWarning: scratchKept
      ? decisionPacket.snapshotWarning ??
        "This handoff summarizes evidence snapshots. Executors still re-check source and target hashes before physical writes."
      : "Scratch reports were not retained. Treat this as a decision summary only; rerun with --keep-workdir before approval or sync execution."
  };
}

function buildAudit(args) {
  const root = normalizePath(args.root);
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root does not exist: ${projectRoot}`);
  const packageJson = readJson(path.join(root, "package.json"));
  const scratchRoot = createScratch(args);
  const runnerRoot = path.join(scratchRoot, "runner-project");
  const reportsRoot = path.join(scratchRoot, "reports");
  const issues = [];
  let packInfo = null;
  let tarballPath = null;
  let installResult = null;
  let status = null;
  let installPlan = null;
  let driftAudit = null;
  let syncPlan = null;
  let approvalPlan = null;
  let readiness = null;
  let approvalDryRun = null;
  let syncDryRun = null;
  let postCheck = null;
  let projectStatusBefore = null;
  let projectStatusAfter = null;

  const paths = {
    status: path.join(reportsRoot, "installed-project-status.json"),
    installPlan: path.join(reportsRoot, "installed-project-install-plan.json"),
    driftAudit: path.join(reportsRoot, "installed-project-install-drift.json"),
    syncPlan: path.join(reportsRoot, "installed-project-install-sync-plan.json"),
    approvalPlan: path.join(reportsRoot, "installed-project-install-sync-approval-plan.json"),
    readiness: path.join(reportsRoot, "installed-project-install-sync-apply-readiness.json"),
    approvalDryRun: path.join(reportsRoot, "installed-project-approval-dry-run.json"),
    syncDryRun: path.join(reportsRoot, "installed-project-sync-dry-run.json"),
    postCheck: path.join(reportsRoot, "installed-project-post-check-install-plan.json")
  };

  try {
    projectStatusBefore = gitStatus(projectRoot, args.timeoutMs);

    const packResult = runNpm(["pack", root, "--json", "--pack-destination", scratchRoot], root, args.timeoutMs);
    if (packResult.error) issues.push(`pack_spawn_error:${packResult.error}`);
    if (packResult.exitCode !== 0) issues.push(`pack_nonzero_exit:${packResult.exitCode ?? "null"}`);
    if (issues.length === 0) {
      packInfo = parsePackJson(packResult.stdout);
      tarballPath = resolvePackedTarball(scratchRoot, packInfo);
      if (!fs.existsSync(tarballPath)) issues.push("packed_tarball_missing");
    }

    fs.mkdirSync(runnerRoot, { recursive: true });
    fs.writeFileSync(
      path.join(runnerRoot, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );

    if (issues.length === 0) {
      installResult = runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], runnerRoot, args.timeoutMs);
      if (installResult.error) issues.push(`install_spawn_error:${installResult.error}`);
      if (installResult.exitCode !== 0) issues.push(`install_nonzero_exit:${installResult.exitCode ?? "null"}`);
    }

    if (issues.length === 0) {
      const statusArgs = ["--project", projectRoot, "--format", "json", "--out", paths.status];
      if (args.projectId) statusArgs.splice(2, 0, "--project-id", args.projectId);
      status = runStage("status", runnerRoot, "gamespec-status", statusArgs, args.timeoutMs, paths.status, issues).data;
    }

    const projectId = args.projectId ?? status?.projectId ?? null;
    if (issues.length === 0 && !projectId) issues.push("project_id_missing_after_status");

    if (issues.length === 0) {
      installPlan = runStage("install_plan", runnerRoot, "gamespec-plan-install", [
        "--project", projectRoot,
        "--surface", "all",
        "--format", "json",
        "--out", paths.installPlan
      ], args.timeoutMs, paths.installPlan, issues).data;
      if (installPlan && !pathIncludesNodeModulesPackage(installPlan.productRoot ?? "")) {
        issues.push("install_plan_product_root_not_installed_package");
      }
      if (installPlan && installPlan.productVersion !== packageJson.version) {
        issues.push("install_plan_product_version_mismatch");
      }
    }

    if (issues.length === 0) {
      driftAudit = runStage("drift_audit", runnerRoot, "gamespec-audit-install-drift", [
        "--plan", paths.installPlan,
        "--format", "json",
        "--out", paths.driftAudit
      ], args.timeoutMs, paths.driftAudit, issues).data;
    }

    const driftCount = driftAudit?.summary?.driftCount ?? 0;
    let flowState = driftCount === 0 ? "no_drift" : "drift_detected";

    if (issues.length === 0 && driftCount > 0) {
      syncPlan = runStage("sync_plan", runnerRoot, "gamespec-plan-install-sync", [
        "--drift", paths.driftAudit,
        "--format", "json",
        "--out", paths.syncPlan
      ], args.timeoutMs, paths.syncPlan, issues).data;
      const candidates = syncPlan?.summary?.statusCounts?.candidate_sync ?? 0;
      if (candidates > 0 && projectId) {
        approvalPlan = runStage("approval_plan", runnerRoot, "gamespec-plan-install-sync-approval", [
          "--plan", paths.syncPlan,
          "--project-id", projectId,
          "--rationale", "installed-project-readiness-audit",
          "--format", "json",
          "--out", paths.approvalPlan
        ], args.timeoutMs, paths.approvalPlan, issues).data;
        readiness = runStage("readiness", runnerRoot, "gamespec-report-install-sync-apply-readiness", [
          "--sync-plan", paths.syncPlan,
          "--approval-plan", paths.approvalPlan,
          "--format", "json",
          "--out", paths.readiness
        ], args.timeoutMs, paths.readiness, issues).data;
        flowState = readiness?.status ?? "readiness_missing";
        if (issues.length === 0 && readiness?.status === "awaiting_approval_record") {
          approvalDryRun = runStage("approval_dry_run", runnerRoot, "gamespec-execute-install-sync-approval-plan", [
            "--plan", paths.approvalPlan,
            "--format", "json",
            "--out", paths.approvalDryRun
          ], args.timeoutMs, paths.approvalDryRun, issues);
          syncDryRun = runStage("sync_dry_run", runnerRoot, "gamespec-execute-install-sync-plan", [
            "--plan", paths.syncPlan,
            "--format", "json",
            "--out", paths.syncDryRun
          ], args.timeoutMs, paths.syncDryRun, issues);
          postCheck = runStage("post_check", runnerRoot, "gamespec-plan-install", [
            "--project", projectRoot,
            "--surface", "all",
            "--format", "json",
            "--out", paths.postCheck
          ], args.timeoutMs, paths.postCheck, issues);
        }
      } else {
        flowState = "drift_requires_manual_review";
      }
    }

    projectStatusAfter = gitStatus(projectRoot, args.timeoutMs);
    if (projectStatusBefore?.available && projectStatusAfter?.available && projectStatusBefore.stdout !== projectStatusAfter.stdout) {
      issues.push("project_git_status_changed");
    }

    return {
      generated: new Date().toISOString(),
      mode: "installed_project_readiness_audit",
      root,
      packageName: packageJson.name ?? null,
      packageVersion: packageJson.version ?? null,
      projectRoot,
      projectId,
      state: issues.length === 0 ? "pass" : "blocked",
      flowState,
      scratch: {
        root: scratchRoot,
        kept: args.keepWorkdir,
        runnerRoot,
        reportsRoot
      },
      pack: packInfo
        ? {
            filename: packInfo.filename ?? null,
            fileCount: (packInfo.files ?? []).length,
            metaIncluded: (packInfo.files ?? []).some((file) => String(file.path ?? file).startsWith(".meta/"))
          }
        : null,
      install: installResult
        ? {
            exitCode: installResult.exitCode,
            stdoutBytes: installResult.stdoutBytes,
            stderrBytes: installResult.stderrBytes
          }
        : null,
      projectGitStatus: {
        before: projectStatusBefore,
        after: projectStatusAfter,
        unchanged: projectStatusBefore?.available && projectStatusAfter?.available
          ? projectStatusBefore.stdout === projectStatusAfter.stdout
          : null
      },
      reports: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, toPosix(path.relative(scratchRoot, value))])),
      dryRunRehearsal: summarizeDryRunRehearsal(approvalDryRun, syncDryRun, postCheck),
      handoff: buildProjectHandoff(readiness, flowState, scratchRoot, paths, args.keepWorkdir, summarizeDryRunRehearsal(approvalDryRun, syncDryRun, postCheck)),
      summary: {
        issues,
        statusMode: status?.mode ?? null,
        currentWorkflow: status?.current?.workflow ?? null,
        installPlanStatusCounts: installPlan?.statusCounts ?? null,
        installPlanProductRoot: installPlan?.productRoot ?? null,
        driftSummary: driftAudit?.summary ?? null,
        syncPlanSummary: syncPlan?.summary ?? null,
        approvalPlanSummary: approvalPlan?.summary ?? null,
        readinessStatus: readiness?.status ?? null,
        readinessSummary: readiness?.summary ?? null,
        dryRunRehearsal: summarizeDryRunRehearsal(approvalDryRun, syncDryRun, postCheck)
      },
      guardrails: [
        "Packs and installs GameSpec into an isolated runner.",
        "Runs installed node_modules/.bin commands against the target project.",
        "Writes reports only outside the target project.",
        "Does not pass --write to any installed project command.",
        "Compares target project git status before and after when git is available."
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
  lines.push("# GameSpec Installed Project Readiness Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Flow state: \`${audit.flowState}\``);
  lines.push(`Project root: \`${audit.projectRoot}\``);
  lines.push(`Project id: \`${audit.projectId ?? "unknown"}\``);
  lines.push(`Package: \`${audit.packageName}@${audit.packageVersion}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Issues: ${audit.summary.issues.length === 0 ? "none" : audit.summary.issues.join(", ")}`);
  lines.push(`- Current workflow: \`${audit.summary.currentWorkflow ?? "unknown"}\``);
  lines.push(`- Install plan counts: \`${audit.summary.installPlanStatusCounts ? JSON.stringify(audit.summary.installPlanStatusCounts) : "missing"}\``);
  lines.push(`- Drift count: ${audit.summary.driftSummary?.driftCount ?? "missing"}`);
  lines.push(`- Sync candidates: ${audit.summary.syncPlanSummary?.statusCounts?.candidate_sync ?? "missing"}`);
  lines.push(`- Approval plan operations: ${audit.summary.approvalPlanSummary?.operations ?? "missing"}`);
  lines.push(`- Readiness status: \`${audit.summary.readinessStatus ?? "missing"}\``);
  lines.push(`- Handoff available: ${audit.handoff.available}`);
  lines.push(`- Human decision required: ${audit.handoff.humanDecisionRequired}`);
  lines.push(`- Project git status unchanged: ${audit.projectGitStatus.unchanged}`);
  lines.push("");

  lines.push("## Project Handoff");
  lines.push("");
  lines.push(`- Status: \`${audit.handoff.status ?? "missing"}\``);
  lines.push(`- Recommended decision: ${audit.handoff.recommendedDecision ?? "missing"}`);
  lines.push(`- Scratch kept: ${audit.handoff.scratchKept}`);
  lines.push(`- Reports retained: ${audit.handoff.reportsRetained}`);
  lines.push(`- Execution plan usable from this audit: ${audit.handoff.executionPlanUsable}`);
  lines.push(`- Execution cwd: \`${audit.handoff.executionCwd ?? "missing"}\``);
  lines.push(`- Approval write report: \`${audit.handoff.suggestedReportPaths?.approvalWriteReport ?? "missing"}\``);
  lines.push(`- Sync write report: \`${audit.handoff.suggestedReportPaths?.syncWriteReport ?? "missing"}\``);
  if (audit.handoff.dryRunRehearsal) {
    lines.push(`- Dry-run approval exits zero: ${audit.handoff.dryRunRehearsal.commandsExitZero.approvalDryRun}`);
    lines.push(`- Dry-run sync exits zero: ${audit.handoff.dryRunRehearsal.commandsExitZero.syncDryRun}`);
    lines.push(`- Dry-run post-check exits zero: ${audit.handoff.dryRunRehearsal.commandsExitZero.postCheck}`);
  }
  if (audit.handoff.decisionBrief) {
    lines.push(`- Decision scope: \`${audit.handoff.decisionBrief.scope}\``);
    lines.push(`- Targets outside project truth: ${audit.handoff.decisionBrief.allTargetsOutsideProjectTruth}`);
    lines.push(`- Whitespace-equivalent operations: ${audit.handoff.decisionBrief.allOperationsWhitespaceEquivalent}`);
    lines.push(`- Dry-run rehearsal passed: ${audit.handoff.decisionBrief.dryRunRehearsalPassed}`);
  }
  lines.push(`- Approval report: \`${audit.handoff.approvalReportStatus ?? "missing"}\``);
  lines.push(`- Approval record target: \`${audit.handoff.approvalRecordTarget ?? "missing"}\``);
  lines.push(`- Readiness report: \`${audit.handoff.readinessReport ?? "missing"}\``);
  lines.push(`- Snapshot warning: ${audit.handoff.snapshotWarning}`);
  if (audit.handoff.shellContextCommands?.powershell) {
    lines.push("");
    lines.push("### PowerShell Context Commands");
    lines.push("");
    renderCommandEntries(lines, audit.handoff.shellContextCommands.powershell);
  }
  if (audit.handoff.shellContextCommands?.cmd) {
    lines.push("");
    lines.push("### Cmd Context Commands");
    lines.push("");
    renderCommandEntries(lines, audit.handoff.shellContextCommands.cmd);
  }
  if (audit.handoff.operationHighlights.length > 0) {
    lines.push("");
    lines.push("### Operation Highlights");
    lines.push("");
    for (const operation of audit.handoff.operationHighlights) {
      lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
      lines.push(`  - status: \`${operation.status}\``);
      if (operation.surface) lines.push(`  - surface: \`${operation.surface}\``);
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
  if (audit.handoff.candidateApprovalRecordMarkdown) {
    lines.push("");
    lines.push("### Candidate Approval Record");
    lines.push("");
    lines.push("```markdown");
    lines.push(audit.handoff.candidateApprovalRecordMarkdown.trimEnd());
    lines.push("```");
  }
  lines.push("");

  lines.push("## Scratch Reports");
  lines.push("");
  for (const [key, value] of Object.entries(audit.reports)) {
    lines.push(`- ${key}: \`${value}\``);
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
      throw new Error(`Refusing to write installed project readiness audit inside target project: ${outPath}`);
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
  console.error(`gamespec-audit-installed-project-readiness: ${error.message}`);
  process.exit(1);
}
