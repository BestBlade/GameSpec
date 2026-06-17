#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec review document planner

Usage:
  node bin/gamespec-plan-review-document.js --recheck-plan <post-patch-recheck-plan.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Builds a candidate document-review artifact from a post-patch recheck plan.
  - Does not write project truth or create review files.
  - Does not assign a final review conclusion.
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
    if (arg === "--recheck-plan") {
      args.recheckPlan = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.recheckPlan) {
    console.error("Missing --recheck-plan <post-patch-recheck-plan.json>.");
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function validateRecheckPlan(plan) {
  if (plan.mode !== "post_patch_recheck_plan_read_only") {
    throw new Error(`Unsupported recheck plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.state) {
    throw new Error("Recheck plan must contain projectRoot, projectId, and state.");
  }
}

function reviewPlanState(recheckPlan) {
  if (recheckPlan.state === "blocked") return "blocked";
  if (!recheckPlan.activeDriverRecheck) return "no_review_needed";
  if (recheckPlan.state === "required_after_apply") return "review_required_now";
  if (recheckPlan.state === "would_require_after_apply") return "candidate_after_apply";
  return "no_review_needed";
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function dependencyIds(recheckPlan) {
  const ids = [
    recheckPlan.activeDriverRecheck?.targetId,
    ...((recheckPlan.reviewEvidence ?? []).slice(0, 4).map((item) => item.id)),
    ...((recheckPlan.touchedTargets ?? [])
      .map((item) => item.targetPath?.includes("/CAST_001_") ? "CAST_001" : null))
  ];
  return unique(ids);
}

function candidateReviewTarget(recheckPlan) {
  const targetId = recheckPlan.activeDriverRecheck?.targetId ?? "UNKNOWN";
  return `gamespec/projects/${recheckPlan.projectId}/reviews/REVIEW_${today()}_${targetId}_post_patch_recheck.ai.md`;
}

function renderCandidateReviewMarkdown(recheckPlan, state) {
  const active = recheckPlan.activeDriverRecheck;
  const reviewId = `REVIEW_${today()}_${active.targetId}_post_patch_recheck`;
  const deps = dependencyIds(recheckPlan);
  const lines = [];
  lines.push("---");
  lines.push(`title: ${active.targetId} post-patch document-review plan`);
  lines.push(`system_id: ${reviewId}`);
  lines.push("version: 0.1.0");
  lines.push("status: draft");
  lines.push("author: gamespec");
  lines.push("reviewer: game-规范审查");
  lines.push(`created: ${today()}`);
  lines.push("dependencies:");
  for (const dep of deps) lines.push(`  - ${dep}`);
  lines.push("review_mode: full");
  lines.push(`scope: post-patch recheck for ${active.targetId} after ${recheckPlan.sourcePatchPlan?.selected?.decisionId ?? "project patch"}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${active.targetId} Post-Patch Document Review Plan`);
  lines.push("");
  lines.push("**审查结论**: 待审查");
  lines.push("**计划状态**: " + (state === "review_required_now" ? "补丁已应用后需要立即复核" : "补丁应用后需要复核"));
  lines.push("**目标文档**: `" + active.targetPath + "`");
  lines.push("");
  lines.push("## 复核原因");
  lines.push("");
  lines.push(active.reason);
  lines.push("");
  lines.push("## 必答问题");
  lines.push("");
  for (const question of active.recheckQuestions ?? []) lines.push(`- ${question}`);
  lines.push("");
  lines.push("## 必读证据");
  lines.push("");
  if ((recheckPlan.reviewEvidence ?? []).length === 0) {
    lines.push("- 无可用 review evidence。");
  } else {
    for (const item of recheckPlan.reviewEvidence) {
      lines.push(`- \`${item.id}\`: ${item.title ?? ""} -> \`${item.path}\``);
    }
  }
  lines.push("");
  lines.push("## Hold Items");
  lines.push("");
  if ((recheckPlan.frozenOrQuarantined ?? []).length === 0) {
    lines.push("- 无。");
  } else {
    for (const item of recheckPlan.frozenOrQuarantined) {
      lines.push(`- \`${item.id}\` (${item.status}) -> \`${item.path}\``);
    }
  }
  lines.push("");
  lines.push("## 非动作");
  lines.push("");
  for (const item of active.mustNotDoBeforeRecheck ?? []) lines.push(`- ${item}`);
  lines.push("- 不在本评审计划中改写目标项目。");
  lines.push("- 不在本评审计划中给出通过/失败结论。");
  lines.push("");
  lines.push("## 产出要求");
  lines.push("");
  lines.push("- 明确 `SYS_001` 第 8 节是否仍成立。");
  lines.push("- 明确探索技能映射是否继续保持 deferred。");
  lines.push("- 明确 `REVIEW_034` 的有条件通过是否仍可保持。");
  lines.push("- 若需要重开 document-review，列出最小回写范围。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildReviewDocumentPlan(recheckPlan, recheckPlanPath) {
  validateRecheckPlan(recheckPlan);
  recheckPlan.projectRoot = normalizePath(recheckPlan.projectRoot);
  const state = reviewPlanState(recheckPlan);
  const blockedReasons = [];
  if (state === "blocked") blockedReasons.push("source_recheck_plan_blocked");
  if (state === "no_review_needed") blockedReasons.push("no_active_driver_recheck");

  const candidate = state === "candidate_after_apply" || state === "review_required_now"
    ? {
        targetPath: candidateReviewTarget(recheckPlan),
        action: "create_candidate_review_document",
        timing: state === "review_required_now" ? "now" : "after_patch_apply",
        projectTruth: true,
        physicalWritesNow: false,
        candidateReviewMarkdown: renderCandidateReviewMarkdown(recheckPlan, state)
      }
    : null;

  return {
    generated: new Date().toISOString(),
    mode: "review_document_plan_read_only",
    state,
    projectRoot: recheckPlan.projectRoot,
    projectId: recheckPlan.projectId,
    sourceRecheckPlan: {
      path: recheckPlanPath,
      state: recheckPlan.state,
      generated: recheckPlan.generated ?? null
    },
    activeDriverRecheck: recheckPlan.activeDriverRecheck ?? null,
    candidateReview: candidate,
    reviewEvidence: recheckPlan.reviewEvidence ?? [],
    frozenOrQuarantined: recheckPlan.frozenOrQuarantined ?? [],
    writePolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      futureReviewWriteRequiresUserApproval: true,
      futureReviewWriteRequiresSeparateApplyStep: true,
      doesNotAssignFinalConclusion: true
    },
    blockedReasons,
    guardrails: [
      "Read-only review document plan.",
      "Does not write the target project.",
      "Does not create review files.",
      "Does not promote SYS_001.",
      "Does not consume frozen or quarantined documents.",
      "Candidate review conclusion remains pending."
    ]
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Review Document Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`State: \`${plan.state}\``);
  lines.push(`Project root: \`${plan.projectRoot}\``);
  lines.push(`Project id: \`${plan.projectId}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Candidate Review");
  lines.push("");
  if (!plan.candidateReview) {
    lines.push("- None.");
    if (plan.blockedReasons.length > 0) lines.push(`- Blocked reasons: ${plan.blockedReasons.join(", ")}`);
  } else {
    lines.push(`- Target: \`${plan.candidateReview.targetPath}\``);
    lines.push(`- Timing: \`${plan.candidateReview.timing}\``);
    lines.push("- Physical writes now: false");
  }
  lines.push("");

  lines.push("## Review Evidence");
  lines.push("");
  if (plan.reviewEvidence.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of plan.reviewEvidence.slice(0, 5)) {
      lines.push(`- \`${item.id}\` -> \`${item.path}\``);
    }
  }
  lines.push("");

  if (plan.candidateReview) {
    lines.push("## Candidate Review Markdown");
    lines.push("");
    lines.push("```markdown");
    lines.push(plan.candidateReview.candidateReviewMarkdown.trimEnd());
    lines.push("```");
    lines.push("");
  }

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
  const recheckPlanPath = normalizePath(args.recheckPlan);
  const recheckPlan = JSON.parse(fs.readFileSync(recheckPlanPath, "utf8"));
  const projectRoot = normalizePath(recheckPlan.projectRoot ?? "");

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && fs.existsSync(projectRoot) && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write review document plan inside target project: ${outPath}`);
    }
  }

  const plan = buildReviewDocumentPlan(recheckPlan, recheckPlanPath);
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
  console.error(`gamespec-plan-review-document: ${error.message}`);
  process.exit(1);
}
