#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REPORT_STATUSES = [
  "would_copy",
  "copied",
  "already_current",
  "blocked"
];

function usage(exitCode = 0) {
  const text = `GameSpec install executor

Usage:
  node bin/gamespec-execute-install.js --plan <install-plan.json> [--out <path>] [--format markdown|json] [--write]

Rules:
  - Dry-run by default.
  - Copies files only when --write is provided.
  - Refuses to overwrite differing product-managed project files.
  - Writes install state only in --write mode.
  - Refuses to write reports inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", write: false };
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
  return args;
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function sameFileBytes(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function isSupportedSurface(surface) {
  return ["runtime", "kernel"].includes(surface);
}

function isProjectTruthTarget(targetAbs, projectRoot) {
  const projectTruthRoot = path.join(projectRoot, "gamespec", "projects");
  return isPathInside(targetAbs, projectTruthRoot);
}

function validatePlan(plan) {
  if (!plan.projectRoot || !plan.productRoot || !Array.isArray(plan.operations)) {
    throw new Error("Install plan must contain projectRoot, productRoot, and operations.");
  }
  if (!["runtime", "kernel", "all"].includes(plan.surface)) {
    throw new Error(`Unsupported install surface: ${plan.surface}`);
  }
  const unsupported = plan.operations
    .map((op) => op.surface)
    .filter((surface) => !isSupportedSurface(surface));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported operation surface(s): ${Array.from(new Set(unsupported)).join(", ")}`);
  }
}

function recheckOperation(op, projectRoot, productRoot) {
  const issues = [];
  if (op.op !== "copy") issues.push("unsupported_operation");
  if (!isSupportedSurface(op.surface)) issues.push("unsupported_surface");
  if (!op.sourcePath) issues.push("missing_source_path");
  if (!op.targetPath) issues.push("missing_target_path");

  const sourceAbs = normalizePath(
    op.sourceAbs ?? (op.sourcePath ? path.join(productRoot, ...op.sourcePath.split("/")) : productRoot)
  );
  const targetAbs = normalizePath(
    op.targetAbs ?? (op.targetPath ? path.join(projectRoot, ...op.targetPath.split("/")) : projectRoot)
  );

  if (!isPathInside(sourceAbs, productRoot)) issues.push("source_outside_product");
  if (!isPathInside(targetAbs, projectRoot)) issues.push("target_outside_project");
  if (isProjectTruthTarget(targetAbs, projectRoot)) issues.push("target_inside_project_truth");
  if (!fs.existsSync(sourceAbs)) issues.push("source_missing");

  let status = "would_copy";
  if (issues.length > 0) {
    status = "blocked";
  } else if (fs.existsSync(targetAbs)) {
    if (sameFileBytes(sourceAbs, targetAbs)) {
      status = "already_current";
    } else {
      status = "blocked";
      issues.push("target_exists_differs");
    }
  }

  return {
    op: "copy",
    surface: op.surface,
    sourcePath: op.sourcePath,
    sourceAbs,
    targetPath: op.targetPath,
    targetAbs,
    status,
    issues
  };
}

function countStatuses(operations) {
  const counts = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0]));
  for (const op of operations) counts[op.status] += 1;
  return counts;
}

function installStatePath(projectRoot, plan) {
  const stateRelative = plan.plannedInstallState?.path ?? "gamespec/.gamespec-install.json";
  return path.join(projectRoot, ...stateRelative.split("/"));
}

function buildInstallState(plan, operations) {
  return {
    productRoot: plan.productRoot,
    productVersion: plan.productVersion ?? null,
    installSurfaceManifest: plan.installSurfaceManifest ?? null,
    installProfile: plan.installSurfaceManifest?.selectedProfile ?? null,
    runtimeHostSelection: plan.installSurfaceManifest?.runtimeHostSelection ?? null,
    installedSurfaces: Array.from(new Set(operations.map((op) => op.surface))).sort(),
    generated: new Date().toISOString(),
    operationCounts: countStatuses(operations),
    operations: operations.map((op) => ({
      sourcePath: op.sourcePath,
      targetPath: op.targetPath,
      status: op.status
    }))
  };
}

