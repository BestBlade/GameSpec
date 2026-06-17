#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec project patch planner

Usage:
  node bin/gamespec-plan-project-patch.js --update-plan <project-update-plan.json> [--out <path>] [--format markdown|json]

Rules:
  - Read-only for the target project.
  - Generates reviewable unified diff proposals.
  - Does not apply patches or create decision records.
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
    if (arg === "--update-plan") {
      args.updatePlan = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.updatePlan) {
    console.error("Missing --update-plan <project-update-plan.json>.");
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

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateUpdatePlan(plan) {
  if (plan.mode !== "project_update_plan_read_only") {
    throw new Error(`Unsupported update plan mode: ${plan.mode}`);
  }
  if (!plan.projectRoot || !plan.projectId || !plan.selected) {
    throw new Error("Update plan must contain projectRoot, projectId, and selected decision.");
  }
  if (plan.writePolicy?.physicalWritesNow !== false) {
    throw new Error("Update plan must be read-only with physicalWritesNow: false.");
  }
  if (plan.selected.decisionId !== "public_narrative_carrier" || plan.selected.optionId !== "B") {
    throw new Error(`Unsupported decision/option for patch planning: ${plan.selected.decisionId}/${plan.selected.optionId}`);
  }
  if (plan.planKind !== "decision_sprint") {
    throw new Error(`Unsupported plan kind for patch planning: ${plan.planKind}`);
  }
}

function projectAbsPath(projectRoot, posixPath) {
  const target = path.join(projectRoot, ...fromPosix(posixPath));
  const normalized = normalizePath(target);
  if (!isPathInside(normalized, projectRoot)) {
    throw new Error(`Target path escapes project root: ${posixPath}`);
  }
  return normalized;
}

function readCandidateFile(projectRoot, targetPath) {
  const absPath = projectAbsPath(projectRoot, targetPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Candidate file does not exist: ${absPath}`);
  }
  const text = fs.readFileSync(absPath, "utf8");
  return {
    targetPath,
    absPath,
    text,
    sha256: sha256(text),
    lines: text.split(/\r?\n/)
  };
}

function hasLineContaining(lines, needle) {
  return lines.some((line) => line.includes(needle));
}

function findHeadingRange(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function findFirstLineInRange(lines, range, predicate) {
  if (!range) return -1;
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (predicate(lines[i], i)) return i;
  }
  return -1;
}

function diffForInsertion(targetPath, lines, insertAt, insertedLines, context = 3) {
  const beforeStart = Math.max(0, insertAt - context);
  const afterEnd = Math.min(lines.length, insertAt + context);
  const oldCount = afterEnd - beforeStart;
  const newCount = oldCount + insertedLines.length;
  const oldStart = beforeStart + 1;
  const newStart = beforeStart + 1;
  const hunk = [];
  hunk.push(`--- a/${targetPath}`);
  hunk.push(`+++ b/${targetPath}`);
  hunk.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
  for (let i = beforeStart; i < insertAt; i += 1) hunk.push(` ${lines[i]}`);
  for (const line of insertedLines) hunk.push(`+${line}`);
  for (let i = insertAt; i < afterEnd; i += 1) hunk.push(` ${lines[i]}`);
  return `${hunk.join("\n")}\n`;
}

function buildInsertOperation({ file, opId, anchor, insertAt, insertedLines, reason, guardrails }) {
  const alreadyPresent = insertedLines
    .filter((line) => line.trim())
    .every((line) => hasLineContaining(file.lines, line.trim()));
  const status = alreadyPresent ? "already_present" : "planned";
  return {
    id: opId,
    targetPath: file.targetPath,
    absPath: file.absPath,
    action: "insert_text",
    status,
    reason,
    anchor,
    baseSha256: file.sha256,
    line: insertAt + 1,
    insertedLines,
    unifiedDiff: status === "planned" ? diffForInsertion(file.targetPath, file.lines, insertAt, insertedLines) : null,
    guardrails
  };
}

function activePatchOperation(file) {
  const range = findHeadingRange(file.lines, "## Next Step");
  if (!range) {
    return {
      id: "active_public_narrative_sprint_next_step",
      targetPath: file.targetPath,
      absPath: file.absPath,
      action: "insert_text",
      status: "blocked",
      reason: "Could not find ## Next Step section.",
      anchor: { heading: "## Next Step" },
      baseSha256: file.sha256,
      line: null,
      insertedLines: [],
      unifiedDiff: null,
      guardrails: ["No patch can be applied without an anchor."]
    };
  }
  const firstBullet = findFirstLineInRange(file.lines, range, (line) => line.trim().startsWith("- "));
  const insertAt = firstBullet === -1 ? range.start + 1 : firstBullet + 1;
  const insertedLines = [
    "- 启动公共叙事传播端承载归属 sprint：先定义公共叙事真相切片，再测试 #3/#4 与其余候选是否可承载；仅当所有并入方案都会削弱必要的玩家理解时，才提升为独立主角。"
  ];
  return buildInsertOperation({
    file,
    opId: "active_public_narrative_sprint_next_step",
    anchor: {
      heading: "## Next Step",
      insertAfter: firstBullet === -1 ? "heading" : file.lines[firstBullet]
    },
    insertAt,
    insertedLines,
    reason: "Make the public narrative carrier proof sprint visible in the active project control surface without freezing the outcome.",
    guardrails: [
      "Does not change current workflow.",
      "Does not freeze protagonist count.",
      "Does not mark SYS_001 final."
    ]
  });
}

function castPatchOperation(file) {
  const range = findHeadingRange(file.lines, "## 6. 阵容验证清单");
  if (!range) {
    return {
      id: "cast_public_narrative_carrier_sprint_section",
      targetPath: file.targetPath,
      absPath: file.absPath,
      action: "insert_text",
      status: "blocked",
      reason: "Could not find ## 6. 阵容验证清单 section.",
      anchor: { heading: "## 6. 阵容验证清单" },
      baseSha256: file.sha256,
      line: null,
      insertedLines: [],
      unifiedDiff: null,
      guardrails: ["No patch can be applied without an anchor."]
    };
  }
  const separatorAfterSection = findFirstLineInRange(file.lines, range, (line) => line.trim() === "---");
  const insertAt = separatorAfterSection === -1 ? range.end : separatorAfterSection;
  const insertedLines = [
    "",
    "## 7. 公共叙事传播端承载归属 Sprint（候选）",
    "",
    "> 状态：候选补丁。仅在制作人批准 `public_narrative_carrier` option B 并完成 decision record 后写入；本节用于验证“公共叙事传播端”是否需要独立主角承载，不冻结主角总数。",
    "",
    "### 7.1 待定义真相切片",
    "",
    "公共叙事传播端指民间讲述、常识生产与“普通人如何知道这件事”的传播路径。正式冻结前，必须先用一段话定义它让玩家理解的不可替代真相。",
    "",
    "### 7.2 承载归属测试",
    "",
    "- 先测试 #3（义贼）能否通过废弃物视角与民间流通自然承载该切片。",
    "- 再测试 #4（巡回维修师）能否通过下层客户网络与技术常识传播自然承载该切片。",
    "- 再测试其余候选是否能承载该切片且不变成装饰性角色。",
    "- 仅当所有并入方案都会削弱必要的玩家理解时，才把它提升为独立主角。",
    "",
    "### 7.3 通过/失败标准",
    "",
    "- 通过并入：承载角色的独占真相切面仍然清楚，表层故事不被公共叙事功能吞没。",
    "- 通过独立：公共叙事传播端拥有不可替代真相切片、公共动词、章节引擎，并能通过删除测试。",
    "- 失败：该切片只是“信息转述”或世界观说明，不产生可玩的场景、冲突或选择。",
    ""
  ];
  return buildInsertOperation({
    file,
    opId: "cast_public_narrative_carrier_sprint_section",
    anchor: {
      heading: "## 6. 阵容验证清单",
      insertBefore: separatorAfterSection === -1 ? "next_section_or_eof" : "---"
    },
    insertAt,
    insertedLines,
    reason: "Add a proof-sprint section to CAST_001 without recording a final carrier decision.",
    guardrails: [
      "Does not freeze protagonist count.",
      "Does not create an independent protagonist by conclusion.",
      "Does not consume frozen NARR_003 as active truth.",
      "Requires producer approval and decision record before any future apply step."
    ]
  });
}

function findCandidate(updatePlan, suffixOrPath) {
  return (updatePlan.candidateProjectTruthUpdates ?? [])
    .find((candidate) => candidate.targetPath === suffixOrPath || candidate.targetPath.endsWith(suffixOrPath));
}

function buildPatchPlan(updatePlan, updatePlanPath) {
  validateUpdatePlan(updatePlan);
  const projectRoot = normalizePath(updatePlan.projectRoot);
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }

  const activeCandidate = findCandidate(updatePlan, `gamespec/projects/${updatePlan.projectId}/active.md`);
  const castCandidate = (updatePlan.candidateProjectTruthUpdates ?? [])
    .find((candidate) => candidate.targetPath.includes("/CAST_001_"));
  if (!activeCandidate) throw new Error("Update plan has no active.md candidate.");
  if (!castCandidate) throw new Error("Update plan has no CAST_001 candidate.");

  const activeFile = readCandidateFile(projectRoot, activeCandidate.targetPath);
  const castFile = readCandidateFile(projectRoot, castCandidate.targetPath);
  const operations = [
    activePatchOperation(activeFile),
    castPatchOperation(castFile)
  ];

  const blocked = operations.filter((operation) => operation.status === "blocked");
  return {
    generated: new Date().toISOString(),
    mode: "project_patch_plan_read_only",
    projectRoot,
    projectId: updatePlan.projectId,
    source: {
      updatePlanPath,
      updatePlanGenerated: updatePlan.generated ?? null,
      updatePlanMode: updatePlan.mode
    },
    selected: updatePlan.selected,
    planKind: updatePlan.planKind,
    summary: {
      operations: operations.length,
      planned: operations.filter((operation) => operation.status === "planned").length,
      alreadyPresent: operations.filter((operation) => operation.status === "already_present").length,
      blocked: blocked.length,
      physicalWritesNow: false
    },
    operations,
    applyPolicy: {
      physicalWritesNow: false,
      outputReportOnly: true,
      futureApplyRequiresUserApproval: true,
      futureApplyRequiresBaseSha256Match: true,
      futureApplyRequiresDecisionRecordOrWaiver: true,
      futureApplyMustStayWithinCandidateTargets: true
    },
    guardrails: [
      "This command does not write the target project.",
      "Generated patches are proposals, not applied changes.",
      "The public narrative carrier remains undecided.",
      "Protagonist count remains unfrozen.",
      "SYS_001 must be rechecked after any accepted CAST_001 change.",
      "Frozen or quarantined downstream documents remain hold items."
    ],
    blockedReasons: blocked.map((operation) => ({ id: operation.id, reason: operation.reason }))
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Project Patch Plan");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Selected Decision");
  lines.push("");
  lines.push(`- Decision: \`${report.selected?.decisionId ?? "unknown"}\` ${report.selected?.decisionTitle ?? ""}`);
  lines.push(`- Option: \`${report.selected?.optionId ?? "unknown"}\` ${report.selected?.optionName ?? ""}`);
  lines.push(`- Plan kind: \`${report.planKind ?? "unknown"}\``);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Operations: ${report.summary.operations}`);
  lines.push(`- Planned: ${report.summary.planned}`);
  lines.push(`- Already present: ${report.summary.alreadyPresent}`);
  lines.push(`- Blocked: ${report.summary.blocked}`);
  lines.push(`- Physical writes now: ${report.summary.physicalWritesNow}`);
  lines.push("");

  lines.push("## Operations");
  lines.push("");
  for (const operation of report.operations) {
    lines.push(`### ${operation.id}`);
    lines.push("");
    lines.push(`- Target: \`${operation.targetPath}\``);
    lines.push(`- Status: \`${operation.status}\``);
    lines.push(`- Line: ${operation.line ?? "unknown"}`);
    lines.push(`- Base sha256: \`${operation.baseSha256}\``);
    lines.push(`- Reason: ${operation.reason}`);
    lines.push("");
    if (operation.unifiedDiff) {
      lines.push("```diff");
      lines.push(operation.unifiedDiff.trimEnd());
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## Apply Policy");
  lines.push("");
  for (const [key, value] of Object.entries(report.applyPolicy)) {
    lines.push(`- ${key}: ${value}`);
  }
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
  const updatePlanPath = normalizePath(args.updatePlan);
  const updatePlan = readJson(updatePlanPath);
  const projectRoot = normalizePath(updatePlan.projectRoot ?? "");

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && fs.existsSync(projectRoot) && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write project patch plan inside target project: ${outPath}`);
    }
  }

  const report = buildPatchPlan(updatePlan, updatePlanPath);
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
  console.error(`gamespec-plan-project-patch: ${error.message}`);
  process.exit(1);
}
