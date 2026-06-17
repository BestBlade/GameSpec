#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec post-patch recheck planner

Usage:
  node bin/gamespec-plan-post-patch-recheck.js --patch-execution <project-patch-execution-report.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Builds a post-patch recheck plan from patch execution and impact evidence.
  - Does not edit project truth or create review files.
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
    if (arg === "--patch-execution") {
      args.patchExecution = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.patchExecution) {
    console.error("Missing --patch-execution <project-patch-execution-report.json>.");
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

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  const absPath = normalizePath(filePath);
  if (!fs.existsSync(absPath)) return null;
  return {
    path: absPath,
    data: JSON.parse(fs.readFileSync(absPath, "utf8"))
  };
}

function validateExecution(report) {
  if (!["dry_run", "write"].includes(report.mode)) {
    throw new Error(`Unsupported patch execution mode: ${report.mode}`);
  }
  if (!report.projectRoot || !report.projectId || !report.sourcePlan || !Array.isArray(report.operations)) {
    throw new Error("Patch execution report must contain projectRoot, projectId, sourcePlan, and operations.");
  }
}

function resolveSourcePatchPlan(executionReport) {
  return readJsonIfExists(executionReport.sourcePlan);
}

function resolveSourceUpdatePlan(patchPlan) {
  const updatePath = patchPlan?.data?.source?.updatePlanPath;
  if (!updatePath || updatePath === "fixture-derived-from-020-project-patch-plan") return null;
  return readJsonIfExists(updatePath);
}

function executionState(report) {
  if ((report.statusCounts?.blocked ?? 0) > 0) return "blocked";
  if (report.mode === "write") {
    if ((report.statusCounts?.applied ?? 0) > 0 || (report.statusCounts?.already_current ?? 0) > 0) {
      return "required_after_apply";
    }
    return "no_effect";
  }
  if ((report.statusCounts?.would_apply ?? 0) > 0 || (report.statusCounts?.already_current ?? 0) > 0) {
    return "would_require_after_apply";
  }
  return "no_effect";
}

function touchedTargets(report) {
  return (report.operations ?? []).map((operation) => ({
    id: operation.id,
    targetPath: operation.targetPath,
    status: operation.status,
    issues: operation.issues ?? []
  }));
}

function activeDriverPlan(state, updatePlan) {
  const impact = updatePlan?.data?.impact ?? null;
  const active = impact?.active ?? null;
  if (!active || active.impactClass !== "active_driver_recheck") return null;

  return {
    id: `${active.id.toLowerCase()}_active_driver_recheck`,
    targetId: active.id,
    targetPath: active.path,
    workflow: active.workflow,
    state,
    priority: state === "required_after_apply" ? "now" : "after_apply",
    reason: "The patch changes or plans to change CAST_001, which the active driver depends on.",
    recheckQuestions: [
      "Does SYS_001 section 8 still hold after the accepted CAST_001 proof-sprint content?",
      "Does the exploration skill mapping remain intentionally deferred until roster/carrier ownership closes?",
      "Does REVIEW_034 remain a conditional pass, or should document-review reopen?",
      "Does the public narrative carrier sprint introduce any new skill-interface expectations?"
    ],
    mustNotDoBeforeRecheck: [
      "Do not promote SYS_001 to final .md.",
      "Do not restore a concrete skill-to-character table as final truth.",
      "Do not consume LEVEL_001 as active truth."
    ]
  };
}

function relevantReviewEvidence(updatePlan) {
  const reviewEvidence = updatePlan?.data?.impact?.reviewEvidence ?? [];
  const preferred = ["REVIEW_034", "REVIEW_033", "REVIEW_026"];
  const selected = [];
  for (const id of preferred) {
    const match = reviewEvidence.find((item) => item.id === id);
    if (match) selected.push(match);
  }
  for (const item of reviewEvidence) {
    if (!selected.some((existing) => existing.id === item.id)) selected.push(item);
  }
  return selected;
}

function buildRecheckPlan(report, executionPath) {
  validateExecution(report);
  const projectRoot = normalizePath(report.projectRoot);
  const sourcePatchPlan = resolveSourcePatchPlan(report);
  const sourceUpdatePlan = resolveSourceUpdatePlan(sourcePatchPlan);
  const state = executionState(report);
  const activeDriver = activeDriverPlan(state, sourceUpdatePlan);
  const impact = sourceUpdatePlan?.data?.impact ?? null;
  const touched = touchedTargets(report);

  return {
    generated: new Date().toISOString(),
    mode: "post_patch_recheck_plan_read_only",
    state,
    projectRoot,
    projectId: report.projectId,
    sourceExecution: {
      path: executionPath,
      mode: report.mode,
      statusCounts: report.statusCounts ?? {}
    },
    sourcePatchPlan: sourcePatchPlan
      ? {
          path: sourcePatchPlan.path,
          mode: sourcePatchPlan.data.mode,
          selected: sourcePatchPlan.data.selected ?? null
        }
      : null,
    sourceUpdatePlan: sourceUpdatePlan
      ? {
          path: sourceUpdatePlan.path,
          mode: sourceUpdatePlan.data.mode,
          impactGenerated: sourceUpdatePlan.data.source?.impactGenerated ?? null
        }
      : null,
    touchedTargets: touched,
    activeDriverRecheck: activeDriver,
    recheckCandidates: impact?.recheckCandidates ?? [],
    reviewEvidence: relevantReviewEvidence(sourceUpdatePlan),
    frozenOrQuarantined: impact?.frozenOrQuarantined ?? [],
    nextActions: buildNextActions(state, activeDriver, sourceUpdatePlan),
    guardrails: [
      "Read-only post-patch recheck plan.",
      "Does not edit project truth.",
      "Does not create review files.",
      "Frozen or quarantined downstream documents remain hold items.",
      "A dry-run patch execution only creates a conditional future recheck plan."
    ]
  };
}

