#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const STATUSES = [
  "would_write",
  "wrote",
  "already_current",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec review document executor

Usage:
  node bin/gamespec-execute-review-document-plan.js --plan <review-document-plan.json> [--out <path>] [--format markdown|json] [--write] [--approve]

Rules:
  - Dry-run by default.
  - Writes only the planned candidate review document.
  - Physical write requires both --write and --approve.
  - Refuses targets outside gamespec/projects/<project-id>/reviews/.
  - Refuses to overwrite differing existing review files.
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
    console.error("Missing --plan <review-document-plan.json>.");
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

function validatePlan(plan) {
  if (plan.mode !== "review_document_plan_read_only") {
    throw new Error(`Unsupported plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.writePolicy) {
    throw new Error("Plan must contain projectRoot, projectId, and writePolicy.");
  }
  if (plan.writePolicy.physicalWritesNow !== false) {
    throw new Error("Plan must be read-only with physicalWritesNow: false.");
  }
}

function reviewsRoot(plan) {
  return path.join(plan.projectRoot, "gamespec", "projects", plan.projectId, "reviews");
}

function operationContent(plan) {
  const content = plan.candidateReview?.candidateReviewMarkdown ?? "";
  return content.endsWith("\n") ? content : `${content}\n`;
}

function buildOperation(plan) {
  const issues = [];
  const projectRoot = normalizePath(plan.projectRoot);
  const candidate = plan.candidateReview ?? null;
  const targetPath = candidate?.targetPath ?? null;
  const targetAbs = targetPath ? normalizePath(path.join(projectRoot, ...fromPosix(targetPath))) : null;
  const expectedReviewsRoot = reviewsRoot({ ...plan, projectRoot });
  const content = operationContent(plan);

  if (plan.state === "blocked") issues.push("source_plan_blocked");
  if (!candidate) issues.push("missing_candidate_review");
  if (candidate && candidate.physicalWritesNow !== false) issues.push("candidate_must_be_read_only");
  if (!targetPath) issues.push("missing_target_path");
  if (!content.trim()) issues.push("candidate_review_empty");
  if (!fs.existsSync(projectRoot)) issues.push("project_root_missing");
  if (targetAbs && !isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project");
  if (targetAbs && !isPathInside(targetAbs, expectedReviewsRoot)) issues.push("target_outside_reviews_dir");
  if (targetPath && !targetPath.startsWith(`gamespec/projects/${plan.projectId}/reviews/`)) {
    issues.push("target_not_review_document");
  }

  let status = "would_write";
  if (issues.length > 0) {
    status = "blocked";
  } else if (fs.existsSync(targetAbs)) {
    if (fs.readFileSync(targetAbs, "utf8") === content) {
      status = "already_current";
    } else {
      status = "blocked";
      issues.push("target_exists_differs");
    }
  }

  return {
    op: "write_review_document",
    targetPath,
    targetAbs,
    status,
    issues,
    contentBytes: Buffer.byteLength(content, "utf8"),
    content
  };
}

function countStatuses(operations) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const operation of operations) counts[operation.status] += 1;
  return counts;
}

function executeWrite(operation) {
  if (operation.status === "blocked") {
    throw new Error("Refusing to write because the review document operation is blocked.");
  }
  if (operation.status === "already_current") return null;
  fs.mkdirSync(path.dirname(operation.targetAbs), { recursive: true });
  fs.writeFileSync(operation.targetAbs, operation.content, "utf8");
  operation.status = "wrote";
  return operation.targetAbs;
}

function buildReport(plan, planPath, mode, operation, writtenPath) {
  const safeOperation = { ...operation };
  delete safeOperation.content;
  return {
    generated: new Date().toISOString(),
    mode,
    projectRoot: plan.projectRoot,
    projectId: plan.projectId,
    sourcePlan: planPath,
    state: plan.state,
    statusCounts: countStatuses([safeOperation]),
    writtenPath,
    operation: safeOperation,
    guardrails: [
      "Dry-run is the default behavior.",
      "Write mode requires both --write and --approve.",
      "Only the planned candidate review document can be written.",
      "active.md, SYS_001, CAST_001, and other project truth files are not modified by this command.",
      "Differing existing review files block execution."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Review Document Execution Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of STATUSES) lines.push(`| \`${status}\` | ${report.statusCounts[status]} |`);
  lines.push("");

  lines.push("## Operation");
  lines.push("");
  lines.push(`- Target: \`${report.operation.targetPath ?? "missing"}\``);
  lines.push(`- Status: \`${report.operation.status}\``);
  if (report.operation.issues.length > 0) lines.push(`- Issues: ${report.operation.issues.join(", ")}`);
  lines.push(`- Written path: \`${report.writtenPath ?? "not written"}\``);
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

  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  validatePlan(plan);
  plan.projectRoot = normalizePath(plan.projectRoot);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, plan.projectRoot)) {
      throw new Error(`Refusing to write review document execution report inside target project: ${outPath}`);
    }
  }

  const operation = buildOperation(plan);
  let writtenPath = null;
  if (args.write) writtenPath = executeWrite(operation);

  const report = buildReport(plan, planPath, args.write ? "write" : "dry_run", operation, writtenPath);
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
  console.error(`gamespec-execute-review-document-plan: ${error.message}`);
  process.exit(1);
}
