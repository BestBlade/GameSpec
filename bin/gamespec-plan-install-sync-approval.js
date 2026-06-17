#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec install sync approval planner

Usage:
  node bin/gamespec-plan-install-sync-approval.js --plan <install-sync-plan.json> --project-id <id> [--rationale <text>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Consumes an install sync plan.
  - Plans a project-local approval record for product-managed install sync.
  - Refuses plans with blocked sync operations.
  - Refuses report output inside the target project.
  - Does not write the approval record or sync any product files.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--plan") {
      args.plan = argv[++i];
    } else if (arg === "--project-id") {
      args.projectId = argv[++i];
    } else if (arg === "--rationale") {
      args.rationale = argv[++i];
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
    console.error("Missing --plan <install-sync-plan.json>.");
    usage(1);
  }
  if (!args.projectId) {
    console.error("Missing --project-id <id>.");
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

function sanitizeId(input) {
  return input.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function validateSyncPlan(plan) {
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

function approvalTarget(projectId, planHash) {
  return `gamespec/projects/${sanitizeId(projectId)}/approvals/install-sync/APPROVAL_${today()}_install_sync_${planHash.slice(0, 12)}.md`;
}

function candidateOperations(plan) {
  return plan.operations.filter((operation) => operation.status === "candidate_sync");
}

function blockedOperations(plan) {
  return plan.operations.filter((operation) => operation.status === "blocked");
}

function buildApprovalSubject(plan, planPath, planHash, candidates) {
  return {
    type: "install_sync_plan",
    sourceInstallSyncPlan: planPath,
    sourcePlanSha256: planHash,
    productVersion: plan.productVersion ?? null,
    operationCount: candidates.length,
    operations: candidates.map((operation) => ({
      id: operation.id,
      action: operation.action,
      surface: operation.surface,
      sourcePath: operation.sourcePath,
      targetPath: operation.targetPath,
      sourceSha256: operation.sourceSha256,
      targetBaseSha256: operation.targetBaseSha256,
      plannedSha256: operation.plannedSha256,
      sameIgnoringTrailingWhitespace: operation.sameIgnoringTrailingWhitespace ?? false
    }))
  };
}

function buildRecordMarkdown(plan, args, approvalSubject, recordTarget) {
  const lines = [];
  lines.push("---");
  lines.push("approval_type: install_sync");
  lines.push("status: approved_for_product_surface_sync");
  lines.push(`project: ${sanitizeId(args.projectId)}`);
  lines.push(`created: ${today()}`);
  lines.push(`source_plan_sha256: ${approvalSubject.sourcePlanSha256}`);
  lines.push(`operation_count: ${approvalSubject.operationCount}`);
  lines.push("---");
  lines.push("");
  lines.push("# Install Sync Approval");
  lines.push("");
  lines.push(`Record target: \`${recordTarget}\``);
  lines.push(`Project root: \`${plan.projectRoot}\``);
  lines.push(`Product root: \`${plan.productRoot}\``);
  lines.push(`Product version: \`${plan.productVersion ?? "unknown"}\``);
  lines.push(`Source plan sha256: \`${approvalSubject.sourcePlanSha256}\``);
  lines.push("");
  lines.push("## Rationale");
  lines.push("");
  lines.push(args.rationale ?? "Approved product-managed surface sync after reviewing install drift evidence.");
  lines.push("");
  lines.push("## Approved Operations");
  lines.push("");
  for (const operation of approvalSubject.operations) {
    lines.push(`- \`${operation.id}\`: \`${operation.sourcePath}\` -> \`${operation.targetPath}\``);
    lines.push(`  - planned sha256: \`${operation.plannedSha256 ?? "missing"}\``);
    lines.push(`  - target base sha256: \`${operation.targetBaseSha256 ?? "missing"}\``);
    lines.push(`  - trailing-whitespace-only: ${operation.sameIgnoringTrailingWhitespace}`);
  }
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push("- This record approves only the listed product-managed install sync operations.");
  lines.push("- It does not approve project truth changes under `gamespec/projects/`.");
  lines.push("- The sync executor must re-check source and target hashes before writing.");
  lines.push("- A dry-run approval plan is not sufficient for physical sync writes.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildPlan(planPath, args) {
  const planBuffer = fs.readFileSync(planPath);
  const plan = JSON.parse(planBuffer.toString("utf8"));
  validateSyncPlan(plan);

  const candidates = candidateOperations(plan);
  const blocked = blockedOperations(plan);
  if (blocked.length > 0) {
    throw new Error(`Refusing to plan approval because ${blocked.length} sync operation(s) are blocked.`);
  }
  if (candidates.length === 0) {
    throw new Error("Refusing to plan approval because there are no candidate_sync operations.");
  }

  const planHash = sha256(planBuffer);
  const projectId = sanitizeId(args.projectId);
  const recordTarget = approvalTarget(projectId, planHash);
  const approvalSubject = buildApprovalSubject(plan, planPath, planHash, candidates);
  return {
    generated: new Date().toISOString(),
    mode: "install_sync_approval_plan_read_only",
    projectRoot: plan.projectRoot,
    productRoot: plan.productRoot,
    projectId,
    sourceInstallSyncPlan: planPath,
    sourcePlanSha256: planHash,
    recordTarget,
    summary: {
      physicalWritesNow: false,
      operations: candidates.length,
      blockedInSourcePlan: blocked.length
    },
    approvalSubject,
    candidateRecordMarkdown: buildRecordMarkdown(plan, { ...args, projectId }, approvalSubject, recordTarget),
    writePolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      futureSyncWritesRequireApprovalExecutionReport: true,
      approvalRecordTargetMustBeProjectLocal: true
    },
    guardrails: [
      "This command does not write the target project.",
      "The approval record is a planned future project-local write.",
      "Only candidate_sync operations can be approved.",
      "Sync writes still require the sync executor to re-check hashes.",
      "Project truth under gamespec/projects/ is not a sync target."
    ]
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Install Sync Approval Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`Project root: \`${plan.projectRoot}\``);
  lines.push(`Project id: \`${plan.projectId}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${plan.summary.operations}`);
  lines.push(`- Physical writes now: ${plan.summary.physicalWritesNow}`);
  lines.push(`- Record target: \`${plan.recordTarget}\``);
  lines.push(`- Source plan sha256: \`${plan.sourcePlanSha256}\``);
  lines.push("");

  lines.push("## Candidate Record Markdown");
  lines.push("");
  lines.push("```markdown");
  lines.push(plan.candidateRecordMarkdown.trimEnd());
  lines.push("```");
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
  const planPath = normalizePath(args.plan);
  const plan = buildPlan(planPath, args);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, normalizePath(plan.projectRoot))) {
      throw new Error(`Refusing to write install sync approval plan inside target project: ${outPath}`);
    }
  }

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
  console.error(`gamespec-plan-install-sync-approval: ${error.message}`);
  process.exit(1);
}
