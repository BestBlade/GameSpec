#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec install drift audit

Usage:
  node bin/gamespec-audit-install-drift.js --plan <install-plan.json> [--out <path>] [--format markdown|json] [--max-diff-lines <n>]

Rules:
  - Read-only.
  - Consumes an install plan.
  - Reports differing product-managed install targets.
  - Does not approve or apply updates.
  - Refuses to write reports inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", maxDiffLines: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--plan") {
      args.plan = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--max-diff-lines") {
      args.maxDiffLines = Number(argv[++i]);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.plan) {
    console.error("Missing --plan <install-plan.json>.");
    usage(1);
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
  }
  if (!Number.isInteger(args.maxDiffLines) || args.maxDiffLines < 0) {
    throw new Error(`Invalid --max-diff-lines: ${args.maxDiffLines}`);
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

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function fromPosix(posixPath) {
  return posixPath.split("/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isProjectTruthTarget(targetAbs, projectRoot) {
  return isPathInside(targetAbs, path.join(projectRoot, "gamespec", "projects"));
}

function splitLines(text) {
  return text.replace(/\r\n/gu, "\n").split("\n");
}

function normalizeTrailingWhitespace(text) {
  return text
    .replace(/[ \t]+(?=\r?\n|$)/gu, "")
    .replace(/\r\n/gu, "\n")
    .replace(/\n+$/u, "\n");
}

function normalizeAllWhitespace(text) {
  return text.replace(/\s+/gu, "");
}

function firstDifferingLine(sourceText, targetText) {
  const sourceLines = splitLines(sourceText);
  const targetLines = splitLines(targetText);
  const max = Math.max(sourceLines.length, targetLines.length);
  for (let index = 0; index < max; index += 1) {
    const sourceLine = sourceLines[index] ?? null;
    const targetLine = targetLines[index] ?? null;
    if (sourceLine !== targetLine) {
      return {
        line: index + 1,
        source: sourceLine,
        target: targetLine
      };
    }
  }
  return null;
}

function diffPreview(sourceText, targetText, maxDiffLines) {
  const sourceLines = splitLines(sourceText);
  const targetLines = splitLines(targetText);
  const max = Math.max(sourceLines.length, targetLines.length);
  const preview = [];
  for (let index = 0; index < max && preview.length < maxDiffLines; index += 1) {
    const sourceLine = sourceLines[index] ?? null;
    const targetLine = targetLines[index] ?? null;
    if (sourceLine === targetLine) continue;
    preview.push({
      line: index + 1,
      source: sourceLine,
      target: targetLine
    });
  }
  return preview;
}

function recommendedAction(item) {
  if (item.projectTruthTarget) return "do_not_apply_product_installer_to_project_truth";
  if (item.sameIgnoringTrailingWhitespace) return "candidate_for_explicit_product_surface_sync_after_review";
  return "manual_review_required_before_sync";
}

function analyzeDriftOperation(op, plan, maxDiffLines) {
  const projectRoot = normalizePath(plan.projectRoot);
  const productRoot = normalizePath(plan.productRoot);
  const sourceAbs = normalizePath(op.sourceAbs ?? path.join(productRoot, ...fromPosix(op.sourcePath)));
  const targetAbs = normalizePath(op.targetAbs ?? path.join(projectRoot, ...fromPosix(op.targetPath)));
  const issues = [];

  if (!isPathInside(sourceAbs, productRoot)) issues.push("source_outside_product_root");
  if (!isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project_root");
  if (!fs.existsSync(sourceAbs)) issues.push("source_missing");
  if (!fs.existsSync(targetAbs)) issues.push("target_missing");

  const projectTruthTarget = isProjectTruthTarget(targetAbs, projectRoot);
  if (projectTruthTarget) issues.push("target_inside_project_truth");

  let sourceBuffer = null;
  let targetBuffer = null;
  let sourceText = null;
  let targetText = null;
  if (issues.length === 0) {
    sourceBuffer = fs.readFileSync(sourceAbs);
    targetBuffer = fs.readFileSync(targetAbs);
    sourceText = sourceBuffer.toString("utf8");
    targetText = targetBuffer.toString("utf8");
  }

  const sourceSha256 = sourceBuffer ? sha256(sourceBuffer) : null;
  const targetSha256 = targetBuffer ? sha256(targetBuffer) : null;
  const sourceLines = sourceText ? splitLines(sourceText).length : null;
  const targetLines = targetText ? splitLines(targetText).length : null;
  const sameIgnoringTrailingWhitespace = sourceText !== null && targetText !== null
    ? normalizeTrailingWhitespace(sourceText) === normalizeTrailingWhitespace(targetText)
    : false;
  const sameIgnoringAllWhitespace = sourceText !== null && targetText !== null
    ? normalizeAllWhitespace(sourceText) === normalizeAllWhitespace(targetText)
    : false;

  const item = {
    surface: op.surface ?? null,
    sourcePath: op.sourcePath ?? null,
    targetPath: op.targetPath ?? null,
    status: op.status ?? null,
    issues,
    projectTruthTarget,
    source: sourceBuffer
      ? { bytes: sourceBuffer.length, lines: sourceLines, sha256: sourceSha256 }
      : null,
    target: targetBuffer
      ? { bytes: targetBuffer.length, lines: targetLines, sha256: targetSha256 }
      : null,
    sameIgnoringTrailingWhitespace,
    sameIgnoringAllWhitespace,
    firstDifferingLine: sourceText !== null && targetText !== null ? firstDifferingLine(sourceText, targetText) : null,
    diffPreview: sourceText !== null && targetText !== null ? diffPreview(sourceText, targetText, maxDiffLines) : [],
    recommendedAction: null
  };
  item.recommendedAction = recommendedAction(item);
  return item;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return counts;
}

function buildAudit(planPath, maxDiffLines) {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  if (!plan.projectRoot || !plan.productRoot || !Array.isArray(plan.operations)) {
    throw new Error("Install plan must contain projectRoot, productRoot, and operations.");
  }

  const driftOperations = plan.operations.filter((op) => op.status === "blocked_target_exists_differs");
  const driftItems = driftOperations.map((op) => analyzeDriftOperation(op, plan, maxDiffLines));
  const projectTruthDrifts = driftItems.filter((item) => item.projectTruthTarget);

  return {
    generated: new Date().toISOString(),
    mode: "install_drift_audit_read_only",
    sourcePlan: planPath,
    projectRoot: plan.projectRoot,
    productRoot: plan.productRoot,
    productVersion: plan.productVersion ?? null,
    state: driftItems.length === 0 ? "no_drift" : "drift_detected",
    summary: {
      operations: plan.operations.length,
      driftCount: driftItems.length,
      projectTruthDriftCount: projectTruthDrifts.length,
      statusCounts: plan.statusCounts ?? countBy(plan.operations, "status"),
      recommendedActions: countBy(driftItems, "recommendedAction")
    },
    driftItems,
    guardrails: [
      "Read-only install drift audit.",
      "Does not approve or apply product-managed surface updates.",
      "Project truth under gamespec/projects/ is reported as unsafe.",
      "Diff previews are evidence for review, not write approval."
    ]
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Install Drift Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Project: \`${audit.projectRoot}\``);
  lines.push(`Product root: \`${audit.productRoot}\``);
  lines.push(`Product version: \`${audit.productVersion ?? "unknown"}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${audit.summary.operations}`);
  lines.push(`- Drift count: ${audit.summary.driftCount}`);
  lines.push(`- Project-truth drift count: ${audit.summary.projectTruthDriftCount}`);
  lines.push("");

  lines.push("## Drift Items");
  lines.push("");
  if (audit.driftItems.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of audit.driftItems) {
      lines.push(`- \`${item.targetPath}\``);
      lines.push(`  - source: \`${item.sourcePath}\``);
      lines.push(`  - surface: \`${item.surface ?? "unknown"}\``);
      lines.push(`  - recommended action: \`${item.recommendedAction}\``);
      lines.push(`  - same ignoring trailing whitespace: ${item.sameIgnoringTrailingWhitespace}`);
      lines.push(`  - source sha256: \`${item.source?.sha256 ?? "missing"}\``);
      lines.push(`  - target sha256: \`${item.target?.sha256 ?? "missing"}\``);
      if (item.firstDifferingLine) {
        lines.push(`  - first differing line: ${item.firstDifferingLine.line}`);
      }
      if (item.issues.length > 0) lines.push(`  - issues: ${item.issues.join(", ")}`);
    }
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
  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (plan.projectRoot && isPathInside(outPath, normalizePath(plan.projectRoot))) {
      throw new Error(`Refusing to write install drift audit inside target project: ${outPath}`);
    }
  }

  const audit = buildAudit(planPath, args.maxDiffLines);
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
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
  console.error(`gamespec-audit-install-drift: ${error.message}`);
  process.exit(1);
}
