#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATUSES = [
  "would_sync",
  "synced",
  "already_current",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec install sync executor

Usage:
  node bin/gamespec-execute-install-sync-plan.js --plan <install-sync-plan.json> [--approval <approval-execution-report.json>] [--out <path>] [--format markdown|json] [--write] [--approve]

Rules:
  - Dry-run by default.
  - Syncs only explicit product-managed install drift plan operations.
  - Physical writes require --write and --approve.
  - Physical writes require a matching written install sync approval report.
  - Blocks stale target files by target base sha256.
  - Refuses targets under gamespec/projects/.
  - Refuses report output inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", write: false, approve: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--plan") {
      args.plan = argv[++i];
    } else if (arg === "--approval") {
      args.approval = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--approve") {
      args.approve = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.plan) {
    console.error("Missing --plan <install-sync-plan.json>.");
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

function isProjectTruthTarget(targetAbs, projectRoot) {
  return isPathInside(targetAbs, path.join(projectRoot, "gamespec", "projects"));
}

function validatePlan(plan) {
  if (plan.mode !== "install_sync_plan_read_only") {
    throw new Error(`Unsupported install sync plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.productRoot || !Array.isArray(plan.operations)) {
    throw new Error("Install sync plan must contain projectRoot, productRoot, and operations.");
  }
  if (plan.summary?.physicalWritesNow !== false || plan.applyPolicy?.physicalWritesNow !== false) {
    throw new Error("Install sync plan must be read-only with physicalWritesNow: false.");
  }
}

function analyzeOperation(plan, op) {
  const issues = [];
  const projectRoot = normalizePath(plan.projectRoot);
  const productRoot = normalizePath(plan.productRoot);
  const sourceAbs = normalizePath(op.sourceAbs ?? productRoot);
  const targetAbs = normalizePath(op.targetAbs ?? projectRoot);

  if (op.status !== "candidate_sync") issues.push("plan_operation_not_candidate");
  if (op.action !== "replace_with_product_surface") issues.push("unsupported_action");
  if (!isPathInside(sourceAbs, productRoot)) issues.push("source_outside_product_root");
  if (!isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project_root");
  if (isProjectTruthTarget(targetAbs, projectRoot)) issues.push("target_inside_project_truth");
  if (!fs.existsSync(sourceAbs)) issues.push("source_missing");
  if (!fs.existsSync(targetAbs)) issues.push("target_missing");

  let sourceSha256 = null;
  let currentTargetSha256 = null;
  let content = null;
  let status = "would_sync";

  if (issues.length === 0) {
    content = fs.readFileSync(sourceAbs);
    sourceSha256 = sha256(content);
    currentTargetSha256 = sha256(fs.readFileSync(targetAbs));
    if (sourceSha256 !== op.sourceSha256 || sourceSha256 !== op.plannedSha256) {
      issues.push("source_sha256_mismatch");
      status = "blocked";
    } else if (currentTargetSha256 === sourceSha256) {
      status = "already_current";
    } else if (currentTargetSha256 !== op.targetBaseSha256) {
      issues.push("target_base_sha256_mismatch");
      status = "blocked";
    }
  } else {
    status = "blocked";
  }

  return {
    id: op.id,
    action: op.action,
    surface: op.surface,
    sourcePath: op.sourcePath,
    sourceAbs,
    targetPath: op.targetPath,
    targetAbs,
    status,
    issues,
    sourceSha256,
    targetBaseSha256: op.targetBaseSha256 ?? null,
    currentTargetSha256,
    plannedSha256: op.plannedSha256 ?? null,
    sameIgnoringTrailingWhitespace: op.sameIgnoringTrailingWhitespace ?? false,
    content
  };
}

function countStatuses(operations) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const operation of operations) counts[operation.status] += 1;
  return counts;
}

function ensureCanWrite(operations) {
  const blocked = operations.filter((operation) => operation.status === "blocked");
  if (blocked.length > 0) {
    throw new Error(`Refusing to write because ${blocked.length} install sync operation(s) are blocked.`);
  }
}

function operationApprovalKey(operation) {
  return [
    operation.id,
    operation.targetPath,
    operation.sourcePath,
    operation.targetBaseSha256,
    operation.plannedSha256
  ].join("|");
}

function validateApprovalReport(approvalPath, planPath, plan) {
  const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  const issues = [];
  const planHash = sha256(fs.readFileSync(planPath));
  const candidates = plan.operations.filter((operation) => operation.status === "candidate_sync");
  const approvedOperations = approval.approvalSubject?.operations ?? [];
  const approvedKeys = new Set(approvedOperations.map(operationApprovalKey));
  const projectRoot = normalizePath(plan.projectRoot);
  const approvalRecordAbs = approval.operation?.targetAbs ? normalizePath(approval.operation.targetAbs) : null;

  if (approval.mode !== "write") issues.push("approval_report_not_write_mode");
  if (normalizePath(approval.projectRoot ?? ".") !== projectRoot) {
    issues.push("approval_project_root_mismatch");
  }
  if (!approvalRecordAbs) issues.push("approval_record_target_missing");
  if (approvalRecordAbs && !isPathInside(approvalRecordAbs, projectRoot)) issues.push("approval_record_outside_project");
  if (approvalRecordAbs && !fs.existsSync(approvalRecordAbs)) issues.push("approval_record_file_missing");
  if (approvalRecordAbs && fs.existsSync(approvalRecordAbs) && approval.operation?.plannedSha256) {
    const currentApprovalSha256 = sha256(fs.readFileSync(approvalRecordAbs));
    if (currentApprovalSha256 !== approval.operation.plannedSha256) issues.push("approval_record_sha256_mismatch");
  }
  if (approval.approvalSubject?.type !== "install_sync_plan") issues.push("approval_subject_type_mismatch");
  if (approval.approvalSubject?.sourcePlanSha256 !== planHash) issues.push("approval_source_plan_sha256_mismatch");
  if ((approval.statusCounts?.blocked ?? 0) > 0) issues.push("approval_report_blocked");
  if (((approval.statusCounts?.wrote ?? 0) + (approval.statusCounts?.already_current ?? 0)) < 1) {
    issues.push("approval_record_not_written");
  }
  if (approval.operation?.status !== "wrote" && approval.operation?.status !== "already_current") {
    issues.push("approval_operation_not_written");
  }
  if (approvedOperations.length !== candidates.length) issues.push("approval_operation_count_mismatch");
  for (const operation of candidates) {
    if (!approvedKeys.has(operationApprovalKey(operation))) {
      issues.push(`approval_missing_operation:${operation.id}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Approval report does not authorize install sync write: ${issues.join(", ")}`);
  }

  return {
    approvalReport: approvalPath,
    approvalRecord: approval.operation?.targetPath ?? null,
    projectId: approval.projectId ?? null,
    sourcePlanSha256: approval.approvalSubject.sourcePlanSha256,
    approvedOperations: approvedOperations.length
  };
}

function executeWrites(operations) {
  const writtenPaths = [];
  for (const operation of operations) {
    if (operation.status !== "would_sync") continue;
    fs.writeFileSync(operation.targetAbs, operation.content);
    operation.status = "synced";
    writtenPaths.push(operation.targetAbs);
  }
  return writtenPaths;
}

function buildReport(plan, planPath, mode, operations, writtenPaths, approval) {
  const safeOperations = operations.map((operation) => {
    const copy = { ...operation };
    delete copy.content;
    return copy;
  });
  return {
    generated: new Date().toISOString(),
    mode,
    projectRoot: plan.projectRoot,
    productRoot: plan.productRoot,
    productVersion: plan.productVersion ?? null,
    sourcePlan: planPath,
    approval,
    statusCounts: countStatuses(safeOperations),
    writtenPaths,
    operations: safeOperations,
    guardrails: [
      "Dry-run is the default behavior.",
      "Write mode requires --write and --approve.",
      "Write mode requires a matching written install sync approval report.",
      "Targets under gamespec/projects/ are refused.",
      "Source sha256 and target base sha256 are rechecked before writes.",
      "If any operation is blocked, write mode writes nothing.",
      "Already-current targets are treated as no-op."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Install Sync Execution Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project: \`${report.projectRoot}\``);
  lines.push(`Product root: \`${report.productRoot}\``);
  lines.push(`Product version: \`${report.productVersion ?? "unknown"}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of STATUSES) lines.push(`| \`${status}\` | ${report.statusCounts[status]} |`);
  lines.push("");

  lines.push("## Approval");
  lines.push("");
  if (report.approval) {
    lines.push(`- Report: \`${report.approval.approvalReport}\``);
    lines.push(`- Record: \`${report.approval.approvalRecord ?? "missing"}\``);
    lines.push(`- Source plan sha256: \`${report.approval.sourcePlanSha256}\``);
    lines.push(`- Approved operations: ${report.approval.approvedOperations}`);
  } else {
    lines.push("- Not required for dry-run.");
  }
  lines.push("");

  lines.push("## Operations");
  lines.push("");
  for (const operation of report.operations) {
    lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
    lines.push(`  - status: \`${operation.status}\``);
    lines.push(`  - target base sha256: \`${operation.targetBaseSha256 ?? "missing"}\``);
    lines.push(`  - current target sha256: \`${operation.currentTargetSha256 ?? "missing"}\``);
    lines.push(`  - planned sha256: \`${operation.plannedSha256 ?? "missing"}\``);
    if (operation.issues.length > 0) lines.push(`  - issues: ${operation.issues.join(", ")}`);
  }
  lines.push("");

  lines.push("## Written Paths");
  lines.push("");
  if (report.writtenPaths.length === 0) {
    lines.push("- None.");
  } else {
    for (const writtenPath of report.writtenPaths) lines.push(`- \`${writtenPath}\``);
  }
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
  if (args.write && !args.approve) {
    throw new Error("Physical write requires both --write and --approve.");
  }
  if (args.write && !args.approval) {
    throw new Error("Physical install sync write requires --approval <install-sync-approval-execution-report.json>.");
  }

  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  validatePlan(plan);
  const approval = args.write ? validateApprovalReport(normalizePath(args.approval), planPath, plan) : null;

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, normalizePath(plan.projectRoot))) {
      throw new Error(`Refusing to write install sync execution report inside target project: ${outPath}`);
    }
  }

  const operations = plan.operations.map((operation) => analyzeOperation(plan, operation));
  let writtenPaths = [];
  if (args.write) {
    ensureCanWrite(operations);
    writtenPaths = executeWrites(operations);
  }

  const report = buildReport(plan, planPath, args.write ? "write" : "dry_run", operations, writtenPaths, approval);
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
  console.error(`gamespec-execute-install-sync-plan: ${error.message}`);
  process.exit(1);
}
