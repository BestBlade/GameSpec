#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec workflow-state update planner

Usage:
  node bin/gamespec-plan-workflow-state-update.js --review-execution <review-document-execution-report.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Builds a candidate active.md workflow-state update from review-document execution evidence.
  - Does not write project truth.
  - Does not mark a review as passed.
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
    if (arg === "--review-execution") {
      args.reviewExecution = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.reviewExecution) {
    console.error("Missing --review-execution <review-document-execution-report.json>.");
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

function fromPosix(posixPath) {
  return posixPath.split("/");
}

function today() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
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
    throw new Error(`Unsupported review execution mode: ${report.mode}`);
  }
  if (!report.projectRoot || !report.projectId || !report.operation || !report.statusCounts) {
    throw new Error("Review execution report must contain projectRoot, projectId, operation, and statusCounts.");
  }
  if (report.operation.op !== "write_review_document") {
    throw new Error(`Unsupported review execution operation: ${report.operation.op}`);
  }
}

function sourceState(report) {
  const status = report.operation?.status ?? "";
  const counts = report.statusCounts ?? {};
  if ((counts.blocked ?? 0) > 0 || status === "blocked") return "blocked";
  if (status === "already_current" || (counts.already_current ?? 0) > 0) return "required_after_review_write";
  if (report.mode === "write" && (status === "wrote" || (counts.wrote ?? 0) > 0)) {
    return "required_after_review_write";
  }
  if (report.mode === "dry_run" && (status === "would_write" || (counts.would_write ?? 0) > 0)) {
    return "would_update_after_review_write";
  }
  return "no_effect";
}

function activeTarget(projectId) {
  return `gamespec/projects/${projectId}/active.md`;
}

function reviewIdFromTarget(targetPath) {
  if (!targetPath) return null;
  return path.basename(targetPath).replace(/\.ai\.md$|\.md$/u, "");
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return null;
  return { lines, start: 0, end };
}

function yamlValue(value) {
  if (value == null) return "";
  if (/^".*"$/.test(value)) return value;
  if (/[:#\[\]{},&*!|>'"%@`]|^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function setFrontmatterValues(content, values) {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return {
      content,
      changed: false,
      issues: ["active_frontmatter_missing"]
    };
  }

  const lines = [...parsed.lines];
  const applied = [];
  const missing = new Map(Object.entries(values));

  for (let index = parsed.start + 1; index < parsed.end; index += 1) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const key = match[1];
    if (!missing.has(key)) continue;
    const nextLine = `${key}: ${yamlValue(missing.get(key))}`;
    if (lines[index] !== nextLine) {
      applied.push({ key, from: lines[index], to: nextLine });
      lines[index] = nextLine;
    }
    missing.delete(key);
  }

  for (const [key, value] of missing) {
    const nextLine = `${key}: ${yamlValue(value)}`;
    lines.splice(parsed.end, 0, nextLine);
    parsed.end += 1;
    applied.push({ key, from: null, to: nextLine });
  }

  return {
    content: lines.join("\n"),
    changed: applied.length > 0,
    applied,
    issues: []
  };
}

function insertNextStep(content, reviewId, targetId, existingContent = content) {
  const bullet = `- 执行 ${targetId} post-patch document-review：以 \`${reviewId}\` 为评审稿，复核补丁后的 §8 与探索技能映射 deferred 条件；未出结论前不提升为正式文档。`;
  if (existingContent.includes(reviewId)) {
    return {
      content,
      changed: false,
      bullet,
      reason: "review_id_already_present"
    };
  }

  const lines = content.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Next Step");
  if (heading < 0) {
    return {
      content,
      changed: false,
      bullet,
      reason: "next_step_heading_missing"
    };
  }

  const insertAt = heading + 1;
  lines.splice(insertAt, 0, bullet);
  return {
    content: lines.join("\n"),
    changed: true,
    bullet,
    insertAfter: "## Next Step"
  };
}

