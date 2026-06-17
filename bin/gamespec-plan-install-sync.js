#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ALLOWED_RECOMMENDATION = "candidate_for_explicit_product_surface_sync_after_review";

function usage(exitCode = 0) {
  const text = `GameSpec install sync planner

Usage:
  node bin/gamespec-plan-install-sync.js --drift <install-drift-audit.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Consumes an install drift audit.
  - Plans explicit product-managed surface sync candidates only.
  - Never targets gamespec/projects/.
  - Does not write project files.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--drift") {
      args.drift = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.drift) {
    console.error("Missing --drift <install-drift-audit.json>.");
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

function fromPosix(posixPath) {
  return posixPath.split("/");
}

function planOperation(item, index, drift) {
  const issues = [];
  const sourceAbs = item.sourcePath
    ? normalizePath(path.join(drift.productRoot, ...fromPosix(item.sourcePath)))
    : null;
  const targetAbs = item.targetPath
    ? normalizePath(path.join(drift.projectRoot, ...fromPosix(item.targetPath)))
    : null;

  if (item.status !== "blocked_target_exists_differs") issues.push("drift_status_not_syncable");
  if (item.projectTruthTarget) issues.push("target_inside_project_truth");
  if (item.recommendedAction !== ALLOWED_RECOMMENDATION) issues.push("unsupported_recommendation");
  if (item.issues?.length > 0) issues.push(`drift_item_has_issues:${item.issues.join(",")}`);
  if (!item.source?.sha256) issues.push("missing_source_sha256");
  if (!item.target?.sha256) issues.push("missing_target_sha256");
  if (!sourceAbs || !isPathInside(sourceAbs, normalizePath(drift.productRoot))) issues.push("source_outside_product_root");
  if (!targetAbs || !isPathInside(targetAbs, normalizePath(drift.projectRoot))) issues.push("target_outside_project_root");

  return {
    id: `install_sync_${String(index + 1).padStart(3, "0")}`,
    action: "replace_with_product_surface",
    surface: item.surface,
    sourcePath: item.sourcePath,
    sourceAbs,
    targetPath: item.targetPath,
    targetAbs,
    status: issues.length === 0 ? "candidate_sync" : "blocked",
    issues,
    sourceSha256: item.source?.sha256 ?? null,
    targetBaseSha256: item.target?.sha256 ?? null,
    plannedSha256: item.source?.sha256 ?? null,
    sameIgnoringTrailingWhitespace: item.sameIgnoringTrailingWhitespace ?? false,
    sameIgnoringAllWhitespace: item.sameIgnoringAllWhitespace ?? false,
    firstDifferingLine: item.firstDifferingLine ?? null,
    reason: item.recommendedAction
  };
}

function countStatuses(operations) {
  const counts = { candidate_sync: 0, blocked: 0 };
  for (const operation of operations) counts[operation.status] += 1;
  return counts;
}

function buildPlan(driftPath) {
  const drift = JSON.parse(fs.readFileSync(driftPath, "utf8"));
  if (drift.mode !== "install_drift_audit_read_only") {
    throw new Error(`Unsupported drift audit mode: ${drift.mode}`);
  }
  if (!drift.projectRoot || !drift.productRoot || !Array.isArray(drift.driftItems)) {
    throw new Error("Drift audit must contain projectRoot, productRoot, and driftItems.");
  }

  const operations = drift.driftItems.map((item, index) => planOperation(item, index, drift));
  return {
    generated: new Date().toISOString(),
    mode: "install_sync_plan_read_only",
    sourceDriftAudit: driftPath,
    projectRoot: drift.projectRoot,
    productRoot: drift.productRoot,
    productVersion: drift.productVersion ?? null,
    summary: {
      physicalWritesNow: false,
      operations: operations.length,
      statusCounts: countStatuses(operations)
    },
    applyPolicy: {
      physicalWritesNow: false,
      requiresExplicitWrite: true,
      requiresApprove: true,
      requiresApprovalExecutionReport: true,
      requiresTargetBaseSha256Match: true,
      allowedRecommendation: ALLOWED_RECOMMENDATION,
      forbiddenTargetPrefix: "gamespec/projects/"
    },
    operations,
    guardrails: [
      "This plan performs no writes.",
      "Only product-managed install drift candidates are planned.",
      "Project truth under gamespec/projects/ is never syncable by this plan.",
      "Executor must re-check source and target hashes before any write.",
      "Dry-run evidence is not write approval."
    ]
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Install Sync Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`Project: \`${plan.projectRoot}\``);
  lines.push(`Product root: \`${plan.productRoot}\``);
  lines.push(`Product version: \`${plan.productVersion ?? "unknown"}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${plan.summary.operations}`);
  lines.push(`- Physical writes now: ${plan.summary.physicalWritesNow}`);
  lines.push(`- Candidate sync: ${plan.summary.statusCounts.candidate_sync}`);
  lines.push(`- Blocked: ${plan.summary.statusCounts.blocked}`);
  lines.push("");

  lines.push("## Operations");
  lines.push("");
  for (const operation of plan.operations) {
    lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
    lines.push(`  - status: \`${operation.status}\``);
    lines.push(`  - target base sha256: \`${operation.targetBaseSha256 ?? "missing"}\``);
    lines.push(`  - planned sha256: \`${operation.plannedSha256 ?? "missing"}\``);
    if (operation.firstDifferingLine) lines.push(`  - first differing line: ${operation.firstDifferingLine.line}`);
    if (operation.issues.length > 0) lines.push(`  - issues: ${operation.issues.join(", ")}`);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of plan.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const driftPath = normalizePath(args.drift);
  const drift = JSON.parse(fs.readFileSync(driftPath, "utf8"));
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (drift.projectRoot && isPathInside(outPath, normalizePath(drift.projectRoot))) {
      throw new Error(`Refusing to write install sync plan inside target project: ${outPath}`);
    }
  }

  const plan = buildPlan(driftPath);
  const rendered = args.format === "json" ? renderJson(plan) : renderMarkdown(plan);
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
  console.error(`gamespec-plan-install-sync: ${error.message}`);
  process.exit(1);
}
