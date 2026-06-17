#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec filter copy manifest by held surface audit

Usage:
  node bin/gamespec-filter-by-surface-audit.js --manifest <copy-manifest.json> --audit <held-surface-audit.json> [--decision <decision>] [--out <path>] [--format json|markdown]

Rules:
  - Filters copy operations by exact targets selected from a held surface audit.
  - Defaults to --decision required_by_kernel_contract.
  - Performs no file copy.
  - Refuses to write output inside the classified project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { decision: "required_by_kernel_contract", format: "json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--manifest") {
      args.manifest = argv[++i];
    } else if (arg === "--audit") {
      args.audit = argv[++i];
    } else if (arg === "--decision") {
      args.decision = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.manifest) {
    console.error("Missing --manifest <copy-manifest.json>.");
    usage(1);
  }
  if (!args.audit) {
    console.error("Missing --audit <held-surface-audit.json>.");
    usage(1);
  }
  if (!["json", "markdown"].includes(args.format)) {
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

function validate(manifest, audit) {
  if (!manifest.projectRoot || !manifest.productRoot || !Array.isArray(manifest.operations)) {
    throw new Error("Copy manifest must contain projectRoot, productRoot, and operations.");
  }
  if (!Array.isArray(audit.roles) || !Array.isArray(audit.templates)) {
    throw new Error("Held surface audit must contain roles and templates.");
  }
  if (audit.projectRoot && normalizePath(audit.projectRoot) !== normalizePath(manifest.projectRoot)) {
    throw new Error("Held surface audit projectRoot does not match manifest projectRoot.");
  }
  if (audit.productRoot && normalizePath(audit.productRoot) !== normalizePath(manifest.productRoot)) {
    throw new Error("Held surface audit productRoot does not match manifest productRoot.");
  }
}

function statusCounts(operations) {
  const counts = { ready_for_dry_run: 0, blocked: 0 };
  for (const op of operations) {
    const status = op.status === "ready_for_dry_run" ? "ready_for_dry_run" : "blocked";
    counts[status] += 1;
  }
  return counts;
}

function buildFilteredManifest(manifest, audit, decision, manifestPath, auditPath) {
  validate(manifest, audit);
  const targets = new Set([
    ...audit.roles.filter((item) => item.decision === decision).map((item) => item.proposedTarget),
    ...audit.templates.filter((item) => item.decision === decision).map((item) => item.proposedTarget)
  ]);
  const operations = manifest.operations.filter((op) => targets.has(op.targetPath));

  return {
    projectRoot: manifest.projectRoot,
    productRoot: manifest.productRoot,
    sourceManifest: manifestPath,
    sourceAudit: auditPath,
    generated: new Date().toISOString(),
    mode: "filtered_by_surface_audit",
    selectedDecision: decision,
    selectedTargets: [...targets].sort(),
    statusCounts: statusCounts(operations),
    operations
  };
}

function renderMarkdown(filtered) {
  const lines = [];
  lines.push("# GameSpec Surface-Audit Filtered Copy Manifest");
  lines.push("");
  lines.push(`Project: \`${filtered.projectRoot}\``);
  lines.push(`Product root: \`${filtered.productRoot}\``);
  lines.push(`Selected decision: \`${filtered.selectedDecision}\``);
  lines.push(`Generated: ${filtered.generated}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${filtered.operations.length}`);
  lines.push(`- Ready for dry run: ${filtered.statusCounts.ready_for_dry_run}`);
  lines.push(`- Blocked: ${filtered.statusCounts.blocked}`);
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const op of filtered.operations) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(filtered) {
  return `${JSON.stringify(filtered, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = normalizePath(args.manifest);
  const auditPath = normalizePath(args.audit);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (manifest.projectRoot && isPathInside(outPath, normalizePath(manifest.projectRoot))) {
      throw new Error(`Refusing to write filtered manifest inside classified project: ${outPath}`);
    }
  }

  const filtered = buildFilteredManifest(manifest, audit, args.decision, manifestPath, auditPath);
  const rendered = args.format === "json" ? renderJson(filtered) : renderMarkdown(filtered);
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
  console.error(`gamespec-filter-by-surface-audit: ${error.message}`);
  process.exit(1);
}
