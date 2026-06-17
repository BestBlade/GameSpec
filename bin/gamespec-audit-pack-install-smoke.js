#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec pack install smoke audit

Usage:
  node bin/gamespec-audit-pack-install-smoke.js [--root <package-root>] [--out <path>] [--format markdown|json] [--timeout-ms <ms>] [--workdir <path>] [--keep-workdir]

Rules:
  - Builds an npm pack tarball from the package root.
  - Installs that tarball into an isolated scratch project.
  - Runs every installed node_modules/.bin command with --help.
  - Writes only isolated scratch targets.
  - Does not inspect or write any target project.
  - Scratch files are removed by default unless --keep-workdir is provided.
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
    if (arg === "--root") {
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

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  return fs.mkdtempSync(path.join(base, "gamespec-pack-install-"));
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

function checkInstalledHelp(fixtureRoot, name, timeoutMs) {
  const shimPath = installedShimPath(fixtureRoot, name);
  const issues = [];

  if (!fs.existsSync(shimPath)) {
    issues.push("shim_missing");
  }

  let result = null;
  if (issues.length === 0) {
    result = runCommand(shimPath, ["--help"], { cwd: fixtureRoot, timeout: timeoutMs });
    if (result.error) issues.push(`spawn_error:${result.error}`);
    if (result.exitCode !== 0) issues.push(`nonzero_exit:${result.exitCode ?? "null"}`);
    const combined = `${result.stdout}\n${result.stderr}`;
    if (!/(^|\r?\n)Usage:/u.test(combined)) issues.push("help_missing_usage");
  }

  return {
    name,
    shimPath: toPosix(path.relative(fixtureRoot, shimPath)),
    status: issues.length === 0 ? "pass" : "blocked",
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    stdoutBytes: result?.stdoutBytes ?? 0,
    stderrBytes: result?.stderrBytes ?? 0,
    timedOut: result?.timedOut ?? false,
    issues
  };
}

function installedShimPath(fixtureRoot, name) {
  const shimBase = path.join(fixtureRoot, "node_modules", ".bin", name);
  return process.platform === "win32" && fs.existsSync(`${shimBase}.cmd`)
    ? `${shimBase}.cmd`
    : shimBase;
}

function runInstalledShim(fixtureRoot, name, args, timeoutMs) {
  const shimPath = installedShimPath(fixtureRoot, name);
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
  return runCommand(shimPath, args, { cwd: fixtureRoot, timeout: timeoutMs });
}

function countFiles(root) {
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function mutateReviewScoringWithTrailingWhitespace(targetRoot) {
  const targetPath = path.join(targetRoot, "gamespec", "skills", "review-scoring.md");
  if (!fs.existsSync(targetPath)) {
    return { targetPath, changed: false, issue: "review_scoring_target_missing" };
  }
  const text = fs.readFileSync(targetPath, "utf8");
  const lines = text.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.startsWith("## ") && !/[ \t]$/u.test(line));
  if (lineIndex < 0) {
    return { targetPath, changed: false, issue: "review_scoring_heading_line_not_found" };
  }
  lines[lineIndex] = `${lines[lineIndex]} `;
  fs.writeFileSync(targetPath, lines.join("\n"), "utf8");
  return { targetPath, changed: true, line: lineIndex + 1 };
}

function pathIncludesNodeModulesPackage(inputPath) {
  const normalized = inputPath.split(path.sep).join("/");
  return /\/node_modules\/gamespec$/u.test(normalized) || normalized.endsWith("node_modules/gamespec");
}

function captureExpectedInstalledFailure(fixtureRoot, name, args, timeoutMs) {
  const result = runInstalledShim(fixtureRoot, name, args, timeoutMs);
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    error: result.error
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function buildInstalledSyncApprovalProbe(fixtureRoot, scratchRoot, packageJson, timeoutMs) {
  const targetRoot = path.join(scratchRoot, "install-sync-approval-target-project");
  const initialPlanPath = path.join(scratchRoot, "sync-probe-initial-install-plan.json");
  const initialWritePath = path.join(scratchRoot, "sync-probe-initial-install-write.json");
  const driftPlanPath = path.join(scratchRoot, "sync-probe-drift-install-plan.json");
  const driftAuditPath = path.join(scratchRoot, "sync-probe-install-drift.json");
  const syncPlanPath = path.join(scratchRoot, "sync-probe-install-sync-plan.json");
  const approvalPlanPath = path.join(scratchRoot, "sync-probe-install-sync-approval-plan.json");
  const approvalWritePath = path.join(scratchRoot, "sync-probe-approval-write.json");
  const missingApprovalOutPath = path.join(scratchRoot, "sync-probe-missing-approval-should-not-exist.json");
  const syncWritePath = path.join(scratchRoot, "sync-probe-sync-write.json");
  const afterSyncPlanPath = path.join(scratchRoot, "sync-probe-after-sync-install-plan.json");
  const issues = [];

  fs.mkdirSync(targetRoot, { recursive: true });

  const initialPlanResult = runInstalledShim(fixtureRoot, "gamespec-plan-install", [
    "--project", targetRoot,
    "--surface", "all",
    "--profile", "full-beta",
    "--format", "json",
    "--out", initialPlanPath
  ], timeoutMs);
  if (initialPlanResult.error) issues.push(`initial_plan_spawn_error:${initialPlanResult.error}`);
  if (initialPlanResult.exitCode !== 0) issues.push(`initial_plan_nonzero_exit:${initialPlanResult.exitCode ?? "null"}`);
  const initialPlan = readJsonIfExists(initialPlanPath);
  if (!initialPlan) issues.push("initial_plan_output_missing");
  if (initialPlan && !pathIncludesNodeModulesPackage(initialPlan.productRoot ?? "")) {
    issues.push("initial_plan_product_root_not_installed_package");
  }
  if (initialPlan && initialPlan.productVersion !== packageJson.version) {
    issues.push("initial_plan_product_version_mismatch");
  }
  if (initialPlan && initialPlan.installSurfaceManifest?.selectedProfile !== "full-beta") {
    issues.push("initial_plan_profile_not_full_beta");
  }
  if (initialPlan && initialPlan.installSurfaceManifest?.defaultProfile !== "stable-core") {
    issues.push("initial_plan_default_profile_not_stable_core");
  }

  let initialWrite = null;
  if (issues.length === 0) {
    const initialWriteResult = runInstalledShim(fixtureRoot, "gamespec-execute-install", [
      "--plan", initialPlanPath,
      "--format", "json",
      "--out", initialWritePath,
      "--write"
    ], timeoutMs);
    if (initialWriteResult.error) issues.push(`initial_write_spawn_error:${initialWriteResult.error}`);
    if (initialWriteResult.exitCode !== 0) issues.push(`initial_write_nonzero_exit:${initialWriteResult.exitCode ?? "null"}`);
    initialWrite = readJsonIfExists(initialWritePath);
    if (!initialWrite) issues.push("initial_write_output_missing");
  }

  let mutation = null;
  if (issues.length === 0) {
    mutation = mutateReviewScoringWithTrailingWhitespace(targetRoot);
    if (!mutation.changed) issues.push(`mutation_failed:${mutation.issue}`);
  }

  let driftPlan = null;
  if (issues.length === 0) {
    const driftPlanResult = runInstalledShim(fixtureRoot, "gamespec-plan-install", [
      "--project", targetRoot,
      "--surface", "all",
      "--profile", "full-beta",
      "--format", "json",
      "--out", driftPlanPath
    ], timeoutMs);
    if (driftPlanResult.error) issues.push(`drift_plan_spawn_error:${driftPlanResult.error}`);
    if (driftPlanResult.exitCode !== 0) issues.push(`drift_plan_nonzero_exit:${driftPlanResult.exitCode ?? "null"}`);
    driftPlan = readJsonIfExists(driftPlanPath);
    if (!driftPlan) issues.push("drift_plan_output_missing");
    if (driftPlan && (driftPlan.statusCounts?.blocked_target_exists_differs ?? 0) !== 1) {
      issues.push("drift_plan_expected_one_blocked_diff");
    }
  }

  let driftAudit = null;
  if (issues.length === 0) {
    const driftAuditResult = runInstalledShim(fixtureRoot, "gamespec-audit-install-drift", [
      "--plan", driftPlanPath,
      "--format", "json",
      "--out", driftAuditPath
    ], timeoutMs);
    if (driftAuditResult.error) issues.push(`drift_audit_spawn_error:${driftAuditResult.error}`);
    if (driftAuditResult.exitCode !== 0) issues.push(`drift_audit_nonzero_exit:${driftAuditResult.exitCode ?? "null"}`);
    driftAudit = readJsonIfExists(driftAuditPath);
    if (!driftAudit) issues.push("drift_audit_output_missing");
    if (driftAudit && driftAudit.summary?.driftCount !== 1) issues.push("drift_audit_expected_one_drift");
    if (driftAudit && driftAudit.summary?.recommendedActions?.candidate_for_explicit_product_surface_sync_after_review !== 1) {
      issues.push("drift_audit_expected_candidate_recommendation");
    }
  }

  let syncPlan = null;
  if (issues.length === 0) {
    const syncPlanResult = runInstalledShim(fixtureRoot, "gamespec-plan-install-sync", [
      "--drift", driftAuditPath,
      "--format", "json",
      "--out", syncPlanPath
    ], timeoutMs);
    if (syncPlanResult.error) issues.push(`sync_plan_spawn_error:${syncPlanResult.error}`);
    if (syncPlanResult.exitCode !== 0) issues.push(`sync_plan_nonzero_exit:${syncPlanResult.exitCode ?? "null"}`);
    syncPlan = readJsonIfExists(syncPlanPath);
    if (!syncPlan) issues.push("sync_plan_output_missing");
    if (syncPlan && syncPlan.summary?.statusCounts?.candidate_sync !== 1) issues.push("sync_plan_expected_one_candidate");
    if (syncPlan && syncPlan.applyPolicy?.requiresApprovalExecutionReport !== true) {
      issues.push("sync_plan_missing_approval_policy");
    }
  }

  let approvalPlan = null;
  if (issues.length === 0) {
    const approvalPlanResult = runInstalledShim(fixtureRoot, "gamespec-plan-install-sync-approval", [
      "--plan", syncPlanPath,
      "--project-id", "fixture",
      "--rationale", "installed-pack-smoke-approval-proof",
      "--format", "json",
      "--out", approvalPlanPath
    ], timeoutMs);
    if (approvalPlanResult.error) issues.push(`approval_plan_spawn_error:${approvalPlanResult.error}`);
    if (approvalPlanResult.exitCode !== 0) issues.push(`approval_plan_nonzero_exit:${approvalPlanResult.exitCode ?? "null"}`);
    approvalPlan = readJsonIfExists(approvalPlanPath);
    if (!approvalPlan) issues.push("approval_plan_output_missing");
    if (approvalPlan && approvalPlan.summary?.operations !== 1) issues.push("approval_plan_expected_one_operation");
  }

  let missingApprovalFailure = null;
  if (issues.length === 0) {
    missingApprovalFailure = captureExpectedInstalledFailure(fixtureRoot, "gamespec-execute-install-sync-plan", [
      "--plan", syncPlanPath,
      "--format", "json",
      "--out", missingApprovalOutPath,
      "--write",
      "--approve"
    ], timeoutMs);
    if (missingApprovalFailure.exitCode === 0) issues.push("sync_write_without_approval_succeeded");
    if (fs.existsSync(missingApprovalOutPath)) issues.push("sync_write_without_approval_wrote_report");
    if (!`${missingApprovalFailure.stderr}\n${missingApprovalFailure.stdout}`.includes("requires --approval")) {
      issues.push("sync_write_without_approval_missing_error_text");
    }
  }

  let approvalWrite = null;
  if (issues.length === 0) {
    const approvalWriteResult = runInstalledShim(fixtureRoot, "gamespec-execute-install-sync-approval-plan", [
      "--plan", approvalPlanPath,
      "--format", "json",
      "--out", approvalWritePath,
      "--write",
      "--approve"
    ], timeoutMs);
    if (approvalWriteResult.error) issues.push(`approval_write_spawn_error:${approvalWriteResult.error}`);
    if (approvalWriteResult.exitCode !== 0) issues.push(`approval_write_nonzero_exit:${approvalWriteResult.exitCode ?? "null"}`);
    approvalWrite = readJsonIfExists(approvalWritePath);
    if (!approvalWrite) issues.push("approval_write_output_missing");
    if (approvalWrite && approvalWrite.statusCounts?.wrote !== 1) issues.push("approval_write_expected_wrote");
    if (approvalWrite && !approvalWrite.operation?.plannedSha256) issues.push("approval_write_missing_planned_sha");
  }

  let syncWrite = null;
  if (issues.length === 0) {
    const syncWriteResult = runInstalledShim(fixtureRoot, "gamespec-execute-install-sync-plan", [
      "--plan", syncPlanPath,
      "--approval", approvalWritePath,
      "--format", "json",
      "--out", syncWritePath,
      "--write",
      "--approve"
    ], timeoutMs);
    if (syncWriteResult.error) issues.push(`sync_write_spawn_error:${syncWriteResult.error}`);
    if (syncWriteResult.exitCode !== 0) issues.push(`sync_write_nonzero_exit:${syncWriteResult.exitCode ?? "null"}`);
    syncWrite = readJsonIfExists(syncWritePath);
    if (!syncWrite) issues.push("sync_write_output_missing");
    if (syncWrite && syncWrite.statusCounts?.synced !== 1) issues.push("sync_write_expected_synced");
    if (syncWrite && syncWrite.approval?.approvedOperations !== 1) issues.push("sync_write_missing_approval_binding");
  }

  let afterSyncPlan = null;
  if (issues.length === 0) {
    const afterSyncPlanResult = runInstalledShim(fixtureRoot, "gamespec-plan-install", [
      "--project", targetRoot,
      "--surface", "all",
      "--profile", "full-beta",
      "--format", "json",
      "--out", afterSyncPlanPath
    ], timeoutMs);
    if (afterSyncPlanResult.error) issues.push(`after_sync_plan_spawn_error:${afterSyncPlanResult.error}`);
    if (afterSyncPlanResult.exitCode !== 0) issues.push(`after_sync_plan_nonzero_exit:${afterSyncPlanResult.exitCode ?? "null"}`);
    afterSyncPlan = readJsonIfExists(afterSyncPlanPath);
    if (!afterSyncPlan) issues.push("after_sync_plan_output_missing");
    if (afterSyncPlan && (afterSyncPlan.statusCounts?.blocked_target_exists_differs ?? 0) !== 0) {
      issues.push("after_sync_plan_still_has_blocked_diff");
    }
  }

  return {
    state: issues.length === 0 ? "pass" : "blocked",
    targetRoot,
    paths: {
      initialPlanPath,
      initialWritePath,
      driftPlanPath,
      driftAuditPath,
      syncPlanPath,
      approvalPlanPath,
      approvalWritePath,
      syncWritePath,
      afterSyncPlanPath
    },
    issues,
    mutation,
    initialPlan: initialPlan
      ? {
          productRoot: initialPlan.productRoot,
          productVersion: initialPlan.productVersion,
          selectedProfile: initialPlan.installSurfaceManifest?.selectedProfile ?? null,
          operations: initialPlan.operations.length,
          statusCounts: initialPlan.statusCounts
        }
      : null,
    initialWrite: initialWrite ? { statusCounts: initialWrite.statusCounts } : null,
    driftPlan: driftPlan ? { statusCounts: driftPlan.statusCounts } : null,
    driftAudit: driftAudit ? { summary: driftAudit.summary } : null,
    syncPlan: syncPlan ? { summary: syncPlan.summary, applyPolicy: syncPlan.applyPolicy } : null,
    approvalPlan: approvalPlan ? { summary: approvalPlan.summary, recordTarget: approvalPlan.recordTarget } : null,
    missingApprovalFailure: missingApprovalFailure
      ? {
          exitCode: missingApprovalFailure.exitCode,
          stderrBytes: missingApprovalFailure.stderrBytes,
          stdoutBytes: missingApprovalFailure.stdoutBytes
        }
      : null,
    approvalWrite: approvalWrite
      ? {
          statusCounts: approvalWrite.statusCounts,
          plannedSha256: approvalWrite.operation?.plannedSha256 ?? null
        }
      : null,
    syncWrite: syncWrite
      ? {
          statusCounts: syncWrite.statusCounts,
          approvedOperations: syncWrite.approval?.approvedOperations ?? null
        }
      : null,
    afterSyncPlan: afterSyncPlan ? { statusCounts: afterSyncPlan.statusCounts } : null
  };
}

function buildInstallProbe(fixtureRoot, scratchRoot, packageJson, timeoutMs) {
  const targetRoot = path.join(scratchRoot, "install-target-project");
  const planPath = path.join(scratchRoot, "installed-all-plan.json");
  const dryRunPath = path.join(scratchRoot, "installed-all-execute-dry-run.json");
  const writePath = path.join(scratchRoot, "installed-all-execute-write.json");
  const afterWritePath = path.join(scratchRoot, "installed-all-after-write-plan.json");
  const issues = [];

  fs.mkdirSync(targetRoot, { recursive: true });

  const planResult = runInstalledShim(fixtureRoot, "gamespec-plan-install", [
    "--project", targetRoot,
    "--surface", "all",
    "--format", "json",
    "--out", planPath
  ], timeoutMs);
  if (planResult.error) issues.push(`plan_spawn_error:${planResult.error}`);
  if (planResult.exitCode !== 0) issues.push(`plan_nonzero_exit:${planResult.exitCode ?? "null"}`);
  const plan = readJsonIfExists(planPath);
  if (!plan) issues.push("plan_output_missing");

  if (plan) {
    if (!pathIncludesNodeModulesPackage(plan.productRoot ?? "")) issues.push("plan_product_root_not_installed_package");
    if (plan.productVersion !== packageJson.version) issues.push("plan_product_version_mismatch");
    if (plan.installSurfaceManifest?.selectedProfile !== "stable-core") issues.push("plan_default_profile_not_stable_core");
    if (plan.installSurfaceManifest?.defaultProfile !== "stable-core") issues.push("plan_manifest_default_profile_not_stable_core");
    if (!Array.isArray(plan.operations) || plan.operations.length === 0) issues.push("plan_has_no_operations");
    if (Array.isArray(plan.operations) && plan.operations.length !== 3) issues.push("plan_expected_three_stable_core_operations");
    if ((plan.operations ?? []).some((op) => op.surface !== "kernel")) issues.push("plan_default_includes_non_kernel_operation");
    if ((plan.operations ?? []).some((op) => !["config", "method"].includes(op.surfaceGroup))) {
      issues.push("plan_default_includes_non_stable_core_group");
    }
    if ((plan.statusCounts?.would_create ?? 0) === 0) issues.push("plan_has_no_create_operations");
    if ((plan.operations ?? []).some((op) => String(op.targetPath ?? "").startsWith("gamespec/projects/"))) {
      issues.push("plan_targets_project_truth");
    }
  }

  let dryRun = null;
  if (issues.length === 0) {
    const dryRunResult = runInstalledShim(fixtureRoot, "gamespec-execute-install", [
      "--plan", planPath,
      "--format", "json",
      "--out", dryRunPath
    ], timeoutMs);
    if (dryRunResult.error) issues.push(`dry_run_spawn_error:${dryRunResult.error}`);
    if (dryRunResult.exitCode !== 0) issues.push(`dry_run_nonzero_exit:${dryRunResult.exitCode ?? "null"}`);
    dryRun = readJsonIfExists(dryRunPath);
    if (!dryRun) issues.push("dry_run_output_missing");
    if (dryRun && (dryRun.statusCounts?.would_copy ?? 0) !== plan.operations.length) {
      issues.push("dry_run_would_copy_mismatch");
    }
    if (dryRun && (dryRun.statusCounts?.blocked ?? 0) !== 0) {
      issues.push("dry_run_has_blocked_operations");
    }
  }

  let write = null;
  if (issues.length === 0) {
    const writeResult = runInstalledShim(fixtureRoot, "gamespec-execute-install", [
      "--plan", planPath,
      "--format", "json",
      "--out", writePath,
      "--write"
    ], timeoutMs);
    if (writeResult.error) issues.push(`write_spawn_error:${writeResult.error}`);
    if (writeResult.exitCode !== 0) issues.push(`write_nonzero_exit:${writeResult.exitCode ?? "null"}`);
    write = readJsonIfExists(writePath);
    if (!write) issues.push("write_output_missing");
    if (write && (write.statusCounts?.copied ?? 0) !== plan.operations.length) {
      issues.push("write_copied_mismatch");
    }
    if (write && !write.installState?.writtenPath) {
      issues.push("install_state_not_written");
    }
  }

  let afterWrite = null;
  if (issues.length === 0) {
    const afterWriteResult = runInstalledShim(fixtureRoot, "gamespec-plan-install", [
      "--project", targetRoot,
      "--surface", "all",
      "--format", "json",
      "--out", afterWritePath
    ], timeoutMs);
    if (afterWriteResult.error) issues.push(`after_write_spawn_error:${afterWriteResult.error}`);
    if (afterWriteResult.exitCode !== 0) issues.push(`after_write_nonzero_exit:${afterWriteResult.exitCode ?? "null"}`);
    afterWrite = readJsonIfExists(afterWritePath);
    if (!afterWrite) issues.push("after_write_output_missing");
    if (afterWrite && (afterWrite.statusCounts?.already_current ?? 0) !== plan.operations.length) {
      issues.push("after_write_already_current_mismatch");
    }
  }

  const copiedFiles = countFiles(targetRoot);
  if (issues.length === 0 && copiedFiles === 0) issues.push("target_has_no_copied_files");
  const hasClaude = fs.existsSync(path.join(targetRoot, ".claude"));
  const hasAgents = fs.existsSync(path.join(targetRoot, ".agents"));
  const hasCodex = fs.existsSync(path.join(targetRoot, ".codex"));
  if (issues.length === 0 && hasClaude) issues.push("default_install_created_claude_runtime");
  if (issues.length === 0 && hasAgents) issues.push("default_install_created_agents_runtime");
  if (issues.length === 0 && hasCodex) issues.push("default_install_created_codex_runtime");

  return {
    state: issues.length === 0 ? "pass" : "blocked",
    targetRoot,
    planPath,
    dryRunPath,
    writePath,
    afterWritePath,
    issues,
    plan: plan
      ? {
          productRoot: plan.productRoot,
          productVersion: plan.productVersion,
          selectedProfile: plan.installSurfaceManifest?.selectedProfile ?? null,
          defaultProfile: plan.installSurfaceManifest?.defaultProfile ?? null,
          operations: plan.operations.length,
          statusCounts: plan.statusCounts
        }
      : null,
    dryRun: dryRun ? { statusCounts: dryRun.statusCounts } : null,
    write: write
      ? {
          statusCounts: write.statusCounts,
          installStateWritten: Boolean(write.installState?.writtenPath)
        }
      : null,
    afterWrite: afterWrite ? { statusCounts: afterWrite.statusCounts } : null,
    targetFiles: copiedFiles,
    runtimeDirectories: {
      claude: hasClaude,
      agents: hasAgents,
      codex: hasCodex
    }
  };
}

function runtimePlanSummary(plan) {
  const runtimeOps = (plan?.operations ?? []).filter((op) => op.surface === "runtime");
  return plan
    ? {
        productRoot: plan.productRoot,
        productVersion: plan.productVersion,
        selectedProfile: plan.installSurfaceManifest?.selectedProfile ?? null,
        runtimeSelection: plan.installSurfaceManifest?.runtimeHostSelection ?? null,
        operations: plan.operations.length,
        runtimeOps: runtimeOps.length,
        runtimeTargets: runtimeOps.map((op) => op.targetPath)
      }
    : null;
}

function selectedHosts(plan) {
  return plan?.installSurfaceManifest?.runtimeHostSelection?.selectedHosts ?? [];
}

function hostListEquals(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function buildRuntimeHostSelectionProbe(fixtureRoot, scratchRoot, packageJson, timeoutMs) {
  const emptyTargetRoot = path.join(scratchRoot, "runtime-selection-empty-target");
  const existingCodexTargetRoot = path.join(scratchRoot, "runtime-selection-existing-codex-target");
  const explicitCodexTargetRoot = path.join(scratchRoot, "runtime-selection-explicit-codex-target");
  const emptyPlanPath = path.join(scratchRoot, "runtime-selection-empty-full-beta.json");
  const existingCodexPlanPath = path.join(scratchRoot, "runtime-selection-existing-codex-auto.json");
  const explicitAllPlanPath = path.join(scratchRoot, "runtime-selection-explicit-all.json");
  const explicitCodexPlanPath = path.join(scratchRoot, "runtime-selection-explicit-codex.json");
  const issues = [];

  fs.mkdirSync(emptyTargetRoot, { recursive: true });
  fs.mkdirSync(path.join(existingCodexTargetRoot, ".codex"), { recursive: true });
  fs.mkdirSync(explicitCodexTargetRoot, { recursive: true });

  const planCases = [
    {
      id: "emptyFullBeta",
      targetRoot: emptyTargetRoot,
      outPath: emptyPlanPath,
      args: ["--project", emptyTargetRoot, "--surface", "all", "--profile", "full-beta", "--format", "json", "--out", emptyPlanPath]
    },
    {
      id: "existingCodexAuto",
      targetRoot: existingCodexTargetRoot,
      outPath: existingCodexPlanPath,
      args: ["--project", existingCodexTargetRoot, "--surface", "all", "--profile", "full-beta", "--format", "json", "--out", existingCodexPlanPath]
    },
    {
      id: "explicitAll",
      targetRoot: emptyTargetRoot,
      outPath: explicitAllPlanPath,
      args: ["--project", emptyTargetRoot, "--surface", "all", "--profile", "full-beta", "--runtime-host", "all", "--format", "json", "--out", explicitAllPlanPath]
    },
    {
      id: "explicitCodex",
      targetRoot: explicitCodexTargetRoot,
      outPath: explicitCodexPlanPath,
      args: ["--project", explicitCodexTargetRoot, "--surface", "all", "--profile", "full-beta", "--runtime-host", "codex", "--format", "json", "--out", explicitCodexPlanPath]
    }
  ];

  const plans = {};
  for (const planCase of planCases) {
    const result = runInstalledShim(fixtureRoot, "gamespec-plan-install", planCase.args, timeoutMs);
    if (result.error) issues.push(`${planCase.id}_spawn_error:${result.error}`);
    if (result.exitCode !== 0) issues.push(`${planCase.id}_nonzero_exit:${result.exitCode ?? "null"}`);
    plans[planCase.id] = readJsonIfExists(planCase.outPath);
    if (!plans[planCase.id]) issues.push(`${planCase.id}_output_missing`);
    if (plans[planCase.id] && !pathIncludesNodeModulesPackage(plans[planCase.id].productRoot ?? "")) {
      issues.push(`${planCase.id}_product_root_not_installed_package`);
    }
    if (plans[planCase.id] && plans[planCase.id].productVersion !== packageJson.version) {
      issues.push(`${planCase.id}_product_version_mismatch`);
    }
  }

  const emptyRuntimeOps = (plans.emptyFullBeta?.operations ?? []).filter((op) => op.surface === "runtime");
  if (plans.emptyFullBeta && selectedHosts(plans.emptyFullBeta).length !== 0) issues.push("empty_full_beta_selected_runtime_hosts");
  if (plans.emptyFullBeta && emptyRuntimeOps.length !== 0) issues.push("empty_full_beta_created_runtime_ops");
  if (plans.emptyFullBeta && plans.emptyFullBeta.operations.length !== 78) issues.push("empty_full_beta_expected_78_kernel_ops");

  const existingCodexRuntimeOps = (plans.existingCodexAuto?.operations ?? []).filter((op) => op.surface === "runtime");
  if (plans.existingCodexAuto && !hostListEquals(selectedHosts(plans.existingCodexAuto), ["codex"])) {
    issues.push("existing_codex_auto_did_not_select_only_codex");
  }
  if (plans.existingCodexAuto && existingCodexRuntimeOps.length !== 5) issues.push("existing_codex_auto_expected_5_runtime_ops");
  if (plans.existingCodexAuto && existingCodexRuntimeOps.some((op) => !String(op.targetPath ?? "").startsWith(".codex/"))) {
    issues.push("existing_codex_auto_has_non_codex_runtime_target");
  }

  const explicitAllRuntimeOps = (plans.explicitAll?.operations ?? []).filter((op) => op.surface === "runtime");
  if (plans.explicitAll && !hostListEquals(selectedHosts(plans.explicitAll), ["agents", "claude", "codex"])) {
    issues.push("explicit_all_did_not_select_all_hosts");
  }
  if (plans.explicitAll && explicitAllRuntimeOps.length !== 15) issues.push("explicit_all_expected_15_runtime_ops");

  const explicitCodexRuntimeOps = (plans.explicitCodex?.operations ?? []).filter((op) => op.surface === "runtime");
  if (plans.explicitCodex && !hostListEquals(selectedHosts(plans.explicitCodex), ["codex"])) {
    issues.push("explicit_codex_did_not_select_only_codex");
  }
  if (plans.explicitCodex && explicitCodexRuntimeOps.length !== 5) issues.push("explicit_codex_expected_5_runtime_ops");
  if (plans.explicitCodex && explicitCodexRuntimeOps.some((op) => !String(op.targetPath ?? "").startsWith(".codex/"))) {
    issues.push("explicit_codex_has_non_codex_runtime_target");
  }

  return {
    state: issues.length === 0 ? "pass" : "blocked",
    targetRoots: {
      emptyTargetRoot,
      existingCodexTargetRoot,
      explicitCodexTargetRoot
    },
    paths: {
      emptyPlanPath,
      existingCodexPlanPath,
      explicitAllPlanPath,
      explicitCodexPlanPath
    },
    issues,
    emptyFullBeta: runtimePlanSummary(plans.emptyFullBeta),
    existingCodexAuto: runtimePlanSummary(plans.existingCodexAuto),
    explicitAll: runtimePlanSummary(plans.explicitAll),
    explicitCodex: runtimePlanSummary(plans.explicitCodex)
  };
}

function summarizePack(packInfo) {
  const files = (packInfo.files ?? []).map((file) => file.path ?? file);
  return {
    name: packInfo.name ?? null,
    version: packInfo.version ?? null,
    filename: packInfo.filename ?? null,
    fileCount: files.length,
    unpackedSize: packInfo.unpackedSize ?? null,
    metaIncluded: files.some((file) => String(file).startsWith(".meta/"))
  };
}

function buildAudit(args) {
  const root = normalizePath(args.root);
  const packageJson = readJson(path.join(root, "package.json"));
  const scratchRoot = createScratch(args);
  const fixtureRoot = path.join(scratchRoot, "fixture-project");
  let state = "pass";
  let packInfo = null;
  let tarballPath = null;
  let installResult = null;
  let commandResults = [];
  let installProbe = null;
  let runtimeHostSelectionProbe = null;
  let installSyncApprovalProbe = null;
  const issues = [];

  try {
    const packResult = runNpm(["pack", root, "--json", "--pack-destination", scratchRoot], root, args.timeoutMs);
    if (packResult.error) issues.push(`pack_spawn_error:${packResult.error}`);
    if (packResult.exitCode !== 0) issues.push(`pack_nonzero_exit:${packResult.exitCode ?? "null"}`);

    if (issues.length === 0) {
      packInfo = parsePackJson(packResult.stdout);
      tarballPath = resolvePackedTarball(scratchRoot, packInfo);
      if (!fs.existsSync(tarballPath)) issues.push("packed_tarball_missing");
    }

    fs.mkdirSync(fixtureRoot, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );

    if (issues.length === 0) {
      installResult = runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], fixtureRoot, args.timeoutMs);
      if (installResult.error) issues.push(`install_spawn_error:${installResult.error}`);
      if (installResult.exitCode !== 0) issues.push(`install_nonzero_exit:${installResult.exitCode ?? "null"}`);
    }

    if (issues.length === 0) {
      commandResults = Object.keys(packageJson.bin ?? {})
        .sort((left, right) => left.localeCompare(right))
        .map((name) => checkInstalledHelp(fixtureRoot, name, args.timeoutMs));
    }

    if (issues.length === 0) {
      installProbe = buildInstallProbe(fixtureRoot, scratchRoot, packageJson, args.timeoutMs);
    }

    if (issues.length === 0) {
      runtimeHostSelectionProbe = buildRuntimeHostSelectionProbe(fixtureRoot, scratchRoot, packageJson, args.timeoutMs);
    }

    if (issues.length === 0) {
      installSyncApprovalProbe = buildInstalledSyncApprovalProbe(fixtureRoot, scratchRoot, packageJson, args.timeoutMs);
    }
  } finally {
    if (installProbe && args.keepWorkdir) {
      writeJson(path.join(scratchRoot, "install-probe-summary.json"), installProbe);
    }
    if (installSyncApprovalProbe && args.keepWorkdir) {
      writeJson(path.join(scratchRoot, "install-sync-approval-probe-summary.json"), installSyncApprovalProbe);
    }
    if (runtimeHostSelectionProbe && args.keepWorkdir) {
      writeJson(path.join(scratchRoot, "runtime-host-selection-probe-summary.json"), runtimeHostSelectionProbe);
    }
    if (!args.keepWorkdir) {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  const blockedCommands = commandResults.filter((item) => item.status === "blocked");
  if (installProbe?.state === "blocked") issues.push(...installProbe.issues.map((issue) => `install_probe:${issue}`));
  if (runtimeHostSelectionProbe?.state === "blocked") {
    issues.push(...runtimeHostSelectionProbe.issues.map((issue) => `runtime_host_selection_probe:${issue}`));
  }
  if (installSyncApprovalProbe?.state === "blocked") {
    issues.push(...installSyncApprovalProbe.issues.map((issue) => `install_sync_approval_probe:${issue}`));
  }
  if (issues.length > 0 || blockedCommands.length > 0) state = "blocked";

  return {
    generated: new Date().toISOString(),
    mode: "pack_install_smoke_audit",
    root,
    packageName: packageJson.name ?? null,
    packageVersion: packageJson.version ?? null,
    state,
    scratch: {
      root: scratchRoot,
      kept: args.keepWorkdir,
      fixtureRoot
    },
    pack: packInfo ? summarizePack(packInfo) : null,
    install: installResult
      ? {
          exitCode: installResult.exitCode,
          signal: installResult.signal,
          stdoutBytes: installResult.stdoutBytes,
          stderrBytes: installResult.stderrBytes,
          timedOut: installResult.timedOut
        }
      : null,
    installProbe,
    installSyncApprovalProbe,
    summary: {
      commands: commandResults.length,
      pass: commandResults.filter((item) => item.status === "pass").length,
      blocked: blockedCommands.length,
      issues
    },
    commandResults,
    runtimeHostSelectionProbe,
    guardrails: [
      "Builds and installs only into an isolated scratch project.",
      "Uses npm pack output rather than source-root execution.",
      "Runs installed node_modules/.bin shims with --help.",
      "Runs installed plan/install commands against an isolated scratch target project.",
      "Runs installed runtime host selection checks against isolated scratch target projects.",
      "Runs installed drift/sync/approval commands against an isolated scratch target project.",
      "Does not pass project paths to commands.",
      "Does not inspect any target project.",
      "Writes only isolated scratch target files."
    ]
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Pack Install Smoke Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Root: \`${audit.root}\``);
  lines.push(`Package: \`${audit.packageName}@${audit.packageVersion}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Commands: ${audit.summary.commands}`);
  lines.push(`- Pass: ${audit.summary.pass}`);
  lines.push(`- Blocked: ${audit.summary.blocked}`);
  lines.push(`- Issues: ${audit.summary.issues.length === 0 ? "none" : audit.summary.issues.join(", ")}`);
  lines.push(`- Scratch kept: ${audit.scratch.kept}`);
  lines.push("");

  if (audit.pack) {
    lines.push("## Pack");
    lines.push("");
    lines.push(`- File count: ${audit.pack.fileCount}`);
    lines.push(`- Unpacked size: ${audit.pack.unpackedSize ?? "unknown"}`);
    lines.push(`- .meta included: ${audit.pack.metaIncluded}`);
    lines.push("");
  }

  if (audit.installProbe) {
    lines.push("## Installed Install Probe");
    lines.push("");
    lines.push(`- State: \`${audit.installProbe.state}\``);
    lines.push(`- Plan operations: ${audit.installProbe.plan?.operations ?? "missing"}`);
    lines.push(`- Target files after write: ${audit.installProbe.targetFiles}`);
    lines.push(`- Issues: ${audit.installProbe.issues.length === 0 ? "none" : audit.installProbe.issues.join(", ")}`);
    lines.push("");
  }

  if (audit.installSyncApprovalProbe) {
    lines.push("## Installed Install Sync Approval Probe");
    lines.push("");
    lines.push(`- State: \`${audit.installSyncApprovalProbe.state}\``);
    lines.push(`- Drift count: ${audit.installSyncApprovalProbe.driftAudit?.summary?.driftCount ?? "missing"}`);
    lines.push(`- Sync candidates: ${audit.installSyncApprovalProbe.syncPlan?.summary?.statusCounts?.candidate_sync ?? "missing"}`);
    lines.push(`- Approval write: ${audit.installSyncApprovalProbe.approvalWrite?.statusCounts?.wrote ?? "missing"}`);
    lines.push(`- Sync write: ${audit.installSyncApprovalProbe.syncWrite?.statusCounts?.synced ?? "missing"}`);
    lines.push(`- Issues: ${audit.installSyncApprovalProbe.issues.length === 0 ? "none" : audit.installSyncApprovalProbe.issues.join(", ")}`);
    lines.push("");
  }

  if (audit.runtimeHostSelectionProbe) {
    lines.push("## Runtime Host Selection Probe");
    lines.push("");
    lines.push(`- State: \`${audit.runtimeHostSelectionProbe.state}\``);
    lines.push(`- Empty full-beta runtime ops: ${audit.runtimeHostSelectionProbe.emptyFullBeta?.runtimeOps ?? "missing"}`);
    lines.push(`- Existing Codex auto runtime ops: ${audit.runtimeHostSelectionProbe.existingCodexAuto?.runtimeOps ?? "missing"}`);
    lines.push(`- Explicit all runtime ops: ${audit.runtimeHostSelectionProbe.explicitAll?.runtimeOps ?? "missing"}`);
    lines.push(`- Explicit Codex runtime ops: ${audit.runtimeHostSelectionProbe.explicitCodex?.runtimeOps ?? "missing"}`);
    lines.push(`- Issues: ${audit.runtimeHostSelectionProbe.issues.length === 0 ? "none" : audit.runtimeHostSelectionProbe.issues.join(", ")}`);
    lines.push("");
  }

  lines.push("## Commands");
  lines.push("");
  lines.push("| Command | Shim | Status | Issues |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of audit.commandResults) {
    lines.push(`| \`${item.name}\` | \`${item.shimPath}\` | \`${item.status}\` | ${item.issues.length === 0 ? "" : item.issues.join(", ")} |`);
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
  const audit = buildAudit(args);
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
  if (args.out) {
    const outPath = normalizePath(args.out);
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
  console.error(`gamespec-audit-pack-install-smoke: ${error.message}`);
  process.exit(1);
}
