#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec copy manifest filter

Usage:
  node bin/gamespec-filter-copy-manifest.js --manifest <copy-manifest.json> --review <admission-review.json> [--admission <label[,label]>] [--include-prefix <target-prefix>] [--exclude-contains <text>] [--out <path>] [--format json|markdown]

Rules:
  - Filters a copy manifest by admission labels from a manifest review.
  - Performs no file copy.
  - Refuses to write output inside the classified project.
  - Defaults to --admission approved_for_staging.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    format: "json",
    admissions: ["approved_for_staging"],
    includePrefixes: [],
    excludeContains: []
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--manifest") {
      args.manifest = argv[++i];
    } else if (arg === "--review") {
      args.review = argv[++i];
    } else if (arg === "--admission") {
      args.admissions = argv[++i].split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg === "--include-prefix") {
      args.includePrefixes.push(argv[++i]);
    } else if (arg === "--exclude-contains") {
      args.excludeContains.push(argv[++i]);
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
  if (!args.review) {
    console.error("Missing --review <admission-review.json>.");
    usage(1);
  }
  if (!["json", "markdown"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
  }
  if (args.admissions.length === 0) {
    throw new Error("At least one admission label is required.");
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

function validate(manifest, review) {
  if (!manifest.projectRoot || !manifest.productRoot || !Array.isArray(manifest.operations)) {
    throw new Error("Copy manifest must contain projectRoot, productRoot, and operations.");
  }
  if (!Array.isArray(review.items)) {
    throw new Error("Admission review must contain items.");
  }
  if (review.projectRoot && normalizePath(review.projectRoot) !== normalizePath(manifest.projectRoot)) {
    throw new Error("Admission review projectRoot does not match manifest projectRoot.");
  }
  if (review.productRoot && normalizePath(review.productRoot) !== normalizePath(manifest.productRoot)) {
    throw new Error("Admission review productRoot does not match manifest productRoot.");
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

function targetPassesFilters(targetPath, includePrefixes, excludeContains) {
  if (includePrefixes.length > 0 && !includePrefixes.some((prefix) => targetPath.startsWith(prefix))) {
    return false;
  }
  if (excludeContains.some((text) => targetPath.includes(text))) {
    return false;
  }
  return true;
}

function buildFilteredManifest(manifest, review, args, manifestPath, reviewPath) {
  validate(manifest, review);
  const allowed = new Set(args.admissions);
  const admittedTargets = new Set(
    review.items
      .filter((item) => allowed.has(item.admission))
      .filter((item) => item.targetPath && targetPassesFilters(item.targetPath, args.includePrefixes, args.excludeContains))
      .map((item) => item.targetPath)
  );
  const operations = manifest.operations.filter((op) => admittedTargets.has(op.targetPath));

  return {
    projectRoot: manifest.projectRoot,
    productRoot: manifest.productRoot,
    sourceManifest: manifestPath,
    sourceReview: reviewPath,
    generated: new Date().toISOString(),
    mode: "filtered_by_admission",
    selectedAdmissions: args.admissions,
    includePrefixes: args.includePrefixes,
    excludeContains: args.excludeContains,
    statusCounts: statusCounts(operations),
    operations
  };
}

function renderMarkdown(filtered) {
  const lines = [];
  lines.push("# GameSpec Filtered Copy Manifest");
  lines.push("");
  lines.push(`Project: \`${filtered.projectRoot}\``);
  lines.push(`Product root: \`${filtered.productRoot}\``);
  lines.push(`Selected admissions: \`${filtered.selectedAdmissions.join(", ")}\``);
  if (filtered.includePrefixes.length > 0) {
    lines.push(`Include prefixes: \`${filtered.includePrefixes.join(", ")}\``);
  }
  if (filtered.excludeContains.length > 0) {
    lines.push(`Exclude contains: \`${filtered.excludeContains.join(", ")}\``);
  }
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
  for (const op of filtered.operations.slice(0, 80)) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
  }
  const remaining = filtered.operations.length - 80;
  if (remaining > 0) lines.push(`- ... ${remaining} more`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(filtered) {
  return `${JSON.stringify(filtered, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = normalizePath(args.manifest);
  const reviewPath = normalizePath(args.review);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (manifest.projectRoot && isPathInside(outPath, normalizePath(manifest.projectRoot))) {
      throw new Error(`Refusing to write filtered manifest inside classified project: ${outPath}`);
    }
  }

  const filtered = buildFilteredManifest(manifest, review, args, manifestPath, reviewPath);
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
  console.error(`gamespec-filter-copy-manifest: ${error.message}`);
  process.exit(1);
}
