#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec project status console

Usage:
  node bin/gamespec-status.js --project <project-root> [--project-id <id>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Reads project truth; never writes to it.
  - Refuses to write reports inside the target project.
  - Reports driver, parked, quarantined, attention, and next safe action.
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
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.project) {
    console.error("Missing --project <project-root>.");
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

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function fromPosix(posixPath) {
  return posixPath.split("/");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const yaml = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  return { data: parseYamlLike(yaml), body };
}

function parseYamlLike(text) {
  const data = {};
  let currentListKey = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      data[currentListKey].push(stripQuotes(listMatch[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2] ?? "";
    if (value === "") {
      data[key] = [];
      currentListKey = key;
    } else {
      data[key] = stripQuotes(value);
      currentListKey = null;
    }
  }
  return data;
}

function parseStateYaml(text) {
  const root = {};
  const phases = [];
  let currentPhase = null;
  let inPhases = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "phases:") {
      inPhases = true;
      continue;
    }

    if (inPhases) {
      const idMatch = trimmed.match(/^-\s+id:\s+(.+)$/);
      if (idMatch) {
        currentPhase = { id: stripQuotes(idMatch[1]) };
        phases.push(currentPhase);
        continue;
      }
      const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
      if (kv && currentPhase && ["name", "status", "started", "completed"].includes(kv[1])) {
        currentPhase[kv[1]] = stripQuotes(kv[2]);
      }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (kv) root[kv[1]] = stripQuotes(kv[2]);
  }

  return { ...root, phases };
}

function parseSections(markdown) {
  const sections = {};
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  return sections;
}

function extractBullets(lines) {
  const bullets = [];
  for (const line of lines ?? []) {
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files.sort();
}

function resolveGameDir(projectRoot, projectId) {
  const projectsRoot = path.join(projectRoot, "gamespec", "projects");
  if (!fs.existsSync(projectsRoot)) {
    throw new Error(`Missing gamespec/projects directory: ${projectsRoot}`);
  }

  if (projectId) {
    const gameDir = path.join(projectsRoot, projectId);
    if (!fs.existsSync(path.join(gameDir, "active.md"))) {
      throw new Error(`Project id has no active.md: ${projectId}`);
    }
    return { projectId, gameDir };
  }

  const candidates = fs.readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => ({ projectId: entry.name, gameDir: path.join(projectsRoot, entry.name) }))
    .filter((entry) => fs.existsSync(path.join(entry.gameDir, "active.md")));

  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one active GameSpec project, found ${candidates.length}. Use --project-id.`);
  }
  return candidates[0];
}

function findReviewFile(gameDir, reviewId) {
  if (!reviewId) return null;
  const reviewsRoot = path.join(gameDir, "reviews");
  return walkFiles(reviewsRoot).find((file) => path.basename(file).includes(reviewId)) ?? null;
}

function firstLineMatch(text, patterns) {
  for (const line of text.split(/\r?\n/)) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return (match[1] ?? match[2] ?? line).trim();
    }
  }
  return null;
}

function readOptionalFrontmatter(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { exists: false, data: {}, body: "" };
  const parsed = parseFrontmatter(readUtf8(filePath));
  return { exists: true, ...parsed };
}

function detectParked(activeBullets) {
  const parked = [];
  const joined = activeBullets.join("\n");
  if (joined.includes("NARR_003") && joined.includes("历史参考")) {
    parked.push({
      id: "NARR_003",
      state: "frozen_historical_reference",
      reason: "active.md marks NARR_003 as frozen historical reference"
    });
  }
  if (joined.includes("EXPL_001") && joined.includes("历史参考")) {
    parked.push({
      id: "EXPL_001",
      state: "frozen_historical_reference",
      reason: "active.md marks EXPL_001 as frozen historical reference"
    });
  }
  if (joined.includes("NARR_001") && joined.includes("narrative-only sketch")) {
    parked.push({
      id: "NARR_001 §六 Boss 战设计",
      state: "downgraded_to_narrative_only_sketch",
      reason: "active.md says this section is no longer an active production driver"
    });
  }
  return parked;
}

function detectQuarantined(gameDir, activeBullets) {
  const quarantined = [];
  const joined = activeBullets.join("\n");
  if (joined.includes("LEVEL_001") && joined.includes("quarantined")) {
    const relPath = "05-level-design/LEVEL_001_边境宅邸脱身战.ai.md";
    const absPath = path.join(gameDir, ...fromPosix(relPath));
    const parsed = readOptionalFrontmatter(absPath);
    quarantined.push({
      id: "LEVEL_001",
      path: relPath,
      status: parsed.data.status ?? "unknown",
      state: "quarantined_draft",
      consumeNow: false,
      thawConditions: [
        "主角#3 身份冻结",
        "探索技能映射冻结",
        "章节结构冻结",
        "战斗/奖励框架冻结"
      ],
      reason: "active.md says LEVEL_001 is a quarantined draft and should not be consumed in the current phase"
    });
  }
  return quarantined;
}

function detectAttention(activeSections, archaeologyText, reviewText) {
  const attention = [];
  const activeText = Object.values(activeSections).flat().join("\n");
  const combined = `${activeText}\n${archaeologyText}\n${reviewText}`;

  if (combined.includes("主角数量尚未冻结") || combined.includes("主角总数未冻结")) {
    attention.push({
      id: "freeze_protagonist_count",
      severity: "high",
      title: "Freeze protagonist count",
      reason: "Blocks SYS_001 finalization, chapter planning, and stable role-to-skill mapping"
    });
  }

  if (combined.includes("公共叙事传播端")) {
    attention.push({
      id: "decide_public_narrative_carrier",
      severity: "high",
      title: "Decide whether public narrative propagation needs its own protagonist",
      reason: "Affects roster closure and CAST_001 design coverage"
    });
  }

  if (combined.includes("战斗框架未冻结") || combined.includes("战斗/奖励框架冻结")) {
    attention.push({
      id: "freeze_combat_reward_frame",
      severity: "medium",
      title: "Freeze combat/reward frame before level thaw",
      reason: "LEVEL_001 explicitly depends on combat and reward frame closure"
    });
  }

  if (combined.includes("SYS_001") && combined.includes("重新进入 `workflow: document-review`")) {
    attention.push({
      id: "recheck_sys_001_after_roster_freeze",
      severity: "high",
      title: "Recheck SYS_001 after roster freeze",
      reason: "REVIEW_034 condition requires document-review if final roster changes the working assumption"
    });
  }

  return attention;
}

function buildStatus(args) {
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root does not exist: ${projectRoot}`);

  const { projectId, gameDir } = resolveGameDir(projectRoot, args.projectId);
  const activePath = path.join(gameDir, "active.md");
  const statePath = path.join(gameDir, ".gamespec-state.yaml");
  const archaeologyPath = path.join(gameDir, "CONTEXT_ARCHAEOLOGY_2026-05-11.md");

  const active = parseFrontmatter(readUtf8(activePath));
  const activeSections = parseSections(active.body);
  const recentDecisions = extractBullets(activeSections["Recent Decisions"]);
  const nextStep = extractBullets(activeSections["Next Step"]);
  const openQuestions = extractBullets(activeSections["Open Questions"]);
  const blockers = extractBullets(activeSections.Blockers);
  const handoffs = extractBullets(activeSections["Pending Handoffs"]);
  const state = fs.existsSync(statePath) ? parseStateYaml(readUtf8(statePath)) : { phases: [] };
  const currentPhase = state.phases.find((phase) => String(phase.id) === String(state.current_phase)) ?? null;

  const activeDocRel = active.data.current_document ?? null;
  const activeDocAbs = activeDocRel ? path.join(gameDir, ...fromPosix(activeDocRel)) : null;
  const activeDoc = readOptionalFrontmatter(activeDocAbs);
  const reviewId = active.data.current_section?.match(/\bREVIEW_\d+\b/)?.[0] ?? null;
  const reviewFile = findReviewFile(gameDir, reviewId);
  const review = readOptionalFrontmatter(reviewFile);
  const reviewText = review.exists ? `${review.body}\n${Object.entries(review.data).map(([k, v]) => `${k}: ${v}`).join("\n")}` : "";
  const archaeologyText = fs.existsSync(archaeologyPath) ? readUtf8(archaeologyPath) : "";
  const reviewConclusion = firstLineMatch(reviewText, [
    /\*\*审查结论\*\*:\s*(.+)$/,
    /^审查结论:\s*(.+)$/,
    /当前结论[:：]\s*(.+)$/
  ]);

  const driverState = reviewConclusion?.includes("有条件通过")
    ? "conditional_pass_working_assumption"
    : (activeDoc.data.status ?? "unknown");

  const parked = detectParked(recentDecisions);
  const quarantined = detectQuarantined(gameDir, [...recentDecisions, ...nextStep]);
  const attention = detectAttention(activeSections, archaeologyText, reviewText);

  return {
    generated: new Date().toISOString(),
    mode: "project_status_read_only",
    projectRoot,
    projectId,
    gameDir,
    current: {
      workflow: active.data.current_workflow ?? state.workflow ?? null,
      phase: currentPhase
        ? { id: currentPhase.id, name: currentPhase.name ?? null, status: currentPhase.status ?? null }
        : { id: state.current_phase ?? null, name: null, status: null },
      agent: active.data.current_agent ?? null,
      reviewMode: active.data.review_mode ?? activeDoc.data.review_mode ?? null,
      updated: active.data.updated ?? null
    },
    driver: {
      id: activeDoc.data.system_id ?? path.basename(activeDocRel ?? "unknown"),
      title: activeDoc.data.title ?? null,
      path: activeDocRel,
      exists: activeDoc.exists,
      status: activeDoc.data.status ?? null,
      reviewMode: activeDoc.data.review_mode ?? null,
      state: driverState,
      currentSection: active.data.current_section ?? null,
      review: reviewFile
        ? {
            id: reviewId,
            path: toPosix(path.relative(gameDir, reviewFile)),
            conclusion: reviewConclusion,
            status: review.data.status ?? null
          }
        : null
    },
    parked,
    quarantined,
    attention,
    nextSafeActions: nextStep,
    openQuestions,
    blockers,
    handoffs,
    guardrails: [
      "Read-only status report.",
      "Does not install, migrate, edit, or normalize project files.",
      "Quarantined documents are reported but not consumed as active truth.",
      "Reports may not be written inside the target project."
    ],
    sources: {
      active: toPosix(path.relative(projectRoot, activePath)),
      state: fs.existsSync(statePath) ? toPosix(path.relative(projectRoot, statePath)) : null,
      activeDocument: activeDocAbs && activeDoc.exists ? toPosix(path.relative(projectRoot, activeDocAbs)) : null,
      review: reviewFile ? toPosix(path.relative(projectRoot, reviewFile)) : null,
      archaeology: fs.existsSync(archaeologyPath) ? toPosix(path.relative(projectRoot, archaeologyPath)) : null
    }
  };
}

