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
  const text = `GameSpec decision record executor

Usage:
  node bin/gamespec-execute-decision-record-plan.js --plan <decision-record-plan.json> [--out <path>] [--format markdown|json] [--write] [--approve]

Rules:
  - Dry-run by default.
  - Writes only the planned decision record target.
  - Does not update active.md, CAST_001, SYS_001, LEVEL_001, or other project truth files.
  - Physical write requires both --write and --approve.
  - Refuses to overwrite differing existing records.
  - Refuses to write reports inside the target project.
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
    console.error("Missing --plan <decision-record-plan.json>.");
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

function expectedDecisionRoot(plan) {
  return path.join(plan.projectRoot, "gamespec", "projects", plan.projectId, "decisions");
}

function validatePlan(plan) {
  if (plan.mode !== "decision_record_plan_read_only") {
    throw new Error(`Unsupported plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.recordTarget || !plan.candidateRecordMarkdown) {
    throw new Error("Plan must contain projectRoot, projectId, recordTarget, and candidateRecordMarkdown.");
  }
  if (plan.writePolicy?.physicalWritesNow !== false) {
    throw new Error("Plan must be a read-only decision record plan with physicalWritesNow: false.");
  }
}

function sameTextFile(targetAbs, content) {
  if (!fs.existsSync(targetAbs)) return false;
  return fs.readFileSync(targetAbs, "utf8") === content;
}

function buildOperation(plan) {
  const issues = [];
  const projectRoot = normalizePath(plan.projectRoot);
  const targetAbs = normalizePath(path.join(projectRoot, ...fromPosix(plan.recordTarget)));
  const decisionRoot = expectedDecisionRoot({ ...plan, projectRoot });
  const content = plan.candidateRecordMarkdown.endsWith("\n")
    ? plan.candidateRecordMarkdown
    : `${plan.candidateRecordMarkdown}\n`;

  if (!fs.existsSync(projectRoot)) issues.push("project_root_missing");
  if (!isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project");
  if (!isPathInside(targetAbs, decisionRoot)) issues.push("target_outside_decisions_dir");
  if (!plan.recordTarget.startsWith(`gamespec/projects/${plan.projectId}/decisions/`)) {
    issues.push("target_not_decision_record");
  }
  if (!content.trim()) issues.push("candidate_record_empty");

  let status = "would_write";
  if (issues.length > 0) {
    status = "blocked";
  } else if (fs.existsSync(targetAbs)) {
    if (sameTextFile(targetAbs, content)) {
      status = "already_current";
    } else {
      status = "blocked";
      issues.push("target_exists_differs");
    }
  }

  return {
    op: "write_decision_record",
    targetPath: plan.recordTarget,
    targetAbs,
    contentBytes: Buffer.byteLength(content, "utf8"),
    status,
    issues,
    content
  };
}

function countStatuses(operations) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const op of operations) counts[op.status] += 1;
  return counts;
}

function executeWrite(operation) {
  if (operation.status === "blocked") {
    throw new Error("Refusing to write because the decision record operation is blocked.");
  }
  if (operation.status === "already_current") return null;
  fs.mkdirSync(path.dirname(operation.targetAbs), { recursive: true });
  fs.writeFileSync(operation.targetAbs, operation.content, "utf8");
  operation.status = "wrote";
  return operation.targetAbs;
}

function buildReport(plan, planPath, mode, operation, writtenPath) {
  const opForReport = { ...operation };
  delete opForReport.content;
  return {
    generated: new Date().toISOString(),
    mode,
    projectRoot: plan.projectRoot,
    projectId: plan.projectId,
    sourcePlan: planPath,
    selected: plan.selected,
    statusCounts: countStatuses([opForReport]),
    writtenPath,
    operation: opForReport,
    skippedProjectUpdateCandidates: (plan.projectUpdateCandidates ?? [])
      .filter((candidate) => candidate.targetPath !== plan.recordTarget),
    guardrails: [
      "Dry-run is the default behavior.",
      "Write mode requires both --write and --approve.",
      "Only the planned decision record target can be written.",
      "active.md, CAST_001, SYS_001, LEVEL_001, and other project truth files are not modified by this command.",
      "Differing existing records block execution."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Decision Record Execution Report");
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
  lines.push(`- Target: \`${report.operation.targetPath}\``);
  lines.push(`- Status: \`${report.operation.status}\``);
  if (report.operation.issues.length > 0) lines.push(`- Issues: ${report.operation.issues.join(", ")}`);
  lines.push(`- Written path: \`${report.writtenPath ?? "not written"}\``);
  lines.push("");

  lines.push("## Skipped Project Update Candidates");
  lines.push("");
  if (report.skippedProjectUpdateCandidates.length === 0) {
    lines.push("- None.");
  } else {
    for (const candidate of report.skippedProjectUpdateCandidates) {
      lines.push(`- \`${candidate.targetPath}\` (${candidate.action})`);
    }
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

  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  validatePlan(plan);
  plan.projectRoot = normalizePath(plan.projectRoot);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, plan.projectRoot)) {
      throw new Error(`Refusing to write decision record execution report inside target project: ${outPath}`);
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
  console.error(`gamespec-execute-decision-record-plan: ${error.message}`);
  process.exit(1);
}
