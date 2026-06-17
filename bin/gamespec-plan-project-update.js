#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage(exitCode = 0) {
  const text = `GameSpec project update planner

Usage:
  node bin/gamespec-plan-project-update.js --project <project-root> --decision <id> --option <id> [--project-id <id>] [--rationale <text>] [--out <path>] [--format markdown|json]
  node bin/gamespec-plan-project-update.js --decision-plan <decision-record-plan.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only for the target project.
  - Builds a decision record plan and change-impact report into one update pack.
  - Separates allowed decision-record execution from broader project-truth candidates.
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
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--project-id") {
      args.projectId = argv[++i];
    } else if (arg === "--decision") {
      args.decision = argv[++i];
    } else if (arg === "--option") {
      args.option = argv[++i];
    } else if (arg === "--rationale") {
      args.rationale = argv[++i];
    } else if (arg === "--decision-plan") {
      args.decisionPlan = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }

  if (args.decisionPlan) {
    if (args.decision || args.option || args.project || args.projectId || args.rationale) {
      throw new Error("When --decision-plan is provided, do not also provide project, decision, option, project-id, or rationale.");
    }
  } else {
    if (!args.project || !args.decision || !args.option) {
      console.error("Missing --project <project-root>, --decision <id>, or --option <id>.");
      usage(1);
    }
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

function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function quoteArg(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildDecisionPlan(args) {
  if (args.decisionPlan) {
    const planPath = normalizePath(args.decisionPlan);
    const plan = readJson(planPath);
    if (!plan.projectRoot) {
      throw new Error("Decision plan must contain projectRoot.");
    }
    return {
      plan,
      planPath,
      sourceKind: "existing_decision_plan"
    };
  }

  const plannerScript = path.join(scriptDir(), "gamespec-plan-decision-record.js");
  const plannerArgs = [
    plannerScript,
    "--project",
    normalizePath(args.project),
    "--decision",
    args.decision,
    "--option",
    args.option,
    "--format",
    "json"
  ];
  if (args.projectId) plannerArgs.push("--project-id", args.projectId);
  if (args.rationale) plannerArgs.push("--rationale", args.rationale);

  const output = execFileSync(process.execPath, plannerArgs, { encoding: "utf8" });
  return {
    plan: JSON.parse(output),
    planPath: null,
    sourceKind: "generated_from_project"
  };
}

function ensurePlanFile(plan, planPath) {
  if (planPath) return { planFile: planPath, tempDir: null };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gamespec-update-plan-"));
  const planFile = path.join(tempDir, "decision-record-plan.json");
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { planFile, tempDir };
}

function runImpact(plan, planPath) {
  const { planFile, tempDir } = ensurePlanFile(plan, planPath);
  try {
    const impactScript = path.join(scriptDir(), "gamespec-impact.js");
    const impactArgs = [
      impactScript,
      "--project",
      normalizePath(plan.projectRoot),
      "--decision-plan",
      planFile,
      "--format",
      "json"
    ];
    if (plan.projectId) impactArgs.push("--project-id", plan.projectId);
    const output = execFileSync(process.execPath, impactArgs, { encoding: "utf8" });
    return {
      impact: JSON.parse(output),
      impactSourcePlan: planPath ? normalizePath(planPath) : "temporary_generated_decision_plan"
    };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function isDecisionRecordCandidate(plan, candidate) {
  return candidate.targetPath === plan.recordTarget || candidate.action === "create_candidate_decision_record";
}

function candidateImpactEvidence(candidate, impact) {
  const evidence = [];
  if (candidate.targetPath.endsWith("/active.md")) {
    evidence.push("workflow_state_candidate");
  }
  if (impact.target?.path && candidate.targetPath.endsWith(impact.target.path)) {
    evidence.push("primary_impact_target");
  }
  for (const item of impact.recheckCandidates ?? []) {
    if (candidate.targetPath.endsWith(item.path)) evidence.push(item.impactClass);
  }
  for (const item of impact.frozenOrQuarantined ?? []) {
    if (candidate.targetPath.endsWith(item.path)) evidence.push("frozen_or_quarantined_hold");
  }
  return unique(evidence);
}

function normalizeRecordCandidates(plan) {
  const candidates = (plan.projectUpdateCandidates ?? []).filter((candidate) => isDecisionRecordCandidate(plan, candidate));
  if (candidates.length > 0) return candidates;
  return [
    {
      targetPath: plan.recordTarget,
      action: "create_candidate_decision_record",
      timing: "after_user_approval",
      projectTruth: true
    }
  ];
}

function buildDecisionRecordOperations(plan) {
  return normalizeRecordCandidates(plan).map((candidate) => ({
    lane: "decision_record_write_only",
    targetPath: candidate.targetPath,
    action: candidate.action,
    timing: candidate.timing,
    projectTruth: Boolean(candidate.projectTruth),
    writeNowInThisCommand: false,
    allowedExecutor: "gamespec-execute-decision-record-plan",
    allowedOnlyWith: ["separate decision-record plan JSON", "--write", "--approve"],
    broaderProjectTruthWritesAllowed: false
  }));
}

function buildCandidateUpdates(plan, impact) {
  return (plan.projectUpdateCandidates ?? [])
    .filter((candidate) => !isDecisionRecordCandidate(plan, candidate))
    .map((candidate) => ({
      lane: "candidate_project_truth_update",
      targetPath: candidate.targetPath,
      action: candidate.action,
      timing: candidate.timing,
      projectTruth: Boolean(candidate.projectTruth),
      writeNowInThisCommand: false,
      impactEvidence: candidateImpactEvidence(candidate, impact),
      requiredBeforeWrite: unique([
        "producer approval",
        "decision record exists or is deliberately waived",
        "proof gates closed",
        "fresh impact report reviewed",
        "separate project update apply step"
      ])
    }));
}

function buildProofProtocol(plan, impact) {
  const beforeProjectTruthWrite = [...(plan.proofSteps ?? [])];
  if (impact.summary?.activeDriverImpacted) {
    beforeProjectTruthWrite.push("Recheck the active driver before promoting impacted design truth.");
  }
  if ((impact.frozenOrQuarantined ?? []).length > 0) {
    beforeProjectTruthWrite.push("Keep frozen or quarantined downstream documents on hold until their thaw conditions pass.");
  }
  if ((impact.reviewEvidence ?? []).length > 0) {
    beforeProjectTruthWrite.push("Read relevant review evidence before changing impacted project truth.");
  }

  return {
    beforeDecisionRecordWrite: [
      "Producer explicitly accepts the selected option and rationale.",
      "Run the decision-record executor in dry-run mode first.",
      "Physical decision-record creation requires a separate --write --approve command."
    ],
    beforeProjectTruthWrite: unique(beforeProjectTruthWrite),
    mustNotWriteInThisPlan: [
      "active.md",
      "CAST_001",
      "SYS_001",
      "LEVEL_001",
      "any non-decision project truth file"
    ],
    holdItems: (impact.frozenOrQuarantined ?? []).map((item) => ({
      id: item.id,
      path: item.path,
      status: item.status,
      reason: "frozen_or_quarantined_hold"
    }))
  };
}

function buildNextCommands(plan, planPath) {
  const project = quoteArg(plan.projectRoot);
  const projectId = plan.projectId ? ` --project-id ${quoteArg(plan.projectId)}` : "";
  const planRef = planPath ? quoteArg(planPath) : "<outside-project-decision-record-plan.json>";
  const selected = plan.selected ?? {};
  const decision = selected.decisionId ?? "<decision-id>";
  const option = selected.optionId ?? "<option-id>";
  return [
    {
      id: "save_decision_record_plan",
      when: planPath ? "already_available" : "before decision-record execution",
      command: planPath
        ? `existing plan: ${planPath}`
        : `node ./bin/gamespec-plan-decision-record.js --project ${project}${projectId} --decision ${decision} --option ${option} --format json --out <outside-project-decision-record-plan.json>`
    },
    {
      id: "dry_run_decision_record",
      when: "after producer approval, before physical write",
      command: `node ./bin/gamespec-execute-decision-record-plan.js --plan ${planRef} --format markdown`
    },
    {
      id: "approved_decision_record_write",
      when: "only after dry-run is clean and producer approves",
      command: `node ./bin/gamespec-execute-decision-record-plan.js --plan ${planRef} --write --approve`
    },
    {
      id: "rerun_impact",
      when: "before any broader project-truth update",
      command: `node ./bin/gamespec-impact.js --project ${project}${projectId} --decision-plan ${planRef} --format markdown`
    }
  ];
}

function buildPack(plan, planPath, sourceKind, impactReport) {
  const impact = impactReport.impact;
  const decisionRecordOperations = buildDecisionRecordOperations(plan);
  const candidateProjectTruthUpdates = buildCandidateUpdates(plan, impact);
  return {
    generated: new Date().toISOString(),
    mode: "project_update_plan_read_only",
    projectRoot: plan.projectRoot,
    projectId: plan.projectId,
    source: {
      kind: sourceKind,
      decisionPlanPath: planPath,
      impactSourcePlan: impactReport.impactSourcePlan,
      decisionPlanGenerated: plan.generated ?? null,
      impactGenerated: impact.generated ?? null
    },
    selected: plan.selected,
    planKind: plan.planKind,
    summary: {
      decisionRecordOperations: decisionRecordOperations.length,
      candidateProjectTruthUpdates: candidateProjectTruthUpdates.length,
      activeDriverImpacted: Boolean(impact.summary?.activeDriverImpacted),
      recheckCandidates: impact.summary?.recheckCandidates ?? 0,
      frozenOrQuarantined: impact.summary?.frozenOrQuarantined ?? 0,
      reviewEvidence: impact.summary?.reviewEvidence ?? 0
    },
    decisionRecordOperations,
    candidateProjectTruthUpdates,
    impact: {
      target: impact.target,
      active: impact.active,
      summary: impact.summary,
      recheckCandidates: impact.recheckCandidates ?? [],
      frozenOrQuarantined: impact.frozenOrQuarantined ?? [],
      reviewEvidence: impact.reviewEvidence ?? []
    },
    proofProtocol: buildProofProtocol(plan, impact),
    nextCommands: buildNextCommands(plan, planPath),
    embeddedDecisionPlan: plan,
    writePolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      decisionRecordWritesRequireSeparateExecutor: true,
      broaderProjectTruthWritesRequireFutureApplySlice: true,
      reportMayNotBeWrittenInsideTargetProject: true
    },
    guardrails: [
      "This command is read-only for the target project.",
      "It may build temporary reports outside the target project while running.",
      "It does not update active.md, CAST_001, SYS_001, LEVEL_001, or any project truth.",
      "Decision-record creation remains a separate explicit --write --approve operation.",
      "Frozen or quarantined downstream documents are hold items, not active inputs."
    ],
    sources: plan.sources ?? {}
  };
}

function renderMarkdown(pack) {
  const lines = [];
  lines.push("# GameSpec Project Update Plan");
  lines.push("");
  lines.push(`Mode: \`${pack.mode}\``);
  lines.push(`Project root: \`${pack.projectRoot}\``);
  lines.push(`Project id: \`${pack.projectId}\``);
  lines.push(`Generated: ${pack.generated}`);
  lines.push("");

  lines.push("## Selected Decision");
  lines.push("");
  lines.push(`- Decision: \`${pack.selected?.decisionId ?? "unknown"}\` ${pack.selected?.decisionTitle ?? ""}`);
  lines.push(`- Option: \`${pack.selected?.optionId ?? "unknown"}\` ${pack.selected?.optionName ?? ""}`);
  lines.push(`- Plan kind: \`${pack.planKind ?? "unknown"}\``);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Decision-record operations: ${pack.summary.decisionRecordOperations}`);
  lines.push(`- Candidate project-truth updates: ${pack.summary.candidateProjectTruthUpdates}`);
  lines.push(`- Active driver impacted: ${pack.summary.activeDriverImpacted}`);
  lines.push(`- Recheck candidates: ${pack.summary.recheckCandidates}`);
  lines.push(`- Frozen/quarantined holds: ${pack.summary.frozenOrQuarantined}`);
  lines.push(`- Review evidence docs: ${pack.summary.reviewEvidence}`);
  lines.push("");

  lines.push("## Decision Record Operation");
  lines.push("");
  for (const operation of pack.decisionRecordOperations) {
    lines.push(`- \`${operation.targetPath}\``);
    lines.push(`  - lane: ${operation.lane}`);
    lines.push(`  - action: ${operation.action}`);
    lines.push(`  - write now: ${operation.writeNowInThisCommand}`);
    lines.push(`  - allowed executor: ${operation.allowedExecutor}`);
  }
  lines.push("");

  lines.push("## Candidate Project Truth Updates");
  lines.push("");
  if (pack.candidateProjectTruthUpdates.length === 0) {
    lines.push("- None.");
  } else {
    for (const candidate of pack.candidateProjectTruthUpdates) {
      lines.push(`- \`${candidate.targetPath}\``);
      lines.push(`  - action: ${candidate.action}`);
      lines.push(`  - timing: ${candidate.timing}`);
      lines.push(`  - write now: ${candidate.writeNowInThisCommand}`);
      lines.push(`  - impact evidence: ${candidate.impactEvidence.length > 0 ? candidate.impactEvidence.join(", ") : "none"}`);
    }
  }
  lines.push("");

  lines.push("## Impact");
  lines.push("");
  lines.push(`- Target: \`${pack.impact.target?.id ?? "unknown"}\` -> \`${pack.impact.target?.path ?? "unknown"}\``);
  lines.push(`- Active: \`${pack.impact.active?.id ?? "unknown"}\` (${pack.impact.active?.impactClass ?? "unknown"})`);
  lines.push("");

  lines.push("Recheck candidates:");
  if (pack.impact.recheckCandidates.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of pack.impact.recheckCandidates) {
      lines.push(`- \`${item.id}\` (${item.impactClass}) -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("Frozen/quarantined holds:");
  if (pack.impact.frozenOrQuarantined.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of pack.impact.frozenOrQuarantined) {
      lines.push(`- \`${item.id}\` (${item.status}) -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Proof Protocol");
  lines.push("");
  lines.push("Before decision record write:");
  for (const step of pack.proofProtocol.beforeDecisionRecordWrite) lines.push(`- ${step}`);
  lines.push("");
  lines.push("Before broader project-truth write:");
  for (const step of pack.proofProtocol.beforeProjectTruthWrite) lines.push(`- ${step}`);
  lines.push("");

  lines.push("## Next Commands");
  lines.push("");
  for (const command of pack.nextCommands) {
    lines.push(`- \`${command.id}\` (${command.when})`);
    lines.push(`  - ${command.command}`);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of pack.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(pack) {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const built = buildDecisionPlan(args);
  built.plan.projectRoot = normalizePath(built.plan.projectRoot);
  if (!fs.existsSync(built.plan.projectRoot)) {
    throw new Error(`Project root does not exist: ${built.plan.projectRoot}`);
  }
  if (!built.plan.projectId) {
    throw new Error("Decision plan must contain projectId.");
  }

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, built.plan.projectRoot)) {
      throw new Error(`Refusing to write project update plan inside target project: ${outPath}`);
    }
  }

  const impactReport = runImpact(built.plan, built.planPath);
  const pack = buildPack(built.plan, built.planPath, built.sourceKind, impactReport);
  const rendered = args.format === "json" ? renderJson(pack) : renderMarkdown(pack);

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
  console.error(`gamespec-plan-project-update: ${error.message}`);
  process.exit(1);
}
