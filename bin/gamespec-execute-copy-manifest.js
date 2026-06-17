#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec copy manifest executor

Usage:
  node bin/gamespec-execute-copy-manifest.js --manifest <copy-manifest.json> [--out <path>] [--format markdown|json] [--write]

Rules:
  - Dry-run by default.
  - Copies files only when --write is provided.
  - Re-checks source existence, duplicate targets, and target safety.
  - Refuses to overwrite existing product files.
  - Refuses to write reports inside the classified project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--manifest") {
      args.manifest = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--write") {
      args.write = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.manifest) {
    console.error("Missing --manifest <copy-manifest.json>.");
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

function normalizeForCompare(inputPath) {
  const normalized = normalizePath(inputPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function toNativeFromPosix(posixPath) {
  return posixPath.split("/").join(path.sep);
}

function validateManifest(manifest, productRoot) {
  if (!manifest.projectRoot || !manifest.productRoot || !Array.isArray(manifest.operations)) {
    throw new Error("Copy manifest must contain projectRoot, productRoot, and operations.");
  }
  if (!samePath(manifest.productRoot, productRoot)) {
    throw new Error(`Manifest product root does not match current working directory: ${manifest.productRoot}`);
  }
}

function analyzeOperations(manifest, productRoot) {
  const projectRoot = normalizePath(manifest.projectRoot);
  const targetCounts = new Map();

  for (const op of manifest.operations) {
    if (op.targetPath) {
      targetCounts.set(op.targetPath, (targetCounts.get(op.targetPath) ?? 0) + 1);
    }
  }

  return manifest.operations.map((op) => {
    const issues = [];
    if (op.op !== "copy") issues.push("unsupported_operation");
    if (op.status !== "ready_for_dry_run") issues.push("manifest_status_not_ready");
    if (!op.sourcePath) issues.push("missing_source_path");
    if (!op.targetPath) issues.push("missing_target_path");

    const sourceAbs = op.sourcePath
      ? normalizePath(path.join(projectRoot, toNativeFromPosix(op.sourcePath)))
      : null;
    const targetAbs = op.targetPath
      ? normalizePath(path.join(productRoot, toNativeFromPosix(op.targetPath)))
      : null;

    if (sourceAbs && !fs.existsSync(sourceAbs)) {
      issues.push("source_missing");
    }
    if (targetAbs && !isInside(targetAbs, productRoot)) {
      issues.push("target_outside_product");
    }
    if (targetAbs && isInside(targetAbs, projectRoot)) {
      issues.push("target_inside_project");
    }
    if (op.targetPath && targetCounts.get(op.targetPath) > 1) {
      issues.push("target_collision");
    }
    if (targetAbs && fs.existsSync(targetAbs)) {
      issues.push("target_exists");
    }

    return {
      op: "copy",
      sourcePath: op.sourcePath,
      sourceAbs,
      targetPath: op.targetPath,
      targetAbs,
      reason: op.reason,
      status: issues.length === 0 ? "ready_to_copy" : "blocked",
      issues
    };
  });
}

function countStatuses(operations) {
  const counts = { ready_to_copy: 0, copied: 0, blocked: 0 };
  for (const op of operations) counts[op.status] += 1;
  return counts;
}

function executeCopies(operations) {
  const blocked = operations.filter((op) => op.status === "blocked");
  if (blocked.length > 0) {
    throw new Error(`Refusing to write because ${blocked.length} operation(s) are blocked.`);
  }

  for (const op of operations) {
    fs.mkdirSync(path.dirname(op.targetAbs), { recursive: true });
    fs.copyFileSync(op.sourceAbs, op.targetAbs);
    op.status = "copied";
  }
}

function buildReport(manifest, productRoot, manifestPath, mode, operations) {
  return {
    projectRoot: manifest.projectRoot,
    productRoot,
    sourceManifest: manifestPath,
    generated: new Date().toISOString(),
    mode,
    statusCounts: countStatuses(operations),
    safetyInvariants: [
      "Dry-run is the default behavior.",
      "Write mode requires explicit --write.",
      "Existing product files are not overwritten.",
      "Targets must stay inside the product root.",
      "Targets must not be inside the classified project.",
      "The executor re-checks sources and targets instead of trusting the manifest blindly."
    ],
    operations
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Copy Manifest Execution Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project: \`${report.projectRoot}\``);
  lines.push(`Product root: \`${report.productRoot}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${report.operations.length}`);
  lines.push(`- Ready to copy: ${report.statusCounts.ready_to_copy}`);
  lines.push(`- Copied: ${report.statusCounts.copied}`);
  lines.push(`- Blocked: ${report.statusCounts.blocked}`);
  lines.push("");
  lines.push("## Safety Invariants");
  lines.push("");
  for (const invariant of report.safetyInvariants) {
    lines.push(`- ${invariant}`);
  }
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const op of report.operations.slice(0, 80)) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
    lines.push(`  - status: ${op.status}`);
    if (op.issues.length > 0) {
      lines.push(`  - issues: ${op.issues.join(", ")}`);
    }
  }
  const remaining = report.operations.length - 80;
  if (remaining > 0) {
    lines.push(`- ... ${remaining} more`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = normalizePath(args.manifest);
  const productRoot = normalizePath(process.cwd());
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest, productRoot);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isInside(outPath, normalizePath(manifest.projectRoot))) {
      throw new Error(`Refusing to write execution report inside classified project: ${outPath}`);
    }
  }

  const operations = analyzeOperations(manifest, productRoot);
  const mode = args.write ? "write" : "dry_run";
  if (args.write) {
    executeCopies(operations);
  }

  const report = buildReport(manifest, productRoot, manifestPath, mode, operations);
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
  console.error(`gamespec-execute-copy-manifest: ${error.message}`);
  process.exit(1);
}
