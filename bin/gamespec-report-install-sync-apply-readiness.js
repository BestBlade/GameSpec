#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec install sync apply readiness reporter

Usage:
  node bin/gamespec-report-install-sync-apply-readiness.js --sync-plan <install-sync-plan.json> --approval-plan <install-sync-approval-plan.json> [--approval-report <approval-execution-report.json>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Checks whether a product-managed install sync is ready for guarded human apply.
  - Validates sync plan, approval plan, optional approval report, source hashes, and target base hashes.
  - Emits exact next commands for approval write and sync write.
  - Refuses report output inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--sync-plan") {
      args.syncPlan = argv[++i];
    } else if (arg === "--approval-plan") {
      args.approvalPlan = argv[++i];
    } else if (arg === "--approval-report") {
      args.approvalReport = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.syncPlan) {
    console.error("Missing --sync-plan <install-sync-plan.json>.");
    usage(1);
  }
  if (!args.approvalPlan) {
    console.error("Missing --approval-plan <install-sync-approval-plan.json>.");
    usage(1);
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function command(parts) {
  return parts.map((part) => {
    const text = String(part);
    return /[\s"'&|<>]/u.test(text) ? `"${text.replace(/"/gu, '\\"')}"` : text;
  }).join(" ");
}

function powershellArg(part) {
  const text = String(part);
  return /^[A-Za-z0-9_./\\:-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "''")}'`;
}

function powershellCommand(parts) {
  return parts.map(powershellArg).join(" ");
}

function withCmdExecutionCwd(cwd, parts) {
  return `cd /d ${command([cwd])} && ${command(parts)}`;
}

function withPowerShellExecutionCwd(cwd, parts) {
  return `Set-Location -LiteralPath ${powershellArg(cwd)} -ErrorAction Stop; ${powershellCommand(parts)}`;
}

function buildShellContextCommands(cwd, commandParts) {
  return {
    powershell: Object.fromEntries(
      Object.entries(commandParts).map(([name, parts]) => [name, withPowerShellExecutionCwd(cwd, parts)])
    ),
    cmd: Object.fromEntries(
      Object.entries(commandParts).map(([name, parts]) => [name, withCmdExecutionCwd(cwd, parts)])
    )
  };
}

function renderCommandEntries(lines, commands) {
  for (const [name, value] of Object.entries(commands)) {
    lines.push(`- ${name}:`);
    lines.push(`  \`${value}\``);
  }
}

function validateSyncPlan(plan) {
  const issues = [];
  if (plan.mode !== "install_sync_plan_read_only") issues.push("sync_plan_mode_mismatch");
  if (!plan.projectRoot) issues.push("sync_plan_missing_project_root");
  if (!plan.productRoot) issues.push("sync_plan_missing_product_root");
  if (!Array.isArray(plan.operations)) issues.push("sync_plan_missing_operations");
  if (plan.summary?.physicalWritesNow !== false) issues.push("sync_plan_physical_writes_not_false");
  if (plan.applyPolicy?.requiresApprovalExecutionReport !== true) {
    issues.push("sync_plan_missing_approval_policy");
  }
  return issues;
}

function validateApprovalPlan(approvalPlan, syncPlan, syncPlanHash) {
  const issues = [];
  if (approvalPlan.mode !== "install_sync_approval_plan_read_only") {
    issues.push("approval_plan_mode_mismatch");
  }
  if (normalizePath(approvalPlan.projectRoot ?? ".") !== normalizePath(syncPlan.projectRoot ?? ".")) {
    issues.push("approval_plan_project_root_mismatch");
  }
  if (approvalPlan.sourcePlanSha256 !== syncPlanHash) {
    issues.push("approval_plan_source_sha_mismatch");
  }
  if (approvalPlan.writePolicy?.physicalWritesNow !== false) {
    issues.push("approval_plan_physical_writes_not_false");
  }
  if (!approvalPlan.recordTarget?.startsWith(`gamespec/projects/${approvalPlan.projectId}/approvals/install-sync/`)) {
    issues.push("approval_plan_record_target_mismatch");
  }
  return issues;
}

function operationKey(operation) {
  return [
    operation.id,
    operation.targetPath,
    operation.sourcePath,
    operation.targetBaseSha256,
    operation.plannedSha256
  ].join("|");
}

function analyzeOperations(syncPlan) {
  const projectRoot = normalizePath(syncPlan.projectRoot);
  const productRoot = normalizePath(syncPlan.productRoot);
  return syncPlan.operations.map((operation) => {
    const issues = [];
    const sourceAbs = normalizePath(operation.sourceAbs ?? productRoot);
    const targetAbs = normalizePath(operation.targetAbs ?? projectRoot);
    let sourceSha256 = null;
    let currentTargetSha256 = null;
    let status = "would_sync";

    if (operation.status !== "candidate_sync") issues.push("operation_not_candidate");
    if (!isPathInside(sourceAbs, productRoot)) issues.push("source_outside_product_root");
    if (!isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project_root");
    if (isPathInside(targetAbs, path.join(projectRoot, "gamespec", "projects"))) {
      issues.push("target_inside_project_truth");
    }
    if (!fs.existsSync(sourceAbs)) issues.push("source_missing");
    if (!fs.existsSync(targetAbs)) issues.push("target_missing");

    if (issues.length === 0) {
      sourceSha256 = sha256(fs.readFileSync(sourceAbs));
      currentTargetSha256 = sha256(fs.readFileSync(targetAbs));
      if (sourceSha256 !== operation.sourceSha256 || sourceSha256 !== operation.plannedSha256) {
        issues.push("source_sha256_mismatch");
        status = "blocked";
      } else if (currentTargetSha256 === sourceSha256) {
        status = "already_current";
      } else if (currentTargetSha256 !== operation.targetBaseSha256) {
        issues.push("target_base_sha256_mismatch");
        status = "blocked";
      }
    } else {
      status = "blocked";
    }

    return {
      id: operation.id,
      action: operation.action ?? null,
      surface: operation.surface ?? null,
      sourcePath: operation.sourcePath,
      targetPath: operation.targetPath,
      sourceAbs,
      targetAbs,
      status,
      issues,
      sourceSha256,
      targetBaseSha256: operation.targetBaseSha256 ?? null,
      currentTargetSha256,
      plannedSha256: operation.plannedSha256 ?? null,
      reason: operation.reason ?? null,
      sameIgnoringTrailingWhitespace: operation.sameIgnoringTrailingWhitespace ?? false,
      sameIgnoringAllWhitespace: operation.sameIgnoringAllWhitespace ?? false,
      firstDifferingLine: operation.firstDifferingLine ?? null
    };
  });
}

function validateApprovalReport(approvalReportPath, approvalReport, syncPlan, syncPlanHash, analyzedOperations) {
  const issues = [];
  const projectRoot = normalizePath(syncPlan.projectRoot);
  const candidateOperations = syncPlan.operations.filter((operation) => operation.status === "candidate_sync");
  const approvedOperations = approvalReport.approvalSubject?.operations ?? [];
  const approvedKeys = new Set(approvedOperations.map(operationKey));
  const approvalRecordAbs = approvalReport.operation?.targetAbs ? normalizePath(approvalReport.operation.targetAbs) : null;

  if (approvalReport.mode !== "write") issues.push("approval_report_not_write_mode");
  if (normalizePath(approvalReport.projectRoot ?? ".") !== projectRoot) {
    issues.push("approval_report_project_root_mismatch");
  }
  if (approvalReport.approvalSubject?.type !== "install_sync_plan") {
    issues.push("approval_report_subject_type_mismatch");
  }
  if (approvalReport.approvalSubject?.sourcePlanSha256 !== syncPlanHash) {
    issues.push("approval_report_source_sha_mismatch");
  }
  if ((approvalReport.statusCounts?.blocked ?? 0) > 0) issues.push("approval_report_blocked");
  if (((approvalReport.statusCounts?.wrote ?? 0) + (approvalReport.statusCounts?.already_current ?? 0)) < 1) {
    issues.push("approval_record_not_written");
  }
  if (!approvalRecordAbs) issues.push("approval_record_target_missing");
  if (approvalRecordAbs && !isPathInside(approvalRecordAbs, projectRoot)) {
    issues.push("approval_record_outside_project");
  }
  if (approvalRecordAbs && !fs.existsSync(approvalRecordAbs)) {
    issues.push("approval_record_file_missing");
  }
  if (approvalRecordAbs && fs.existsSync(approvalRecordAbs) && approvalReport.operation?.plannedSha256) {
    const currentSha = sha256(fs.readFileSync(approvalRecordAbs));
    if (currentSha !== approvalReport.operation.plannedSha256) {
      issues.push("approval_record_sha256_mismatch");
    }
  }
  if (approvedOperations.length !== candidateOperations.length) {
    issues.push("approval_operation_count_mismatch");
  }
  for (const operation of candidateOperations) {
    if (!approvedKeys.has(operationKey(operation))) {
      issues.push(`approval_missing_operation:${operation.id}`);
    }
  }
  if (analyzedOperations.some((operation) => operation.status === "blocked")) {
    issues.push("sync_operation_blocked_now");
  }

  return {
    path: approvalReportPath,
    status: issues.length === 0 ? "pass" : "blocked",
    issues,
    approvalRecord: approvalReport.operation?.targetPath ?? null,
    sourcePlanSha256: approvalReport.approvalSubject?.sourcePlanSha256 ?? null,
    approvedOperations: approvedOperations.length
  };
}

function countStatuses(operations) {
  const counts = { would_sync: 0, already_current: 0, blocked: 0 };
  for (const operation of operations) counts[operation.status] += 1;
  return counts;
}

function buildReadiness(args) {
  const syncPlanPath = normalizePath(args.syncPlan);
  const approvalPlanPath = normalizePath(args.approvalPlan);
  const providedApprovalReportPath = args.approvalReport ? normalizePath(args.approvalReport) : null;
  const reportsRoot = path.dirname(syncPlanPath);
  const suggestedApprovalReportPath = providedApprovalReportPath ?? path.join(reportsRoot, "install-sync-approval-write-report.json");
  const suggestedSyncWriteReportPath = path.join(reportsRoot, "install-sync-write-report.json");
  const syncPlanBuffer = fs.readFileSync(syncPlanPath);
  const syncPlan = JSON.parse(syncPlanBuffer.toString("utf8"));
  const approvalPlan = readJson(approvalPlanPath);
  const syncPlanHash = sha256(syncPlanBuffer);
  const issues = [];

  issues.push(...validateSyncPlan(syncPlan));
  issues.push(...validateApprovalPlan(approvalPlan, syncPlan, syncPlanHash));
  if (issues.length > 0) {
    throw new Error(`Invalid readiness inputs: ${issues.join(", ")}`);
  }

  const operations = analyzeOperations(syncPlan);
  const operationStatusCounts = countStatuses(operations);
  let approvalReport = null;
  if (providedApprovalReportPath) {
    approvalReport = validateApprovalReport(
      providedApprovalReportPath,
      readJson(providedApprovalReportPath),
      syncPlan,
      syncPlanHash,
      operations
    );
  }

  let status = "awaiting_approval_record";
  const readinessIssues = [];
  if (operations.some((operation) => operation.status === "blocked")) {
    status = "blocked";
    readinessIssues.push("sync_operation_blocked_now");
  } else if (operationStatusCounts.already_current === operations.length) {
    status = "already_current";
  } else if (!approvalReport) {
    status = "awaiting_approval_record";
  } else if (approvalReport.status === "blocked") {
    status = "blocked";
    readinessIssues.push(...approvalReport.issues);
  } else {
    status = "ready_for_sync_write";
  }

  const nextCommandParts = {
    approvalDryRun: [
      "node", ".\\bin\\gamespec-execute-install-sync-approval-plan.js",
      "--plan", approvalPlanPath,
      "--format", "json"
    ],
    approvalWrite: [
      "node", ".\\bin\\gamespec-execute-install-sync-approval-plan.js",
      "--plan", approvalPlanPath,
      "--format", "json",
      "--out", "<approval-report.json>",
      "--write",
      "--approve"
    ],
    syncDryRun: [
      "node", ".\\bin\\gamespec-execute-install-sync-plan.js",
      "--plan", syncPlanPath,
      "--format", "json"
    ],
    syncWrite: [
      "node", ".\\bin\\gamespec-execute-install-sync-plan.js",
      "--plan", syncPlanPath,
      "--approval", args.approvalReport ? normalizePath(args.approvalReport) : "<approval-report.json>",
      "--format", "json",
      "--out", "<sync-write-report.json>",
      "--write",
      "--approve"
    ],
    postCheck: [
      "node", ".\\bin\\gamespec-plan-install.js",
      "--project", normalizePath(syncPlan.projectRoot),
      "--surface", "all",
      "--format", "json"
    ]
  };
  const contextCommandParts = {
    approvalDryRun: nextCommandParts.approvalDryRun,
    approvalWrite: [
      "node", ".\\bin\\gamespec-execute-install-sync-approval-plan.js",
      "--plan", approvalPlanPath,
      "--format", "json",
      "--out", suggestedApprovalReportPath,
      "--write",
      "--approve"
    ],
    syncDryRun: nextCommandParts.syncDryRun,
    syncWrite: [
      "node", ".\\bin\\gamespec-execute-install-sync-plan.js",
      "--plan", syncPlanPath,
      "--approval", suggestedApprovalReportPath,
      "--format", "json",
      "--out", suggestedSyncWriteReportPath,
      "--write",
      "--approve"
    ],
    postCheck: nextCommandParts.postCheck
  };

  const report = {
    generated: new Date().toISOString(),
    mode: "install_sync_apply_readiness_report_read_only",
    status,
    projectRoot: syncPlan.projectRoot,
    productRoot: syncPlan.productRoot,
    projectId: approvalPlan.projectId,
    sourcePlans: {
      syncPlan: syncPlanPath,
      syncPlanSha256: syncPlanHash,
      approvalPlan: approvalPlanPath,
      approvalPlanSourcePlanSha256: approvalPlan.sourcePlanSha256
    },
    summary: {
      operations: operations.length,
      operationStatusCounts,
      approvalReportStatus: approvalReport?.status ?? "missing",
      readinessIssues
    },
    decisionPacket: {
      humanDecisionRequired: status === "awaiting_approval_record" || status === "ready_for_sync_write",
      recommendedDecision:
        status === "awaiting_approval_record"
          ? "Review the planned product-managed sync and decide whether to write the project-local approval record."
          : status === "ready_for_sync_write"
            ? "Review the written approval report and decide whether to perform the guarded sync write."
            : status === "already_current"
              ? "No approval or sync write is currently required."
              : "Do not approve or sync until readiness issues are resolved.",
      approvalRecordTarget: approvalPlan.recordTarget,
      candidateApprovalRecordMarkdown: approvalPlan.candidateRecordMarkdown ?? null,
      operationHighlights: operations.map((operation) => ({
        id: operation.id,
        status: operation.status,
        targetPath: operation.targetPath,
        sourcePath: operation.sourcePath,
        surface: operation.surface,
        reason: operation.reason,
        sameIgnoringTrailingWhitespace: operation.sameIgnoringTrailingWhitespace,
        sameIgnoringAllWhitespace: operation.sameIgnoringAllWhitespace,
        firstDifferingLine: operation.firstDifferingLine
      })),
      snapshotWarning: "This packet describes evidence snapshots. Executors still re-check source and target hashes before physical writes."
    },
    approvalRecord: {
      plannedTarget: approvalPlan.recordTarget,
      approvalReport
    },
    operations,
    executionCwd: normalizePath(syncPlan.productRoot),
    suggestedReportPaths: {
      approvalWriteReport: suggestedApprovalReportPath,
      syncWriteReport: suggestedSyncWriteReportPath
    },
    nextCommands: Object.fromEntries(
      Object.entries(nextCommandParts).map(([name, parts]) => [name, command(parts)])
    ),
    writeGate: {
      readyForApprovalWrite: status === "awaiting_approval_record",
      readyForSyncWrite: status === "ready_for_sync_write",
      directUserApprovalStillRequired: status === "awaiting_approval_record" || status === "ready_for_sync_write"
    },
    guardrails: [
      "Read-only readiness report.",
      "Does not write the target project.",
      "Approval dry-run evidence is not approval.",
      "Approval record write must happen before sync write.",
      "Sync write still requires --write --approve and a matching approval report.",
      "Source and target hashes are rechecked against the current filesystem."
    ]
  };
  report.contextCommands = Object.fromEntries(
    Object.entries(contextCommandParts).map(([name, parts]) => [name, withCmdExecutionCwd(report.executionCwd, parts)])
  );
  report.shellContextCommands = buildShellContextCommands(report.executionCwd, contextCommandParts);
  return report;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Install Sync Apply Readiness");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Status: \`${report.status}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${report.summary.operations}`);
  lines.push(`- Would sync: ${report.summary.operationStatusCounts.would_sync}`);
  lines.push(`- Already current: ${report.summary.operationStatusCounts.already_current}`);
  lines.push(`- Blocked: ${report.summary.operationStatusCounts.blocked}`);
  lines.push(`- Approval report: \`${report.summary.approvalReportStatus}\``);
  lines.push(`- Readiness issues: ${report.summary.readinessIssues.length === 0 ? "none" : report.summary.readinessIssues.join(", ")}`);
  lines.push("");

  lines.push("## Approval Record");
  lines.push("");
  lines.push(`- Planned target: \`${report.approvalRecord.plannedTarget}\``);
  if (report.approvalRecord.approvalReport) {
    lines.push(`- Approval report: \`${report.approvalRecord.approvalReport.path}\``);
    lines.push(`- Approval record: \`${report.approvalRecord.approvalReport.approvalRecord ?? "missing"}\``);
  } else {
    lines.push("- Approval report: missing");
  }
  lines.push("");

  lines.push("## Decision Packet");
  lines.push("");
  lines.push(`- Human decision required: ${report.decisionPacket.humanDecisionRequired}`);
  lines.push(`- Recommended decision: ${report.decisionPacket.recommendedDecision}`);
  lines.push(`- Approval record target: \`${report.decisionPacket.approvalRecordTarget}\``);
  lines.push(`- Snapshot warning: ${report.decisionPacket.snapshotWarning}`);
  lines.push("");

  lines.push("## Operations");
  lines.push("");
  for (const operation of report.operations) {
    lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
    if (operation.action) lines.push(`  - action: \`${operation.action}\``);
    if (operation.surface) lines.push(`  - surface: \`${operation.surface}\``);
    lines.push(`  - status: \`${operation.status}\``);
    if (operation.reason) lines.push(`  - reason: \`${operation.reason}\``);
    lines.push(`  - same ignoring trailing whitespace: ${operation.sameIgnoringTrailingWhitespace}`);
    lines.push(`  - same ignoring all whitespace: ${operation.sameIgnoringAllWhitespace}`);
    if (operation.firstDifferingLine) {
      lines.push(`  - first differing line: ${operation.firstDifferingLine.line}`);
      lines.push(`  - source line: \`${operation.firstDifferingLine.source ?? ""}\``);
      lines.push(`  - target line: \`${operation.firstDifferingLine.target ?? ""}\``);
    }
    lines.push(`  - target base sha256: \`${operation.targetBaseSha256 ?? "missing"}\``);
    lines.push(`  - current target sha256: \`${operation.currentTargetSha256 ?? "missing"}\``);
    if (operation.issues.length > 0) lines.push(`  - issues: ${operation.issues.join(", ")}`);
  }
  lines.push("");

  if (report.decisionPacket.candidateApprovalRecordMarkdown) {
    lines.push("## Candidate Approval Record");
    lines.push("");
    lines.push("```markdown");
    lines.push(report.decisionPacket.candidateApprovalRecordMarkdown.trimEnd());
    lines.push("```");
    lines.push("");
  }

  lines.push("## Next Commands");
  lines.push("");
  lines.push(`Execution cwd: \`${report.executionCwd}\``);
  lines.push(`Approval write report: \`${report.suggestedReportPaths.approvalWriteReport}\``);
  lines.push(`Sync write report: \`${report.suggestedReportPaths.syncWriteReport}\``);
  lines.push("");
  renderCommandEntries(lines, report.nextCommands);
  lines.push("");

  if (report.shellContextCommands?.powershell) {
    lines.push("## PowerShell Context Commands");
    lines.push("");
    renderCommandEntries(lines, report.shellContextCommands.powershell);
    lines.push("");
  }

  if (report.shellContextCommands?.cmd) {
    lines.push("## Cmd Context Commands");
    lines.push("");
    renderCommandEntries(lines, report.shellContextCommands.cmd);
    lines.push("");
  }

  lines.push("## Legacy Context Commands");
  lines.push("");
  renderCommandEntries(lines, report.contextCommands);
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of report.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const syncPlan = readJson(normalizePath(args.syncPlan));
  const projectRoot = syncPlan.projectRoot ? normalizePath(syncPlan.projectRoot) : null;
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write install sync apply readiness report inside target project: ${outPath}`);
    }
  }

  const report = buildReadiness(args);
  const rendered = args.format === "json" ? renderJson(report) : renderMarkdown(report);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}

try {
  main();
} catch (error) {
  console.error(`gamespec-report-install-sync-apply-readiness: ${error.message}`);
  process.exit(1);
}
