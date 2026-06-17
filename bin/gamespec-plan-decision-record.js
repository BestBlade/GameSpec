#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage(exitCode = 0) {
  const text = `GameSpec decision record planner

Usage:
  node bin/gamespec-plan-decision-record.js (--project <project-root> | --pack <decision-pack.json>) --decision <id> --option <id> [--project-id <id>] [--rationale <text>] [--out <path>] [--format markdown|json]

Rules:
  - Plan-only and read-only.
  - Builds on a producer decision pack.
  - Refuses report output inside the target project.
  - May name future project-truth targets, but never writes them.
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
    } else if (arg === "--pack") {
      args.pack = argv[++i];
    } else if (arg === "--decision") {
      args.decision = argv[++i];
    } else if (arg === "--option") {
      args.option = argv[++i];
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
  if (!args.project && !args.pack) {
    console.error("Missing --project <project-root> or --pack <decision-pack.json>.");
    usage(1);
  }
  if (args.project && args.pack) {
    throw new Error("Use either --project or --pack, not both.");
  }
  if (!args.decision) {
    console.error("Missing --decision <id>.");
    usage(1);
  }
  if (!args.option) {
    console.error("Missing --option <id>.");
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

function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function readPack(args) {
  if (args.pack) {
    return JSON.parse(fs.readFileSync(normalizePath(args.pack), "utf8"));
  }

  const packScript = path.join(scriptDir(), "gamespec-decision-pack.js");
  const packArgs = [
    packScript,
    "--project",
    normalizePath(args.project),
    "--format",
    "json"
  ];
  if (args.projectId) packArgs.push("--project-id", args.projectId);
  return JSON.parse(execFileSync(process.execPath, packArgs, { encoding: "utf8" }));
}

function findDecision(pack, decisionId) {
  return (pack.decisions ?? []).find((decision) => decision.id === decisionId);
}

function findOption(decision, optionId) {
  return (decision.options ?? []).find((option) => option.id === optionId);
}

function sanitizeId(input) {
  return input.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function baseRecordTarget(pack, decisionId) {
  return `gamespec/projects/${pack.projectId}/decisions/DECISION_${today()}_${sanitizeId(decisionId)}.md`;
}

function commonProofSteps(decision, option) {
  const steps = [];
  if (option.requiredProof) steps.push(...option.requiredProof);
  if (decision.proofGate) steps.push(...decision.proofGate);
  return Array.from(new Set(steps));
}

function proofGateSteps(decision) {
  return Array.from(new Set(decision.proofGate ?? []));
}

function buildDecisionSpecificPlan(pack, decision, option) {
  if (decision.id === "public_narrative_carrier") {
    return {
      planKind: "decision_sprint",
      projectUpdateCandidates: [
        {
          targetPath: baseRecordTarget(pack, decision.id),
          action: "create_candidate_decision_record",
          timing: "after_user_approval",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/active.md`,
          action: "record_public_narrative_carrier_sprint_or_result",
          timing: "after_user_approval_or_after_sprint_result",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/01-worldbuilding/CAST_001_主角阵容.ai.md`,
          action: "record_carrier_ownership_after_proof",
          timing: "after_proof_gate",
          projectTruth: true
        }
      ],
      proofSteps: [
        "Define the public narrative truth slice in one paragraph.",
        "Test whether anchored #3 or #4 can carry it without collapsing their existing truth slice.",
        "Test whether any remaining candidate can carry it without becoming decorative.",
        "Promote to protagonist only if every fold-in attempt weakens necessary player understanding.",
        ...proofGateSteps(decision)
      ],
      nextCommandHint: "After the user decides, create a project proposal before any target-project write."
    };
  }

  if (decision.id === "protagonist_roster_freeze") {
    return {
      planKind: "roster_freeze_plan",
      projectUpdateCandidates: [
        {
          targetPath: baseRecordTarget(pack, decision.id),
          action: "create_candidate_decision_record",
          timing: "after_user_approval",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/01-worldbuilding/CAST_001_主角阵容.ai.md`,
          action: "record_final_or_deliberately_variable_roster",
          timing: "after_irreducible_view_proof",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/active.md`,
          action: "clear_or_restate_roster_stability_condition",
          timing: "after_roster_decision",
          projectTruth: true
        }
      ],
      proofSteps: [
        "Keep #3 and #4 anchored unless new evidence explicitly overturns them.",
        "Run deletion test for every remaining candidate.",
        "Assign public narrative carrier before final count.",
        "Write SYS_001 recheck criteria before treating the roster as closed.",
        ...proofGateSteps(decision)
      ],
      nextCommandHint: "After proof closes, run a SYS_001 recheck plan before finalizing system docs."
    };
  }

  if (decision.id === "combat_reward_frame_for_level_thaw") {
    return {
      planKind: "minimum_interface_plan",
      projectUpdateCandidates: [
        {
          targetPath: baseRecordTarget(pack, decision.id),
          action: "create_candidate_decision_record",
          timing: "after_user_approval",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/02-system-design/SYS_COMBAT_REWARD_FRAME.ai.md`,
          action: "create_minimum_combat_reward_interface_brief",
          timing: "after_user_approval",
          projectTruth: true
        },
        {
          targetPath: `gamespec/projects/${pack.projectId}/05-level-design/LEVEL_001_边境宅邸脱身战.ai.md`,
          action: "do_not_consume_or_rewrite_until_thaw_conditions_pass",
          timing: "blocked_until_proof_gate",
          projectTruth: true
        }
      ],
      proofSteps: [
        "Name combat encounter inputs and outputs.",
        "Name reward categories and ownership.",
        "Name exploration-to-combat handoff boundaries.",
        "Check LEVEL_001 thaw conditions before consuming frozen sections.",
        ...proofGateSteps(decision)
      ],
      nextCommandHint: "Keep LEVEL_001 quarantined until the interface brief is accepted."
    };
  }

  return {
    planKind: "generic_decision_record_plan",
    projectUpdateCandidates: [
      {
        targetPath: baseRecordTarget(pack, decision.id),
        action: "create_candidate_decision_record",
        timing: "after_user_approval",
        projectTruth: true
      }
    ],
    proofSteps: commonProofSteps(decision, option),
    nextCommandHint: "Review proof gate before any project write."
  };
}

