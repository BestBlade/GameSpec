#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATUSES = [
  "would_write",
  "wrote",
  "already_current",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec workflow-state update executor

Usage:
  node bin/gamespec-execute-workflow-state-update-plan.js --plan <workflow-state-update-plan.json> [--out <path>] [--format markdown|json] [--write] [--approve]

Rules:
  - Dry-run by default.
  - Writes only gamespec/projects/<project-id>/active.md.
  - Physical write requires both --write and --approve.
  - Physical write requires a required_after_review_write plan.
  - Verifies active.md base sha256 before writing.
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
    console.error("Missing --plan <workflow-state-update-plan.json>.");
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

function expectedActiveTarget(projectId) {
  return `gamespec/projects/${projectId}/active.md`;
}

function validatePlan(plan) {
  if (plan.mode !== "workflow_state_update_plan_read_only") {
    throw new Error(`Unsupported plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.writePolicy) {
    throw new Error("Plan must contain projectRoot, projectId, and writePolicy.");
  }
  if (plan.writePolicy.physicalWritesNow !== false) {
    throw new Error("Plan must be read-only with physicalWritesNow: false.");
  }
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return null;
  return { lines, start: 0, end };
}

function yamlValue(value) {
  if (value == null) return "";
  if (/^".*"$/.test(value)) return value;
  if (/[:#\[\]{},&*!|>'"%@`]|^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function setFrontmatterValues(content, values) {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return {
      content,
      issues: ["active_frontmatter_missing"]
    };
  }

  const lines = [...parsed.lines];
  const missing = new Map(Object.entries(values ?? {}));

  for (let index = parsed.start + 1; index < parsed.end; index += 1) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const key = match[1];
    if (!missing.has(key)) continue;
    lines[index] = `${key}: ${yamlValue(missing.get(key))}`;
    missing.delete(key);
  }

  for (const [key, value] of missing) {
    lines.splice(parsed.end, 0, `${key}: ${yamlValue(value)}`);
    parsed.end += 1;
  }

  return {
    content: lines.join("\n"),
    issues: []
  };
}

function insertNextStep(content, bullet) {
  const lines = content.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Next Step");
  if (heading < 0) {
    return {
      content,
      issues: ["next_step_heading_missing"]
    };
  }
  lines.splice(heading + 1, 0, bullet);
  return {
    content: lines.join("\n"),
    issues: []
  };
}

function applyStructuredOperations(content, operations) {
  let nextContent = content;
  const issues = [];

  for (const operation of operations ?? []) {
    if (operation.op === "set_frontmatter_values") {
      const result = setFrontmatterValues(nextContent, operation.values);
      nextContent = result.content;
      issues.push(...result.issues);
    } else if (operation.op === "insert_next_step") {
      if (operation.changed) {
        if (!operation.bullet) {
          issues.push("insert_next_step_missing_bullet");
        } else {
          const result = insertNextStep(nextContent, operation.bullet);
          nextContent = result.content;
          issues.push(...result.issues);
        }
      }
    } else {
      issues.push(`unsupported_operation:${operation.op}`);
    }
  }

  return {
    content: nextContent,
    issues
  };
}

function buildOperation(plan, writeRequested) {
  const issues = [];
  const projectRoot = normalizePath(plan.projectRoot);
  const candidate = plan.candidateUpdate ?? null;
  const targetPath = candidate?.targetPath ?? null;
  const expectedTarget = expectedActiveTarget(plan.projectId);
  const targetAbs = targetPath ? normalizePath(path.join(projectRoot, ...fromPosix(targetPath))) : null;

  if (plan.state === "blocked") issues.push("source_plan_blocked");
  if (!candidate) issues.push("missing_candidate_update");
  if (candidate && candidate.physicalWritesNow !== false) issues.push("candidate_must_be_read_only");
  if (!targetPath) issues.push("missing_target_path");
  if (targetPath && targetPath !== expectedTarget) issues.push("target_not_active_md");
  if (!candidate?.baseSha256) issues.push("missing_base_sha256");
  if (!candidate?.plannedSha256) issues.push("missing_planned_sha256");
  if (!fs.existsSync(projectRoot)) issues.push("project_root_missing");
  if (targetAbs && !isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project");
  if (targetAbs && !fs.existsSync(targetAbs)) issues.push("active_md_missing");

  let status = "would_write";
  let content = null;
  let contentBytes = 0;
  let currentSha256 = null;
  let plannedSha256 = null;

  if (issues.length === 0) {
    const currentContent = fs.readFileSync(targetAbs, "utf8");
    currentSha256 = sha256(currentContent);

    if (currentSha256 === candidate.plannedSha256) {
      status = "already_current";
      contentBytes = Buffer.byteLength(currentContent, "utf8");
    } else if (currentSha256 !== candidate.baseSha256) {
      status = "blocked";
      issues.push("active_base_sha_mismatch");
    } else {
      const result = applyStructuredOperations(currentContent, candidate.operations);
      content = result.content;
      contentBytes = Buffer.byteLength(content, "utf8");
      issues.push(...result.issues);
      plannedSha256 = sha256(content);
      if (plannedSha256 !== candidate.plannedSha256) {
        status = "blocked";
        issues.push("planned_sha_mismatch");
      } else if (writeRequested && plan.state !== "required_after_review_write") {
        status = "blocked";
        issues.push("review_document_not_confirmed_written");
      }
    }
  } else {
    status = "blocked";
  }

  if (issues.length > 0) status = "blocked";

  return {
    op: "write_workflow_state_update",
    targetPath,
    targetAbs,
    status,
    issues,
    currentSha256,
    baseSha256: candidate?.baseSha256 ?? null,
    plannedSha256: plannedSha256 ?? candidate?.plannedSha256 ?? null,
    contentBytes,
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
    const detail = operation.issues.length > 0 ? `: ${operation.issues.join(", ")}` : ".";
    throw new Error(`Refusing to write because the workflow-state update operation is blocked${detail}`);
  }
  if (operation.status === "already_current") return null;
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
      "Physical write requires a required_after_review_write plan.",
      "Only gamespec/projects/<project-id>/active.md can be written.",
      "The current active.md sha256 must match the plan base sha256.",
      "The executor does not assign review conclusions or promote documents."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Workflow-State Update Execution Report");
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
  lines.push(`- Current sha256: \`${report.operation.currentSha256 ?? "not read"}\``);
  lines.push(`- Base sha256: \`${report.operation.baseSha256 ?? "missing"}\``);
  lines.push(`- Planned sha256: \`${report.operation.plannedSha256 ?? "missing"}\``);
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
      throw new Error(`Refusing to write workflow-state execution report inside target project: ${outPath}`);
    }
  }

  const operation = buildOperation(plan, args.write);
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
  console.error(`gamespec-execute-workflow-state-update-plan: ${error.message}`);
  process.exit(1);
}