function renderMarkdown(status) {
  const lines = [];
  lines.push("# GameSpec Project Status");
  lines.push("");
  lines.push(`Mode: \`${status.mode}\``);
  lines.push(`Project root: \`${status.projectRoot}\``);
  lines.push(`Project id: \`${status.projectId}\``);
  lines.push(`Generated: ${status.generated}`);
  lines.push("");

  lines.push("## Current Workflow");
  lines.push("");
  lines.push(`- Workflow: \`${status.current.workflow ?? "unknown"}\``);
  lines.push(`- Phase: \`${status.current.phase.id ?? "unknown"}\` ${status.current.phase.name ?? ""} (${status.current.phase.status ?? "unknown"})`);
  lines.push(`- Agent: \`${status.current.agent ?? "unknown"}\``);
  lines.push(`- Review mode: \`${status.current.reviewMode ?? "unknown"}\``);
  lines.push(`- Updated: ${status.current.updated ?? "unknown"}`);
  lines.push("");

  lines.push("## Driver");
  lines.push("");
  lines.push(`- Driver: \`${status.driver.id}\` ${status.driver.title ?? ""}`);
  lines.push(`- Path: \`${status.driver.path ?? "unknown"}\``);
  lines.push(`- Status: \`${status.driver.status ?? "unknown"}\``);
  lines.push(`- Control state: \`${status.driver.state}\``);
  lines.push(`- Current section: ${status.driver.currentSection ?? "unknown"}`);
  if (status.driver.review) {
    lines.push(`- Review: \`${status.driver.review.id}\` (${status.driver.review.conclusion ?? "unknown"})`);
  }
  lines.push("");

  lines.push("## Parked");
  lines.push("");
  if (status.parked.length === 0) {
    lines.push("- None detected.");
  } else {
    for (const item of status.parked) {
      lines.push(`- \`${item.id}\`: ${item.state} - ${item.reason}`);
    }
  }
  lines.push("");

  lines.push("## Quarantined");
  lines.push("");
  if (status.quarantined.length === 0) {
    lines.push("- None detected.");
  } else {
    for (const item of status.quarantined) {
      lines.push(`- \`${item.id}\`: ${item.state}; consume now: ${item.consumeNow}`);
      lines.push(`  - thaw conditions: ${item.thawConditions.join("; ")}`);
    }
  }
  lines.push("");

  lines.push("## Attention");
  lines.push("");
  if (status.attention.length === 0) {
    lines.push("- None detected.");
  } else {
    for (const item of status.attention) {
      lines.push(`- [${item.severity}] \`${item.id}\`: ${item.title} - ${item.reason}`);
    }
  }
  lines.push("");

  lines.push("## Next Safe Actions");
  lines.push("");
  if (status.nextSafeActions.length === 0) {
    lines.push("- No next action found in active.md.");
  } else {
    for (const action of status.nextSafeActions) lines.push(`- ${action}`);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of status.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");

  lines.push("## Sources");
  lines.push("");
  for (const [key, value] of Object.entries(status.sources)) {
    lines.push(`- ${key}: \`${value ?? "missing"}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = normalizePath(args.project);
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write status report inside target project: ${outPath}`);
    }
  }

  const status = buildStatus(args);
  const rendered = args.format === "json" ? renderJson(status) : renderMarkdown(status);
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
  console.error(`gamespec-status: ${error.message}`);
  process.exit(1);
}