function executeWrites(plan, operations) {
  const blocked = operations.filter((op) => op.status === "blocked");
  if (blocked.length > 0) {
    throw new Error(`Refusing to install because ${blocked.length} operation(s) are blocked.`);
  }

  for (const op of operations) {
    if (op.status !== "would_copy") continue;
    fs.mkdirSync(path.dirname(op.targetAbs), { recursive: true });
    fs.copyFileSync(op.sourceAbs, op.targetAbs);
    op.status = "copied";
  }

  const statePath = installStatePath(plan.projectRoot, plan);
  if (!isPathInside(statePath, plan.projectRoot)) {
    throw new Error(`Refusing to write install state outside project: ${statePath}`);
  }
  if (isProjectTruthTarget(statePath, plan.projectRoot)) {
    throw new Error(`Refusing to write install state inside project truth: ${statePath}`);
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(buildInstallState(plan, operations), null, 2)}\n`, "utf8");
  return statePath;
}

function buildReport(plan, planPath, mode, operations, installStateWritten) {
  return {
    projectRoot: plan.projectRoot,
    productRoot: plan.productRoot,
    sourcePlan: planPath,
    generated: new Date().toISOString(),
    mode,
    surface: plan.surface,
    productVersion: plan.productVersion ?? null,
    installSurfaceManifest: plan.installSurfaceManifest ?? null,
    statusCounts: countStatuses(operations),
    installState: {
      plannedPath: plan.plannedInstallState?.path ?? "gamespec/.gamespec-install.json",
      writtenPath: installStateWritten
    },
    operations,
    safetyInvariants: [
      "Dry-run is the default behavior.",
      "Write mode requires explicit --write.",
      "Differing existing product-managed files block installation.",
      "Project truth under gamespec/projects/ is never targeted.",
      "Install state is written only in --write mode."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Install Execution Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Surface: \`${report.surface}\``);
  lines.push(`Project: \`${report.projectRoot}\``);
  lines.push(`Product root: \`${report.productRoot}\``);
  lines.push(`Product version: \`${report.productVersion ?? "unknown"}\``);
  if (report.installSurfaceManifest) {
    lines.push(`Install surface: \`${report.installSurfaceManifest.surfaceId}\` \`${report.installSurfaceManifest.surfaceVersion}\``);
    lines.push(`Install profile: \`${report.installSurfaceManifest.selectedProfile ?? "unknown"}\``);
  }
  lines.push(`Generated: ${report.generated}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of REPORT_STATUSES) {
    lines.push(`| \`${status}\` | ${report.statusCounts[status]} |`);
  }
  lines.push("");
  lines.push("## Install State");
  lines.push("");
  lines.push(`- Planned path: \`${report.installState.plannedPath}\``);
  lines.push(`- Written path: \`${report.installState.writtenPath ?? "not written"}\``);
  lines.push("");
  lines.push("## Safety Invariants");
  lines.push("");
  for (const invariant of report.safetyInvariants) lines.push(`- ${invariant}`);
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const op of report.operations) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
    lines.push(`  - status: ${op.status}`);
    if (op.issues.length > 0) lines.push(`  - issues: ${op.issues.join(", ")}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = normalizePath(args.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  validatePlan(plan);
  plan.projectRoot = normalizePath(plan.projectRoot);
  plan.productRoot = normalizePath(plan.productRoot);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, plan.projectRoot)) {
      throw new Error(`Refusing to write install execution report inside target project: ${outPath}`);
    }
  }

  const operations = plan.operations.map((op) => recheckOperation(op, plan.projectRoot, plan.productRoot));
  let installStateWritten = null;
  if (args.write) {
    installStateWritten = executeWrites(plan, operations);
  }

  const report = buildReport(plan, planPath, args.write ? "write" : "dry_run", operations, installStateWritten);
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
  console.error(`gamespec-execute-install: ${error.message}`);
  process.exit(1);
}