function buildRecordMarkdown(pack, decision, option, args, specificPlan) {
  const lines = [];
  lines.push("---");
  lines.push(`decision_id: ${decision.id}`);
  lines.push(`selected_option: ${option.id}`);
  lines.push("status: proposed");
  lines.push(`project: ${pack.projectId}`);
  lines.push(`created: ${today()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Decision Record: ${decision.title}`);
  lines.push("");
  lines.push(`Selected option: ${option.id} - ${option.name}`);
  lines.push("");
  lines.push(`Rationale: ${args.rationale ?? "TBD by producer"}`);
  lines.push("");
  lines.push("## Tradeoff");
  lines.push("");
  lines.push(option.tradeoff ?? "No tradeoff text provided.");
  lines.push("");
  lines.push("## Proof Gate");
  lines.push("");
  for (const step of specificPlan.proofSteps) lines.push(`- ${step}`);
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  for (const [key, value] of Object.entries(pack.sources ?? {})) {
    lines.push(`- ${key}: ${value ?? "missing"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildPlan(pack, args) {
  const decision = findDecision(pack, args.decision);
  if (!decision) {
    throw new Error(`Decision not found in pack: ${args.decision}`);
  }
  const option = findOption(decision, args.option);
  if (!option) {
    throw new Error(`Option ${args.option} not found for decision ${args.decision}`);
  }

  const specificPlan = buildDecisionSpecificPlan(pack, decision, option);
  const recordTarget = baseRecordTarget(pack, decision.id);
  return {
    generated: new Date().toISOString(),
    mode: "decision_record_plan_read_only",
    projectRoot: pack.projectRoot,
    projectId: pack.projectId,
    basedOnDecisionPackGenerated: pack.generated,
    selected: {
      decisionId: decision.id,
      decisionTitle: decision.title,
      optionId: option.id,
      optionName: option.name,
      optionTradeoff: option.tradeoff ?? null,
      matchesRecommendation: option.id === decision.recommendedOption,
      rationale: args.rationale ?? null
    },
    recordTarget,
    planKind: specificPlan.planKind,
    projectUpdateCandidates: specificPlan.projectUpdateCandidates,
    proofSteps: specificPlan.proofSteps,
    candidateRecordMarkdown: buildRecordMarkdown(pack, decision, option, args, specificPlan),
    writePolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      futureProjectWritesRequireUserApproval: true,
      futureProjectWritesRequireSeparateApplyStep: true,
      mayNameProjectTruthTargetsButDoesNotWriteThem: true
    },
    nextCommandHint: specificPlan.nextCommandHint,
    guardrails: [
      "This command does not write the target project.",
      "Decision record targets are planned future project-truth writes.",
      "No active.md, CAST_001, SYS_001, or LEVEL_001 changes occur in this slice.",
      "A selected option is not final until the user/project workflow approves it."
    ],
    sources: pack.sources
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Decision Record Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`Project root: \`${plan.projectRoot ?? "unknown"}\``);
  lines.push(`Project id: \`${plan.projectId ?? "unknown"}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Selected Option");
  lines.push("");
  lines.push(`- Decision: \`${plan.selected.decisionId}\` ${plan.selected.decisionTitle}`);
  lines.push(`- Option: \`${plan.selected.optionId}\` ${plan.selected.optionName}`);
  lines.push(`- Matches recommendation: ${plan.selected.matchesRecommendation}`);
  lines.push(`- Rationale: ${plan.selected.rationale ?? "TBD by producer"}`);
  lines.push(`- Tradeoff: ${plan.selected.optionTradeoff ?? "not provided"}`);
  lines.push("");

  lines.push("## Planned Record");
  lines.push("");
  lines.push(`- Target: \`${plan.recordTarget}\``);
  lines.push(`- Plan kind: \`${plan.planKind}\``);
  lines.push("- Physical writes now: false");
  lines.push("");

  lines.push("## Project Update Candidates");
  lines.push("");
  for (const candidate of plan.projectUpdateCandidates) {
    lines.push(`- \`${candidate.targetPath}\``);
    lines.push(`  - action: ${candidate.action}`);
    lines.push(`  - timing: ${candidate.timing}`);
    lines.push(`  - project truth: ${candidate.projectTruth}`);
  }
  lines.push("");

  lines.push("## Proof Steps");
  lines.push("");
  for (const step of plan.proofSteps) lines.push(`- ${step}`);
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
  const pack = readPack(args);
  const projectRoot = pack.projectRoot ? normalizePath(pack.projectRoot) : (args.project ? normalizePath(args.project) : null);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write decision record plan inside target project: ${outPath}`);
    }
  }

  const plan = buildPlan(pack, args);
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
  console.error(`gamespec-plan-decision-record: ${error.message}`);
  process.exit(1);
}
