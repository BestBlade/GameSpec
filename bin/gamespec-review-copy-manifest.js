#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ADMISSIONS = [
  "approved_for_staging",
  "needs_product_review",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec copy manifest admission review

Usage:
  node bin/gamespec-review-copy-manifest.js --manifest <copy-manifest.json> [--out <path>] [--format markdown|json]

Rules:
  - Reviews an existing copy manifest before physical import.
  - Separates staging import eligibility from release readiness.
  - Performs no file copy.
  - Refuses to write reports inside the classified project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--manifest") {
      args.manifest = argv[++i];
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

function toNativeFromPosix(posixPath) {
  return posixPath.split("/").join(path.sep);
}

function validateManifest(manifest) {
  if (!manifest.projectRoot || !manifest.productRoot || !Array.isArray(manifest.operations)) {
    throw new Error("Copy manifest must contain projectRoot, productRoot, and operations.");
  }
}

function areaFor(targetPath) {
  const parts = targetPath.split("/");
  if (parts[0] === "runtime") return parts.slice(0, 2).join("/");
  if (parts[0] === "kernel" && parts[1]) return parts.slice(0, 2).join("/");
  return parts[0] || "unknown";
}

function hasSuspiciousPathText(value) {
  return /[\u0000-\u001f\u007f\uFFFD]/u.test(value);
}