function buildNextActions(state, activeDriver, sourceUpdatePlan) {
  if (state === "blocked") {
    return [
      {
        id: "resolve_blocked_patch_execution",
        when: "before any recheck",
        action: "Fix blocked patch execution operations and rerun the patch executor dry-run."
      }
    ];
  }
  if (!activeDriver) {
    return [
      {
        id: "no_active_driver_recheck_detected",
        when: "now",
        action: "No active-driver recheck was found in available impact evidence."
      }
    ];
  }

  const prefix = state === "required_after_apply" ? "now" : "after the patch is applied";
  const updatePath = sourceUpdatePlan?.path ?? "<project-update-plan.json>";
  return [
    {
      id: "review_prior_evidence",
      when: prefix,
      action: "Read REVIEW_034 and REVIEW_033 before changing SYS_001 state."
    },
    {
      id: "run_fresh_impact",
      when: prefix,
      action: `Run gamespec-impact again from the accepted decision/update context. Source update plan: ${updatePath}`
    },
    {
      id: "plan_sys_001_document_review",
      when: prefix,
      action: "Create a SYS_001 document-review plan focused on section 8 and exploration skill mapping assumptions."
    },
    {
      id: "keep_holds_parked",
      when: "until recheck passes",
      action: "Keep LEVEL_001, EXPL_001, and NARR_003 parked as hold items."
    }
  ];
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Post-Patch Recheck Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`State: \`${plan.state}\``);
  lines.push(`Project root: \`${plan.projectRoot}\``);
  lines.push(`Project id: \`${plan.projectId}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Patch Execution");
  lines.push("");
  lines.push(`- Source: \`${plan.sourceExecution.path}\``);
  lines.push(`- Mode: \`${plan.sourceExecution.mode}\``);
  lines.push(`- Status counts: \`${JSON.stringify(plan.sourceExecution.statusCounts)}\``);
  lines.push("");

  lines.push("## Active Driver Recheck");
  lines.push("");
  if (!plan.activeDriverRecheck) {
    lines.push("- None detected from available impact evidence.");
  } else {
    const item = plan.activeDriverRecheck;
    lines.push(`- Gate: \`${item.id}\``);
    lines.push(`- Target: \`${item.targetId}\` -> \`${item.targetPath}\``);
    lines.push(`- Priority: \`${item.priority}\``);
    lines.push(`- Reason: ${item.reason}`);
    lines.push("");
    lines.push("Questions:");
    for (const question of item.recheckQuestions) lines.push(`- ${question}`);
    lines.push("");
    lines.push("Must not do before recheck:");
    for (const guardrail of item.mustNotDoBeforeRecheck) lines.push(`- ${guardrail}`);
  }
  lines.push("");

  lines.push("## Review Evidence");
  lines.push("");
  if (plan.reviewEvidence.length === 0) {
    lines.push("- None available.");
  } else {
    for (const item of plan.reviewEvidence) {
      lines.push(`- \`${item.id}\` -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Frozen Or Quarantined Holds");
  lines.push("");
  if (plan.frozenOrQuarantined.length === 0) {
    lines.push("- None available.");
  } else {
    for (const item of plan.frozenOrQuarantined) {
      lines.push(`- \`${item.id}\` (${item.status}) -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Next Actions");
  lines.push("");
  for (const action of plan.nextActions) {
    lines.push(`- \`${action.id}\` (${action.when})`);
    lines.push(`  - ${action.action}`);
  }
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
  const executionPath = normalizePath(args.patchExecution);
  const report = JSON.parse(fs.readFileSync(executionPath, "utf8"));
  const projectRoot = normalizePath(report.projectRoot ?? "");

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && fs.existsSync(projectRoot) && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write post-patch recheck plan inside target project: ${outPath}`);
    }
  }

  const plan = buildRecheckPlan(report, executionPath);
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
  console.error(`gamespec-plan-post-patch-recheck: ${error.message}`);
  process.exit(1);
}
