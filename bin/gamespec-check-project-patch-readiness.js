#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec project patch readiness gate

Usage:
  node bin/gamespec-check-project-patch-readiness.js --plan <project-patch-plan.json> --decision-record <path> [--out <path>] [--format markdown|json]
  node bin/gamespec-check-project-patch-readiness.js --plan <project-patch-plan.json> --waive-decision-record --waiver-reason <text> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Verifies a matching decision record or an explicit waiver before project patch writes.
  - Binds readiness to the exact patch plan by sha256.
  - Refuses report output inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", waiveDecisionRecord: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--plan") {
      args.plan = argv[++i];
    } else if (arg === "--decision-record") {
      args.decisionRecord = argv[++i];
    } else if (arg === "--waive-decision-record") {
      args.waiveDecisionRecord = true;
    } else if (arg === "--waiver-reason") {
      args.waiverReason = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.plan) {
    console.error("Missing --plan <project-patch-plan.json>.");
    usage(1);
  }
  const hasRecord = Boolean(args.decisionRecord);
  const hasWaiver = Boolean(args.waiveDecisionRecord);
  if (hasRecord === hasWaiver) {
    throw new Error("Provide exactly one of --decision-record or --waive-decision-record.");
  }
  if (hasWaiver && !args.waiverReason) {
    throw new Error("Missing --waiver-reason <text>.");
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

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const yaml = text.slice(3, end).trim();
  const data = {};
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (match) data[match[1]] = stripQuotes(match[2] ?? "");
  }
  return data;
}

function validatePlan(plan) {
  if (plan.mode !== "project_patch_plan_read_only") {
    throw new Error(`Unsupported plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.selected) {
    throw new Error("Plan must contain projectRoot, projectId, and selected decision.");
  }
  if (plan.applyPolicy?.physicalWritesNow !== false || plan.summary?.physicalWritesNow !== false) {
    throw new Error("Plan must be read-only with physicalWritesNow: false.");
  }
}

function decisionRoot(plan) {
  return path.join(plan.projectRoot, "gamespec", "projects", plan.projectId, "decisions");
}

function resolveDecisionRecord(projectRoot, inputPath) {
  if (path.isAbsolute(inputPath)) return normalizePath(inputPath);
  return normalizePath(path.join(projectRoot, inputPath));
}

function buildDecisionRecordGate(plan, args) {
  const issues = [];
  const recordAbs = resolveDecisionRecord(plan.projectRoot, args.decisionRecord);
  const root = decisionRoot(plan);
  let frontmatter = {};

  if (!fs.existsSync(recordAbs)) {
    issues.push("decision_record_missing");
  }
  if (!isPathInside(recordAbs, plan.projectRoot)) {
    issues.push("decision_record_outside_project");
  }
  if (!isPathInside(recordAbs, root)) {
    issues.push("decision_record_outside_decisions_dir");
  }

  if (issues.length === 0) {
    frontmatter = parseFrontmatter(fs.readFileSync(recordAbs, "utf8"));
    if (frontmatter.decision_id !== plan.selected.decisionId) {
      issues.push("decision_id_mismatch");
    }
    if (frontmatter.selected_option !== plan.selected.optionId) {
      issues.push("selected_option_mismatch");
    }
    if (frontmatter.status === "rejected") {
      issues.push("decision_record_rejected");
    }
  }

  return {
    kind: "decision_record",
    status: issues.length === 0 ? "pass" : "blocked",
    issues,
    decisionRecord: {
      input: args.decisionRecord,
      path: recordAbs,
      exists: fs.existsSync(recordAbs),
      frontmatter
    }
  };
}

function buildWaiverGate(args) {
  const reason = String(args.waiverReason ?? "").trim();
  const issues = [];
  if (!reason) issues.push("waiver_reason_empty");
  return {
    kind: "decision_record_waiver",
    status: issues.length === 0 ? "pass" : "blocked",
    issues,
    waiver: {
      reason,
      explicitlyWaivedDecisionRecord: true
    }
  };
}

function buildReadiness(plan, planPath, planRaw, args) {
  validatePlan(plan);
  plan.projectRoot = normalizePath(plan.projectRoot);
  if (!fs.existsSync(plan.projectRoot)) {
    throw new Error(`Project root does not exist: ${plan.projectRoot}`);
  }

  const gate = args.decisionRecord
    ? buildDecisionRecordGate(plan, args)
    : buildWaiverGate(args);

  return {
    generated: new Date().toISOString(),
    mode: "project_patch_readiness_gate",
    status: gate.status,
    projectRoot: plan.projectRoot,
    projectId: plan.projectId,
    selected: plan.selected,
    sourcePlan: {
      path: planPath,
      sha256: sha256(planRaw),
      generated: plan.generated ?? null,
      mode: plan.mode
    },
    gate,
    writeGate: {
      readyForProjectPatchWrite: gate.status === "pass",
      executorRequiresMatchingPlanSha256: true,
      executorRequiresSameProjectAndSelection: true
    },
    guardrails: [
      "Read-only readiness report.",
      "This command does not create or apply project truth.",
      "Readiness is bound to the exact patch plan sha256.",
      "Project patch execution still requires --write --approve."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Project Patch Readiness");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Status: \`${report.status}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Selected Decision");
  lines.push("");
  lines.push(`- Decision: \`${report.selected?.decisionId ?? "unknown"}\` ${report.selected?.decisionTitle ?? ""}`);
  lines.push(`- Option: \`${report.selected?.optionId ?? "unknown"}\` ${report.selected?.optionName ?? ""}`);
  lines.push("");

  lines.push("## Source Plan");
  lines.push("");
  lines.push(`- Path: \`${report.sourcePlan.path}\``);
  lines.push(`- SHA256: \`${report.sourcePlan.sha256}\``);
  lines.push("");

  lines.push("## Gate");
  lines.push("");
  lines.push(`- Kind: \`${report.gate.kind}\``);
  lines.push(`- Status: \`${report.gate.status}\``);
  if (report.gate.issues.length > 0) lines.push(`- Issues: ${report.gate.issues.join(", ")}`);
  if (report.gate.decisionRecord) {
    lines.push(`- Decision record: \`${report.gate.decisionRecord.path}\``);
  }
  if (report.gate.waiver) {
    lines.push(`- Waiver reason: ${report.gate.waiver.reason}`);
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
  const planPath = normalizePath(args.plan);
  const planRaw = fs.readFileSync(planPath, "utf8");
  const plan = JSON.parse(planRaw);
  const projectRoot = normalizePath(plan.projectRoot ?? "");

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && fs.existsSync(projectRoot) && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write project patch readiness report inside target project: ${outPath}`);
    }
  }

  const report = buildReadiness(plan, planPath, planRaw, args);
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
  console.error(`gamespec-check-project-patch-readiness: ${error.message}`);
  process.exit(1);
}