function reviewOperation(op, manifest, targetCounts) {
  const reasons = [];
  const flags = [];
  const projectRoot = normalizePath(manifest.projectRoot);
  const productRoot = normalizePath(manifest.productRoot);
  const sourceAbs = op.sourcePath
    ? normalizePath(path.join(projectRoot, toNativeFromPosix(op.sourcePath)))
    : null;
  const targetAbs = op.targetPath
    ? normalizePath(path.join(productRoot, toNativeFromPosix(op.targetPath)))
    : null;

  if (op.op !== "copy") reasons.push("Unsupported manifest operation.");
  if (op.status !== "ready_for_dry_run") reasons.push("Manifest operation is not ready for dry-run.");
  if (!op.sourcePath) reasons.push("Missing source path.");
  if (!op.targetPath) reasons.push("Missing target path.");
  if (op.sourcePath && hasSuspiciousPathText(op.sourcePath)) reasons.push("Source path contains control or replacement characters.");
  if (op.targetPath && hasSuspiciousPathText(op.targetPath)) reasons.push("Target path contains control or replacement characters.");
  if (sourceAbs && !fs.existsSync(sourceAbs)) reasons.push("Source file is missing.");
  if (targetAbs && !isPathInside(targetAbs, productRoot)) reasons.push("Target is outside product root.");
  if (targetAbs && isPathInside(targetAbs, projectRoot)) reasons.push("Target is inside classified project.");
  if (op.targetPath && targetCounts.get(op.targetPath) > 1) reasons.push("Target path is duplicated in manifest.");

  let admission = reasons.length > 0 ? "blocked" : "approved_for_staging";
  let releaseReadiness = "release_candidate";

  if (admission !== "blocked") {
    if (op.targetPath.startsWith("runtime/")) {
      flags.push("runtime_adapter_surface");
      admission = "needs_product_review";
      releaseReadiness = "adapter_contract_unreviewed";
    }
    if (op.targetPath.startsWith("kernel/roles/")) {
      flags.push("role_surface");
      admission = "needs_product_review";
      releaseReadiness = "role_taxonomy_unreviewed";
    }
    if (op.targetPath.startsWith("kernel/templates/")) {
      flags.push("template_surface");
      admission = "needs_product_review";
      releaseReadiness = "template_contract_unreviewed";
    }
    if (op.targetPath.includes("source-command-gmsx")) {
      flags.push("legacy_source_command_surface");
      admission = "needs_product_review";
      releaseReadiness = "legacy_adapter_unreviewed";
    }
  }

  return {
    sourcePath: op.sourcePath,
    targetPath: op.targetPath,
    area: op.targetPath ? areaFor(op.targetPath) : "unknown",
    admission,
    releaseReadiness,
    flags,
    reasons
  };
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function buildReview(manifest, manifestPath) {
  validateManifest(manifest);
  const targetCounts = new Map();
  for (const op of manifest.operations) {
    if (op.targetPath) targetCounts.set(op.targetPath, (targetCounts.get(op.targetPath) ?? 0) + 1);
  }

  const items = manifest.operations.map((op) => reviewOperation(op, manifest, targetCounts));
  const admissionCounts = Object.fromEntries(ADMISSIONS.map((admission) => [admission, 0]));
  for (const item of items) admissionCounts[item.admission] += 1;

  const blocked = admissionCounts.blocked > 0;
  const reviewHolds = admissionCounts.needs_product_review > 0;
  const recommendation = blocked
    ? "Do not execute the manifest. Resolve blocked operations first."
    : reviewHolds
      ? "Physical staging import is possible, but release surface is not ready. Review held runtime, role, and template surfaces before publishing."
      : "Manifest is approved for staging import and has no product-review holds.";

  return {
    projectRoot: manifest.projectRoot,
    productRoot: manifest.productRoot,
    sourceManifest: manifestPath,
    generated: new Date().toISOString(),
    mode: "admission_review",
    admissionCounts,
    areaCounts: countBy(items, "area"),
    recommendation,
    safetyInvariants: [
      "This review performs no file copy.",
      "Approved for staging is not the same as release-ready.",
      "Runtime adapters require host-contract review.",
      "Role and template surfaces require product-language review.",
      "Project truth remains excluded by the upstream extraction plan."
    ],
    items
  };
}

function firstItems(items, admission, limit = 16) {
  return items.filter((item) => item.admission === admission).slice(0, limit);
}

function renderMarkdown(review) {
  const lines = [];
  lines.push("# GameSpec Copy Manifest Admission Review");
  lines.push("");
  lines.push(`Project: \`${review.projectRoot}\``);
  lines.push(`Product root: \`${review.productRoot}\``);
  lines.push(`Generated: ${review.generated}`);
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(review.recommendation);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Admission | Count |");
  lines.push("| --- | ---: |");
  for (const admission of ADMISSIONS) {
    lines.push(`| \`${admission}\` | ${review.admissionCounts[admission]} |`);
  }
  lines.push("");
  lines.push("## Areas");
  lines.push("");
  lines.push("| Area | Count |");
  lines.push("| --- | ---: |");
  for (const [area, count] of Object.entries(review.areaCounts).sort()) {
    lines.push(`| \`${area}\` | ${count} |`);
  }
  lines.push("");
  lines.push("## Safety Invariants");
  lines.push("");
  for (const invariant of review.safetyInvariants) {
    lines.push(`- ${invariant}`);
  }
  lines.push("");

  for (const admission of ADMISSIONS) {
    lines.push(`## ${admission}`);
    lines.push("");
    const items = firstItems(review.items, admission);
    if (items.length === 0) {
      lines.push("_No items._");
    } else {
      for (const item of items) {
        lines.push(`- \`${item.sourcePath}\` -> \`${item.targetPath}\``);
        lines.push(`  - area: ${item.area}`);
        lines.push(`  - release readiness: ${item.releaseReadiness}`);
        if (item.flags.length > 0) lines.push(`  - flags: ${item.flags.join(", ")}`);
        if (item.reasons.length > 0) lines.push(`  - reasons: ${item.reasons.join(" ")}`);
      }
      const remaining = review.admissionCounts[admission] - items.length;
      if (remaining > 0) lines.push(`- ... ${remaining} more`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderJson(review) {
  return `${JSON.stringify(review, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = normalizePath(args.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (manifest.projectRoot && isPathInside(outPath, normalizePath(manifest.projectRoot))) {
      throw new Error(`Refusing to write admission review inside classified project: ${outPath}`);
    }
  }

  const review = buildReview(manifest, manifestPath);
  const rendered = args.format === "json" ? renderJson(review) : renderMarkdown(review);
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
  console.error(`gamespec-review-copy-manifest: ${error.message}`);
  process.exit(1);
}
