#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec copy manifest builder

Usage:
  node bin/gamespec-build-copy-manifest.js --plan <extraction-plan.json> [--out <path>] [--format markdown|json]

Rules:
  - Reads an extraction plan.
  - Builds a dry-run copy manifest from copy_candidate items only.
  - Never copies files.
  - Refuses to write output inside the classified project.
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
    console.error("Missing --plan <extraction-plan.json>.");
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

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function toNativeFromPosix(posixPath) {
  return posixPath.split("/").join(path.sep);
}

function buildOperations(plan, productRoot) {
  const targetCounts = new Map();
  for (const item of plan.items) {
    if (item.action !== "copy_candidate" || !item.proposedTarget) continue;
    targetCounts.set(item.proposedTarget, (targetCounts.get(item.proposedTarget) ?? 0) + 1);
  }

  return plan.items
    .filter((item) => item.action === "copy_candidate" && item.proposedTarget)
    .map((item) => {
      const sourceAbs = path.join(plan.projectRoot, toNativeFromPosix(item.sourcePath));
      const targetAbs = path.join(productRoot, toNativeFromPosix(item.proposedTarget));
      const issues = [];

      if (!fs.existsSync(sourceAbs)) {
        issues.push("source_missing");
      }
      if (targetCounts.get(item.proposedTarget) > 1) {
        issues.push("target_collision");
      }
      if (isInside(targetAbs, normalizePath(plan.projectRoot))) {
        issues.push("target_inside_project");
      }

      return {
        op: "copy",
        sourcePath: item.sourcePath,
        sourceAbs,
        targetPath: item.proposedTarget,
        targetAbs,
        confidence: item.confidence,
        reason: item.reason,
        status: issues.length === 0 ? "ready_for_dry_run" : "blocked",
        issues
      };
    });
}

function countStatuses(operations) {
  const counts = { ready_for_dry_run: 0, blocked: 0 };
  for (const op of operations) counts[op.status] += 1;
  return counts;
}

function renderMarkdown(manifest) {
  const lines = [];
  lines.push("# GameSpec Copy Manifest");
  lines.push("");
  lines.push(`Project: \`${manifest.projectRoot}\``);
  lines.push(`Product root: \`${manifest.productRoot}\``);
  lines.push(`Generated: ${manifest.generated}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${manifest.operations.length}`);
  lines.push(`- Ready for dry run: ${manifest.statusCounts.ready_for_dry_run}`);
  lines.push(`- Blocked: ${manifest.statusCounts.blocked}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- This manifest performs no file copy.");
  lines.push("- Only `copy_candidate` items are included.");
  lines.push("- `review_required` and project-owned items are excluded.");
  lines.push("- A future copy command must re-check source existence and target collisions.");
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const op of manifest.operations.slice(0, 80)) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
    lines.push(`  - status: ${op.status}`);
    if (op.issues.length > 0) {
      lines.push(`  - issues: ${op.issues.join(", ")}`);
    }
  }
  const remaining = manifest.operations.length - 80;
  if (remaining > 0) {
    lines.push(`- ... ${remaining} more`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  if (!plan.projectRoot || !Array.isArray(plan.items)) {
    throw new Error("Extraction plan must contain projectRoot and items.");
  }

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isInside(outPath, normalizePath(plan.projectRoot))) {
      throw new Error(`Refusing to write manifest inside classified project: ${outPath}`);
    }
  }

  const productRoot = normalizePath(process.cwd());
  const operations = buildOperations(plan, productRoot);
  const manifest = {
    projectRoot: plan.projectRoot,
    productRoot,
    sourcePlan: planPath,
    generated: new Date().toISOString(),
    mode: "dry_run_manifest_only",
    statusCounts: countStatuses(operations),
    operations
  };

  const rendered = args.format === "json" ? renderJson(manifest) : renderMarkdown(manifest);
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
  console.error(`gamespec-build-copy-manifest: ${error.message}`);
  process.exit(1);
}
