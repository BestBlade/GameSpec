#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec return-path chain reporter

Usage:
  node bin/gamespec-report-return-path.js --manifest <return-path-manifest.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Reads declared evidence files only.
  - Separates target-project dry-runs from fixture write proofs.
  - Detects missing, blocked, stale, and target-project write evidence.
  - Refuses report output inside the target project.
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
    console.error("Missing --manifest <return-path-manifest.json>.");
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

function resolveMaybeRelative(inputPath, baseDir) {
  if (!inputPath) return null;
  return path.isAbsolute(inputPath) ? normalizePath(inputPath) : normalizePath(path.join(baseDir, inputPath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function statusCounts(data) {
  return data?.statusCounts ?? {};
}

function countValue(counts, names) {
  return names.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
}

function hasBlockedSignal(data) {
  const counts = statusCounts(data);
  return data?.state === "blocked" ||
    data?.status === "blocked" ||
    countValue(counts, ["blocked"]) > 0;
}

function hasDryRunAction(data) {
  if (data?.mode !== "dry_run") return false;
  const counts = statusCounts(data);
  return countValue(counts, ["would_apply", "would_write"]) > 0;
}

function hasWriteAction(data) {
  if (data?.mode !== "write") return false;
  const counts = statusCounts(data);
  return countValue(counts, ["applied", "wrote", "already_current"]) > 0 ||
    Boolean(data.writtenPath);
}

function hasReadOnlyPlan(data) {
  return typeof data?.mode === "string" && data.mode.endsWith("_read_only");
}

function targetProjectWriteDetected(data, projectRoot) {
  if (!projectRoot) return false;
  const reportRoot = data?.projectRoot ? normalizePath(data.projectRoot) : null;
  const writtenPath = data?.writtenPath ? normalizePath(data.writtenPath) : null;
  if (data?.mode === "write" && reportRoot && isPathInside(reportRoot, projectRoot)) return true;
  if (writtenPath && isPathInside(writtenPath, projectRoot)) return true;
  return false;
}

function scopeForStage(stage, data, projectRoot) {
  if (stage.scope) return stage.scope;
  const reportRoot = data?.projectRoot ? normalizePath(data.projectRoot) : null;
  if (reportRoot && projectRoot && isPathInside(reportRoot, projectRoot)) return "target";
  if (reportRoot) return "fixture";
  return "evidence";
}

function checkExpectations(stage, data) {
  const issues = [];
  const expect = stage.expect ?? {};
  if (expect.mode && data?.mode !== expect.mode) issues.push(`expected_mode:${expect.mode}`);
  if (expect.state && data?.state !== expect.state) issues.push(`expected_state:${expect.state}`);
  if (expect.status && data?.status !== expect.status) issues.push(`expected_status:${expect.status}`);
  const counts = statusCounts(data);
  for (const [key, value] of Object.entries(expect.statusCountsAtLeast ?? {})) {
    if ((counts[key] ?? 0) < value) issues.push(`expected_${key}_at_least:${value}`);
  }
  return issues;
}

function classifyStage(stage, manifestDir, projectRoot, policy) {
  const resolvedPath = resolveMaybeRelative(stage.path, manifestDir);
  const base = {
    id: stage.id,
    title: stage.title ?? stage.id,
    kind: stage.kind ?? "evidence",
    required: stage.required !== false,
    scope: stage.scope ?? null,
    path: stage.path ?? null,
    resolvedPath,
    classification: "unknown",
    issues: [],
    facts: {}
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    base.classification = base.required ? "missing_required" : "missing_optional";
    base.issues.push("evidence_file_missing");
    return base;
  }

  let data = null;
  try {
    data = readJson(resolvedPath);
  } catch (error) {
    base.classification = base.required ? "blocked" : "warning";
    base.issues.push(`json_read_failed:${error.message}`);
    return base;
  }

  const counts = statusCounts(data);
  const scope = scopeForStage(stage, data, projectRoot);
  const expectationIssues = checkExpectations(stage, data);
  const targetWrite = targetProjectWriteDetected(data, projectRoot);
  const policyForbidsTargetWrites = policy.targetProjectWritesAllowed !== true;

  base.scope = scope;
  base.facts = {
    mode: data.mode ?? null,
    state: data.state ?? null,
    status: data.status ?? null,
    projectRoot: data.projectRoot ?? null,
    projectId: data.projectId ?? null,
    statusCounts: counts,
    writtenPath: data.writtenPath ?? null
  };
  base.issues.push(...expectationIssues);

  if (targetWrite && policyForbidsTargetWrites) {
    base.classification = "blocked";
    base.issues.push("target_project_write_detected");
    return base;
  }

  if (stage.kind === "negative_proof" && hasBlockedSignal(data)) {
    base.classification = "negative_proof_pass";
    return base;
  }

  if (hasBlockedSignal(data)) {
    base.classification = "blocked";
    return base;
  }

  if (expectationIssues.length > 0) {
    base.classification = base.required ? "blocked" : "warning";
    return base;
  }

  if (hasWriteAction(data)) {
    base.classification = scope === "fixture" ? "fixture_write_pass" : "write_pass";
    return base;
  }

  if (hasDryRunAction(data)) {
    base.classification = "dry_run_pass";
    return base;
  }

  if (data.status === "pass") {
    base.classification = "pass";
    return base;
  }

  if (hasReadOnlyPlan(data)) {
    base.classification = "plan_pass";
    return base;
  }

  base.classification = "informational";
  return base;
}

function summarize(stages, manifest) {
  const required = stages.filter((stage) => stage.required);
  const missingRequired = stages.filter((stage) => stage.classification === "missing_required");
  const blocked = stages.filter((stage) => stage.classification === "blocked");
  const targetDryRuns = stages.filter((stage) => stage.scope === "target" && stage.classification === "dry_run_pass");
  const fixtureWrites = stages.filter((stage) => stage.classification === "fixture_write_pass");
  const targetWrites = stages.filter((stage) => stage.issues.includes("target_project_write_detected"));
  const futurePlans = stages.filter((stage) => {
    const state = stage.facts.state ?? "";
    return stage.scope === "target" && (state.startsWith("would_") || state === "candidate_after_apply");
  });

  let chainState = "verified";
  const reasons = [];
  if (missingRequired.length > 0 || blocked.length > 0) {
    chainState = "blocked";
    reasons.push("missing_or_blocked_required_evidence");
  } else if (targetWrites.length > 0) {
    chainState = "blocked";
    reasons.push("target_project_write_detected");
  } else if (targetDryRuns.length > 0 || futurePlans.length > 0) {
    chainState = "project_dry_run_chain_verified";
    reasons.push("target_project_evidence_is_dry_run_or_future_plan");
  }

  const unattendedApply = chainState === "verified" ? "not_assessed" : "not_ready";
  const guardedHumanApply = chainState === "project_dry_run_chain_verified"
    ? "candidate_after_explicit_approval_and_fresh_sequence"
    : "not_ready";

  return {
    totalStages: stages.length,
    requiredStages: required.length,
    missingRequired: missingRequired.map((stage) => stage.id),
    blockedStages: blocked.map((stage) => stage.id),
    targetDryRunStages: targetDryRuns.map((stage) => stage.id),
    fixtureWriteProofs: fixtureWrites.map((stage) => stage.id),
    targetProjectWritesDetected: targetWrites.map((stage) => stage.id),
    futureOrConditionalStages: futurePlans.map((stage) => stage.id),
    chainState,
    readiness: {
      unattendedApply,
      guardedHumanApply,
      reasons,
      requiredHumanDecisions: manifest.requiredHumanDecisions ?? []
    }
  };
}

function buildReport(manifest, manifestPath) {
  const manifestDir = path.dirname(manifestPath);
  const projectRoot = normalizePath(manifest.projectRoot);
  const policy = manifest.policy ?? {};
  const stages = (manifest.stages ?? []).map((stage) => classifyStage(stage, manifestDir, projectRoot, policy));
  const summary = summarize(stages, manifest);

  return {
    generated: new Date().toISOString(),
    mode: "return_path_chain_report_read_only",
    manifestPath,
    projectRoot,
    projectId: manifest.projectId ?? null,
    policy: {
      targetProjectWritesAllowed: policy.targetProjectWritesAllowed === true,
      reportMayNotBeWrittenInsideTargetProject: true
    },
    summary,
    stages,
    guardrails: [
      "Read-only chain report.",
      "Does not execute any underlying stage.",
      "Does not write target project truth.",
      "Fixture writes are reported separately from target-project proof.",
      "Dry-run evidence is not treated as already-applied project truth."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Return-Path Chain Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId ?? "unknown"}\``);
  lines.push(`Chain state: \`${report.summary.chainState}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Readiness");
  lines.push("");
  lines.push(`- Unattended apply: \`${report.summary.readiness.unattendedApply}\``);
  lines.push(`- Guarded human apply: \`${report.summary.readiness.guardedHumanApply}\``);
  if (report.summary.readiness.reasons.length > 0) {
    for (const reason of report.summary.readiness.reasons) lines.push(`- Reason: ${reason}`);
  }
  lines.push("");

  if (report.summary.readiness.requiredHumanDecisions.length > 0) {
    lines.push("## Required Human Decisions");
    lines.push("");
    for (const item of report.summary.readiness.requiredHumanDecisions) lines.push(`- ${item}`);
    lines.push("");
  }

  lines.push("## Stage Summary");
  lines.push("");
  lines.push("| Stage | Scope | Classification | Mode | State/Status | Counts | Issues |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const stage of report.stages) {
    const stateOrStatus = stage.facts.state ?? stage.facts.status ?? "";
    const counts = Object.keys(stage.facts.statusCounts ?? {}).length > 0
      ? JSON.stringify(stage.facts.statusCounts)
      : "";
    const issues = stage.issues.length > 0 ? stage.issues.join(", ") : "";
    lines.push(`| \`${stage.id}\` | ${stage.scope ?? ""} | \`${stage.classification}\` | \`${stage.facts.mode ?? ""}\` | \`${stateOrStatus}\` | \`${counts}\` | ${issues} |`);
  }
  lines.push("");

  lines.push("## Highlights");
  lines.push("");
  lines.push(`- Target dry-run stages: ${report.summary.targetDryRunStages.length === 0 ? "none" : report.summary.targetDryRunStages.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(`- Fixture write proofs: ${report.summary.fixtureWriteProofs.length === 0 ? "none" : report.summary.fixtureWriteProofs.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(`- Missing required stages: ${report.summary.missingRequired.length === 0 ? "none" : report.summary.missingRequired.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(`- Blocked stages: ${report.summary.blockedStages.length === 0 ? "none" : report.summary.blockedStages.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(`- Target project writes detected: ${report.summary.targetProjectWritesDetected.length === 0 ? "none" : report.summary.targetProjectWritesDetected.map((id) => `\`${id}\``).join(", ")}`);
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
  const manifestPath = normalizePath(args.manifest);
  const manifest = readJson(manifestPath);
  if (!manifest.projectRoot) throw new Error("Manifest must contain projectRoot.");
  if (!Array.isArray(manifest.stages)) throw new Error("Manifest must contain stages array.");

  const projectRoot = normalizePath(manifest.projectRoot);
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write return-path chain report inside target project: ${outPath}`);
    }
  }

  const report = buildReport(manifest, manifestPath);
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
  console.error(`gamespec-report-return-path: ${error.message}`);
  process.exit(1);
}