function simpleUnifiedDiff(targetPath, before, after) {
  if (before === after) return "";

  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = 3;
  const beforeStart = Math.max(0, prefix - context);
  const afterStart = Math.max(0, prefix - context);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + context);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + context);
  const beforeHunk = beforeLines.slice(beforeStart, beforeEnd);
  const afterHunk = afterLines.slice(afterStart, afterEnd);
  const lines = [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    `@@ -${beforeStart + 1},${beforeHunk.length} +${afterStart + 1},${afterHunk.length} @@`
  ];

  let i = 0;
  let j = 0;
  while (i < beforeHunk.length || j < afterHunk.length) {
    if (i < beforeHunk.length && j < afterHunk.length && beforeHunk[i] === afterHunk[j]) {
      lines.push(` ${beforeHunk[i]}`);
      i += 1;
      j += 1;
      continue;
    }
    if (i < beforeHunk.length && !afterHunk.slice(j).includes(beforeHunk[i])) {
      lines.push(`-${beforeHunk[i]}`);
      i += 1;
      continue;
    }
    if (j < afterHunk.length && !beforeHunk.slice(i).includes(afterHunk[j])) {
      lines.push(`+${afterHunk[j]}`);
      j += 1;
      continue;
    }
    if (i < beforeHunk.length) {
      lines.push(`-${beforeHunk[i]}`);
      i += 1;
    }
    if (j < afterHunk.length) {
      lines.push(`+${afterHunk[j]}`);
      j += 1;
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildCandidate(report, reviewPlan, state, activeAbs, activeRel) {
  const activeContent = fs.readFileSync(activeAbs, "utf8");
  const reviewId = reviewIdFromTarget(report.operation.targetPath);
  const targetId = reviewPlan?.data?.activeDriverRecheck?.targetId ?? "UNKNOWN";
  const targetDocument = reviewPlan?.data?.activeDriverRecheck?.targetPath ?? null;
  const timing = state === "required_after_review_write" ? "now" : "after_review_document_write";
  const currentSection = `${reviewId} 待执行：post-patch document-review`;
  const proposedFrontmatter = {
    current_workflow: "document-review",
    current_agent: "@game-规范审查",
    current_document: targetDocument ? `"${targetDocument}"` : undefined,
    current_section: `"${currentSection}"`,
    review_mode: "full",
    updated: today()
  };
  for (const key of Object.keys(proposedFrontmatter)) {
    if (proposedFrontmatter[key] === undefined) delete proposedFrontmatter[key];
  }

  const frontmatterResult = setFrontmatterValues(activeContent, proposedFrontmatter);
  const nextStepResult = insertNextStep(frontmatterResult.content, reviewId, targetId, activeContent);
  const plannedContent = nextStepResult.content;
  const operations = [];

  operations.push({
    op: "set_frontmatter_values",
    targetPath: activeRel,
    changed: frontmatterResult.changed,
    values: proposedFrontmatter,
    applied: frontmatterResult.applied ?? [],
    issues: frontmatterResult.issues ?? []
  });

  operations.push({
    op: "insert_next_step",
    targetPath: activeRel,
    changed: nextStepResult.changed,
    insertAfter: nextStepResult.insertAfter ?? null,
    bullet: nextStepResult.bullet,
    reason: nextStepResult.reason ?? null
  });

  return {
    targetPath: activeRel,
    targetAbs: activeAbs,
    baseSha256: sha256(activeContent),
    plannedSha256: sha256(plannedContent),
    physicalWritesNow: false,
    timing,
    reviewId,
    reviewArtifact: report.operation.targetPath,
    targetDocument,
    operations,
    unifiedDiff: simpleUnifiedDiff(activeRel, activeContent, plannedContent)
  };
}

function buildPlan(report, executionPath) {
  validateExecution(report);
  const projectRoot = normalizePath(report.projectRoot);
  const stateFromSource = sourceState(report);
  const reviewPlan = readJsonIfExists(report.sourcePlan);
  const activeRel = activeTarget(report.projectId);
  const activeAbs = normalizePath(path.join(projectRoot, ...fromPosix(activeRel)));
  const blockedReasons = [];

  let state = stateFromSource;
  let candidateUpdate = null;

  if (stateFromSource === "blocked") {
    blockedReasons.push("source_review_execution_blocked");
  } else if (stateFromSource !== "no_effect") {
    if (!fs.existsSync(projectRoot)) {
      state = "blocked";
      blockedReasons.push("project_root_missing");
    } else if (!isPathInside(activeAbs, projectRoot)) {
      state = "blocked";
      blockedReasons.push("active_target_outside_project");
    } else if (!fs.existsSync(activeAbs)) {
      state = "blocked";
      blockedReasons.push("active_md_missing");
    } else {
      candidateUpdate = buildCandidate(report, reviewPlan, stateFromSource, activeAbs, activeRel);
      const operationIssues = candidateUpdate.operations.flatMap((operation) => operation.issues ?? []);
      if (operationIssues.length > 0) {
        state = "blocked";
        blockedReasons.push(...operationIssues);
        candidateUpdate = null;
      }
    }
  }

  return {
    generated: new Date().toISOString(),
    mode: "workflow_state_update_plan_read_only",
    state,
    projectRoot,
    projectId: report.projectId,
    sourceExecution: {
      path: executionPath,
      mode: report.mode,
      state: report.state ?? null,
      statusCounts: report.statusCounts,
      operation: {
        targetPath: report.operation.targetPath ?? null,
        status: report.operation.status,
        issues: report.operation.issues ?? []
      }
    },
    sourceReviewPlan: reviewPlan
      ? {
          path: reviewPlan.path,
          state: reviewPlan.data.state ?? null,
          activeDriverRecheck: reviewPlan.data.activeDriverRecheck ?? null,
          candidateReview: reviewPlan.data.candidateReview
            ? {
                targetPath: reviewPlan.data.candidateReview.targetPath,
                timing: reviewPlan.data.candidateReview.timing
              }
            : null
        }
      : null,
    activeTarget: {
      path: activeRel,
      absPath: activeAbs,
      exists: fs.existsSync(activeAbs)
    },
    candidateUpdate,
    blockedReasons,
    writePolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      futureActiveWriteRequiresSeparateExecutor: true,
      doesNotAssignReviewConclusion: true,
      doesNotPromoteReviewedDocument: true
    },
    guardrails: [
      "Read-only workflow-state update plan.",
      "Does not write the target project.",
      "Does not write active.md.",
      "Does not mark document-review as passed.",
      "Does not promote SYS_001.",
      "Does not consume frozen or quarantined hold items."
    ]
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Workflow-State Update Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`State: \`${plan.state}\``);
  lines.push(`Project root: \`${plan.projectRoot}\``);
  lines.push(`Project id: \`${plan.projectId}\``);
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");

  lines.push("## Source Review Execution");
  lines.push("");
  lines.push(`- Source: \`${plan.sourceExecution.path}\``);
  lines.push(`- Mode: \`${plan.sourceExecution.mode}\``);
  lines.push(`- Operation target: \`${plan.sourceExecution.operation.targetPath ?? "missing"}\``);
  lines.push(`- Operation status: \`${plan.sourceExecution.operation.status}\``);
  if (plan.sourceExecution.operation.issues.length > 0) {
    lines.push(`- Issues: ${plan.sourceExecution.operation.issues.join(", ")}`);
  }
  lines.push("");

  lines.push("## Candidate Active Update");
  lines.push("");
  if (!plan.candidateUpdate) {
    lines.push("- None.");
  } else {
    const candidate = plan.candidateUpdate;
    lines.push(`- Target: \`${candidate.targetPath}\``);
    lines.push(`- Timing: \`${candidate.timing}\``);
    lines.push(`- Review id: \`${candidate.reviewId}\``);
    lines.push(`- Review artifact: \`${candidate.reviewArtifact}\``);
    lines.push(`- Target document: \`${candidate.targetDocument ?? "unknown"}\``);
    lines.push(`- Base sha256: \`${candidate.baseSha256}\``);
    lines.push("");
    lines.push("Operations:");
    for (const operation of candidate.operations) {
      lines.push(`- \`${operation.op}\` changed: \`${operation.changed}\``);
    }
    lines.push("");
    lines.push("```diff");
    lines.push(candidate.unifiedDiff.trimEnd());
    lines.push("```");
  }
  lines.push("");

  if (plan.blockedReasons.length > 0) {
    lines.push("## Blocked Reasons");
    lines.push("");
    for (const reason of plan.blockedReasons) lines.push(`- ${reason}`);
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
  const executionPath = normalizePath(args.reviewExecution);
  const report = JSON.parse(fs.readFileSync(executionPath, "utf8"));
  const projectRoot = normalizePath(report.projectRoot ?? "");

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && fs.existsSync(projectRoot) && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write workflow-state update plan inside target project: ${outPath}`);
    }
  }

  const plan = buildPlan(report, executionPath);
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
  console.error(`gamespec-plan-workflow-state-update: ${error.message}`);
  process.exit(1);
}
