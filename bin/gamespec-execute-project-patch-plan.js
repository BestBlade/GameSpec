#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATUSES = [
  "would_apply",
  "applied",
  "already_current",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec project patch executor

Usage:
  node bin/gamespec-execute-project-patch-plan.js --plan <project-patch-plan.json> [--readiness <readiness.json>] [--out <path>] [--format markdown|json] [--write] [--approve]

Rules:
  - Dry-run by default.
  - Applies only insert_text operations from a project patch plan.
  - Physical write requires --write, --approve, and matching --readiness.
  - Blocks if base sha256 does not match, unless the insertion is already current.
  - Refuses targets outside gamespec/projects/<project-id>/.
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
    } else if (arg === "--readiness") {
      args.readiness = argv[++i];
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
    console.error("Missing --plan <project-patch-plan.json>.");
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

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function validatePlan(plan) {
  if (plan.mode !== "project_patch_plan_read_only") {
    throw new Error(`Unsupported plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !Array.isArray(plan.operations)) {
    throw new Error("Plan must contain projectRoot, projectId, and operations.");
  }
  if (plan.applyPolicy?.physicalWritesNow !== false || plan.summary?.physicalWritesNow !== false) {
    throw new Error("Plan must be read-only with physicalWritesNow: false.");
  }
}

function validateReadiness(readinessPath, plan, planRaw) {
  const absPath = normalizePath(readinessPath);
  const readiness = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const issues = [];
  if (readiness.mode !== "project_patch_readiness_gate") issues.push("unsupported_readiness_mode");
  if (readiness.status !== "pass") issues.push("readiness_not_passed");
  if (readiness.writeGate?.readyForProjectPatchWrite !== true) issues.push("write_gate_not_ready");
  if (readiness.sourcePlan?.sha256 !== sha256(planRaw)) issues.push("source_plan_sha256_mismatch");
  if (normalizePath(readiness.projectRoot ?? "") !== normalizePath(plan.projectRoot)) issues.push("project_root_mismatch");
  if (readiness.projectId !== plan.projectId) issues.push("project_id_mismatch");
  if (readiness.selected?.decisionId !== plan.selected?.decisionId) issues.push("decision_id_mismatch");
  if (readiness.selected?.optionId !== plan.selected?.optionId) issues.push("selected_option_mismatch");

  if (issues.length > 0) {
    throw new Error(`Readiness gate is not valid for this patch plan: ${issues.join(", ")}`);
  }

  return {
    path: absPath,
    status: readiness.status,
    kind: readiness.gate?.kind ?? "unknown",
    sourcePlanSha256: readiness.sourcePlan?.sha256 ?? null,
    generated: readiness.generated ?? null
  };
}

function allInsertedLinesPresent(text, insertedLines) {
  return insertedLines
    .filter((line) => line.trim())
    .every((line) => text.includes(line));
}

function insertLines(text, oneBasedLine, insertedLines) {
  const normalized = text.replace(/\r\n/g, "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hadTrailingNewline) lines.pop();
  const insertAt = oneBasedLine - 1;
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > lines.length) {
    throw new Error(`Invalid insertion line: ${oneBasedLine}`);
  }
  const updated = [
    ...lines.slice(0, insertAt),
    ...insertedLines,
    ...lines.slice(insertAt)
  ].join("\n");
  return hadTrailingNewline ? `${updated}\n` : updated;
}

function operationTargetAbs(projectRoot, op) {
  return normalizePath(path.join(projectRoot, ...fromPosix(op.targetPath)));
}

function expectedProjectTruthRoot(projectRoot, projectId) {
  return path.join(projectRoot, "gamespec", "projects", projectId);
}

function buildOperation(plan, op) {
  const issues = [];
  const projectRoot = normalizePath(plan.projectRoot);
  const expectedRoot = expectedProjectTruthRoot(projectRoot, plan.projectId);
  const targetAbs = op.targetPath ? operationTargetAbs(projectRoot, op) : null;

  if (op.status === "blocked") issues.push("source_operation_blocked");
  if (op.action !== "insert_text") issues.push("unsupported_action");
  if (!op.targetPath) issues.push("missing_target_path");
  if (!Array.isArray(op.insertedLines) || op.insertedLines.length === 0) issues.push("missing_inserted_lines");
  if (!Number.isInteger(op.line) || op.line < 1) issues.push("invalid_line");
  if (!op.baseSha256) issues.push("missing_base_sha256");
  if (!fs.existsSync(projectRoot)) issues.push("project_root_missing");
  if (targetAbs && !isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project");
  if (targetAbs && !isPathInside(targetAbs, expectedRoot)) issues.push("target_outside_project_truth_root");
  if (op.targetPath && !op.targetPath.startsWith(`gamespec/projects/${plan.projectId}/`)) {
    issues.push("target_not_project_truth");
  }
  if (targetAbs && !fs.existsSync(targetAbs)) issues.push("target_missing");

  let currentSha256 = null;
  let content = null;
  let nextContent = null;
  let contentBytes = 0;
  let status = "would_apply";

  if (issues.length === 0) {
    content = fs.readFileSync(targetAbs, "utf8");
    currentSha256 = sha256(content);
    if (allInsertedLinesPresent(content, op.insertedLines)) {
      status = "already_current";
    } else if (currentSha256 !== op.baseSha256) {
      status = "blocked";
      issues.push("base_sha256_mismatch");
    } else {
      try {
        nextContent = insertLines(content, op.line, op.insertedLines);
        contentBytes = Buffer.byteLength(nextContent, "utf8");
      } catch (error) {
        status = "blocked";
        issues.push(error.message);
      }
    }
  } else {
    status = "blocked";
  }

  return {
    id: op.id,
    op: "apply_insert_text",
    targetPath: op.targetPath,
    targetAbs,
    status,
    issues,
    baseSha256: op.baseSha256 ?? null,
    currentSha256,
    line: op.line ?? null,
    insertedLineCount: Array.isArray(op.insertedLines) ? op.insertedLines.length : 0,
    contentBytes,
    guardrails: op.guardrails ?? [],
    content: nextContent
  };
}

function countStatuses(operations) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const operation of operations) counts[operation.status] += 1;
  return counts;
}

function ensureNoBlocked(operations) {
  const blocked = operations.filter((operation) => operation.status === "blocked");
  if (blocked.length > 0) {
    throw new Error(`Refusing to write because ${blocked.length} patch operation(s) are blocked.`);
  }
}

function executeWrites(operations) {
  const written = [];
  for (const operation of operations) {
    if (operation.status === "already_current") continue;
    fs.writeFileSync(operation.targetAbs, operation.content, "utf8");
    operation.status = "applied";
    written.push(operation.targetAbs);
  }
  return written;
}

function buildReport(plan, planPath, mode, operations, writtenPaths, readiness) {
  const safeOperations = operations.map((operation) => {
    const copy = { ...operation };
    delete copy.content;
    return copy;
  });
  return {
    generated: new Date().toISOString(),
    mode,
    projectRoot: plan.projectRoot,
    projectId: plan.projectId,
    sourcePlan: planPath,
    selected: plan.selected,
    readiness,
    statusCounts: countStatuses(safeOperations),
    writtenPaths,
    operations: safeOperations,
    guardrails: [
      "Dry-run is the default behavior.",
      "Write mode requires --write, --approve, and a matching readiness report.",
      "All target files must stay under gamespec/projects/<project-id>/.",
      "Base sha256 must match before applying a pending insertion.",
      "If any operation is blocked, write mode writes nothing.",
      "Already-current insertions are treated as no-op."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Project Patch Execution Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");

  lines.push("## Readiness");
  lines.push("");
  if (report.readiness) {
    lines.push(`- Status: \`${report.readiness.status}\``);
    lines.push(`- Kind: \`${report.readiness.kind}\``);
    lines.push(`- Source plan sha256: \`${report.readiness.sourcePlanSha256 ?? "missing"}\``);
    lines.push(`- Report: \`${report.readiness.path}\``);
  } else {
    lines.push("- Not provided. Required only for physical writes.");
  }
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of STATUSES) lines.push(`| \`${status}\` | ${report.statusCounts[status]} |`);
  lines.push("");

  lines.push("## Operations");
  lines.push("");
  for (const operation of report.operations) {
    lines.push(`- \`${operation.id}\` -> \`${operation.targetPath}\``);
    lines.push(`  - status: \`${operation.status}\``);
    lines.push(`  - line: ${operation.line ?? "unknown"}`);
    lines.push(`  - base sha256: \`${operation.baseSha256 ?? "missing"}\``);
    lines.push(`  - current sha256: \`${operation.currentSha256 ?? "missing"}\``);
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
  if (args.write && !args.readiness) {
    throw new Error("Physical write requires --readiness <readiness.json>.");
  }

  const planPath = normalizePath(args.plan);
  const planRaw = fs.readFileSync(planPath, "utf8");
  const plan = JSON.parse(planRaw);
  validatePlan(plan);
  plan.projectRoot = normalizePath(plan.projectRoot);
  const readiness = args.readiness ? validateReadiness(args.readiness, plan, planRaw) : null;

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, plan.projectRoot)) {
      throw new Error(`Refusing to write project patch execution report inside target project: ${outPath}`);
    }
  }

  const operations = plan.operations.map((operation) => buildOperation(plan, operation));
  let writtenPaths = [];
  if (args.write) {
    ensureNoBlocked(operations);
    writtenPaths = executeWrites(operations);
  }

  const report = buildReport(plan, planPath, args.write ? "write" : "dry_run", operations, writtenPaths, readiness);
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
  console.error(`gamespec-execute-project-patch-plan: ${error.message}`);
  process.exit(1);
}
