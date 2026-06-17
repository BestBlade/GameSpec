#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const text = `GameSpec change impact report

Usage:
  node bin/gamespec-impact.js --project <project-root> (--target <system-id-or-path> | --decision-plan <plan.json>) [--project-id <id>] [--max-depth <n>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Builds a lightweight dependency graph from project GameSpec frontmatter.
  - Refuses to write reports inside the target project.
  - Reports active, review, frozen, quarantined, and downstream impact.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", maxDepth: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--project-id") {
      args.projectId = argv[++i];
    } else if (arg === "--target") {
      args.target = argv[++i];
    } else if (arg === "--decision-plan") {
      args.decisionPlan = argv[++i];
    } else if (arg === "--max-depth") {
      args.maxDepth = Number.parseInt(argv[++i], 10);
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
  if (!args.target && !args.decisionPlan) {
    console.error("Missing --target <system-id-or-path> or --decision-plan <plan.json>.");
    usage(1);
  }
  if (args.target && args.decisionPlan) {
    throw new Error("Use either --target or --decision-plan, not both.");
  }
  if (!Number.isInteger(args.maxDepth) || args.maxDepth < 1) {
    throw new Error(`Unsupported --max-depth: ${args.maxDepth}`);
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

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => stripQuotes(item)).filter(Boolean);
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
    const inlineList = parseInlineList(value);
    if (inlineList) {
      data[key] = inlineList;
      currentListKey = null;
    } else if (value === "") {
      data[key] = [];
      currentListKey = key;
    } else {
      data[key] = stripQuotes(value);
      currentListKey = null;
    }
  }
  return data;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const yaml = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  return { data: parseYamlLike(yaml), body };
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
    if (!fs.existsSync(gameDir)) throw new Error(`Project id does not exist: ${projectId}`);
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

function readActive(gameDir) {
  const activePath = path.join(gameDir, "active.md");
  if (!fs.existsSync(activePath)) return { data: {}, path: null };
  return { ...parseFrontmatter(fs.readFileSync(activePath, "utf8")), path: activePath };
}

function normalizeDependency(dep) {
  return String(dep).trim().replace(/\.ai\.md$/i, "").replace(/\.md$/i, "");
}

function docKind(relPath) {
  if (relPath.startsWith("reviews/")) return "review";
  if (relPath.includes("/archive/")) return "archive";
  if (relPath.startsWith("sense/")) return "sense";
  return "design";
}

function scanDocs(gameDir, projectRoot) {
  return walkFiles(gameDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const relPath = toPosix(path.relative(gameDir, file));
      const projectPath = toPosix(path.relative(projectRoot, file));
      const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const dependencies = Array.isArray(parsed.data.dependencies)
        ? parsed.data.dependencies.map(normalizeDependency).filter(Boolean)
        : [];
      const systemId = parsed.data.system_id ?? path.basename(relPath).replace(/\.ai\.md$/i, "").replace(/\.md$/i, "");
      const status = parsed.data.status ?? "unknown";
      return {
        id: systemId,
        title: parsed.data.title ?? null,
        relPath,
        projectPath,
        absPath: file,
        kind: docKind(relPath),
        status,
        reviewMode: parsed.data.review_mode ?? null,
        dependencies,
        isFrozen: status === "frozen",
        isApproved: status === "approved"
      };
    });
}

function buildIndexes(docs) {
  const byId = new Map();
  const byRel = new Map();
  const dependents = new Map();
  for (const doc of docs) {
    byId.set(doc.id, doc);
    byRel.set(doc.relPath, doc);
    byRel.set(doc.projectPath, doc);
  }
  for (const doc of docs) {
    for (const dep of doc.dependencies) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(doc);
    }
  }
  return { byId, byRel, dependents };
}

function resolveTarget(target, indexes) {
  const normalized = normalizeDependency(target);
  if (indexes.byId.has(normalized)) return indexes.byId.get(normalized);
  if (indexes.byRel.has(target)) return indexes.byRel.get(target);
  const projectPrefix = "gamespec/projects/";
  if (target.startsWith(projectPrefix)) {
    const parts = target.split("/");
    const rel = parts.slice(3).join("/");
    if (indexes.byRel.has(rel)) return indexes.byRel.get(rel);
  }
  const basenameMatch = [...indexes.byRel.values()].find((doc) => path.basename(doc.relPath) === target);
  if (basenameMatch) return basenameMatch;
  throw new Error(`Unable to resolve target: ${target}`);
}

function primaryTargetFromDecisionPlan(plan) {
  const castCandidate = (plan.projectUpdateCandidates ?? [])
    .find((candidate) => candidate.targetPath.includes("/CAST_001_"));
  if (castCandidate) return "CAST_001";
  const activeCandidate = (plan.projectUpdateCandidates ?? [])
    .find((candidate) => candidate.targetPath.endsWith("/active.md"));
  if (activeCandidate) return activeCandidate.targetPath;
  return plan.selected?.decisionId ?? null;
}

function collectDownstream(targetId, dependents, maxDepth) {
  const result = [];
  const seen = new Set();
  const queue = [{ depId: targetId, depth: 1, via: targetId }];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const doc of dependents.get(current.depId) ?? []) {
      const key = `${doc.id}:${doc.relPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = {
        depth: current.depth,
        via: current.via,
        id: doc.id,
        title: doc.title,
        path: doc.relPath,
        kind: doc.kind,
        status: doc.status,
        reviewMode: doc.reviewMode,
        isFrozen: doc.isFrozen,
        dependencies: doc.dependencies
      };
      result.push(item);
      if (current.depth < maxDepth) {
        queue.push({ depId: doc.id, depth: current.depth + 1, via: doc.id });
      }
    }
  }
  return result;
}

function classifyImpact(item, activeDocId) {
  if (item.id === activeDocId) return "active_driver_recheck";
  if (item.kind === "review") return "review_evidence";
  if (item.isFrozen) return "frozen_or_quarantined_hold";
  if (item.kind !== "design") return "supporting_context";
  if (item.reviewMode === "full") return "formal_recheck_candidate";
  return "lean_recheck_candidate";
}

function buildDecisionPlanContext(args) {
  if (!args.decisionPlan) return null;
  const planPath = normalizePath(args.decisionPlan);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  return {
    path: planPath,
    selected: plan.selected ?? null,
    planKind: plan.planKind ?? null,
    projectUpdateCandidates: plan.projectUpdateCandidates ?? [],
    primaryTargetHint: primaryTargetFromDecisionPlan(plan)
  };
}

function buildImpact(args) {
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root does not exist: ${projectRoot}`);
  const { projectId, gameDir } = resolveGameDir(projectRoot, args.projectId);
  const active = readActive(gameDir);
  const activeDocRel = active.data.current_document ?? null;
  const docs = scanDocs(gameDir, projectRoot);
  const indexes = buildIndexes(docs);
  const decisionPlan = buildDecisionPlanContext(args);
  const targetInput = args.target ?? decisionPlan?.primaryTargetHint;
  if (!targetInput) throw new Error("Decision plan did not provide a resolvable target hint.");
  const targetDoc = resolveTarget(targetInput, indexes);
  const activeDoc = activeDocRel ? resolveTarget(activeDocRel, indexes) : null;
  const downstream = collectDownstream(targetDoc.id, indexes.dependents, args.maxDepth)
    .map((item) => ({ ...item, impactClass: classifyImpact(item, activeDoc?.id) }));
  const activeImpact = downstream.find((item) => item.id === activeDoc?.id) ?? null;
  const frozenOrQuarantined = downstream.filter((item) => item.impactClass === "frozen_or_quarantined_hold");
  const reviewEvidence = downstream.filter((item) => item.kind === "review");
  const recheckCandidates = downstream.filter((item) =>
    ["active_driver_recheck", "formal_recheck_candidate", "lean_recheck_candidate"].includes(item.impactClass)
  );

  return {
    generated: new Date().toISOString(),
    mode: "change_impact_read_only",
    projectRoot,
    projectId,
    gameDir,
    maxDepth: args.maxDepth,
    target: {
      input: targetInput,
      id: targetDoc.id,
      title: targetDoc.title,
      path: targetDoc.relPath,
      status: targetDoc.status,
      reviewMode: targetDoc.reviewMode,
      dependencies: targetDoc.dependencies
    },
    decisionPlan,
    active: activeDoc
      ? {
          id: activeDoc.id,
          path: activeDoc.relPath,
          workflow: active.data.current_workflow ?? null,
          impactClass: activeImpact ? "active_driver_recheck" : "not_downstream_of_target"
        }
      : null,
    summary: {
      scannedDocs: docs.length,
      downstreamCount: downstream.length,
      recheckCandidates: recheckCandidates.length,
      reviewEvidence: reviewEvidence.length,
      frozenOrQuarantined: frozenOrQuarantined.length,
      activeDriverImpacted: Boolean(activeImpact)
    },
    downstream,
    recheckCandidates,
    reviewEvidence,
    frozenOrQuarantined,
    guardrails: [
      "Read-only impact report.",
      "Does not edit project truth.",
      "Frozen or quarantined downstream documents are reported as hold items, not active inputs.",
      "Reports may not be written inside the target project."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Change Impact Report");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Project root: \`${report.projectRoot}\``);
  lines.push(`Project id: \`${report.projectId}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");

  lines.push("## Target");
  lines.push("");
  lines.push(`- Target: \`${report.target.id}\` ${report.target.title ?? ""}`);
  lines.push(`- Path: \`${report.target.path}\``);
  lines.push(`- Status: \`${report.target.status}\``);
  lines.push(`- Review mode: \`${report.target.reviewMode ?? "unknown"}\``);
  lines.push("");

  if (report.decisionPlan) {
    lines.push("## Decision Plan Context");
    lines.push("");
    lines.push(`- Decision: \`${report.decisionPlan.selected?.decisionId ?? "unknown"}\``);
    lines.push(`- Option: \`${report.decisionPlan.selected?.optionId ?? "unknown"}\``);
    lines.push(`- Plan kind: \`${report.decisionPlan.planKind ?? "unknown"}\``);
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Scanned docs: ${report.summary.scannedDocs}`);
  lines.push(`- Downstream docs: ${report.summary.downstreamCount}`);
  lines.push(`- Recheck candidates: ${report.summary.recheckCandidates}`);
  lines.push(`- Review evidence docs: ${report.summary.reviewEvidence}`);
  lines.push(`- Frozen/quarantined holds: ${report.summary.frozenOrQuarantined}`);
  lines.push(`- Active driver impacted: ${report.summary.activeDriverImpacted}`);
  lines.push("");

  lines.push("## Recheck Candidates");
  lines.push("");
  if (report.recheckCandidates.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of report.recheckCandidates) {
      lines.push(`- \`${item.id}\` (${item.impactClass}) -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Frozen Or Quarantined Holds");
  lines.push("");
  if (report.frozenOrQuarantined.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of report.frozenOrQuarantined) {
      lines.push(`- \`${item.id}\` (${item.status}) -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Review Evidence");
  lines.push("");
  if (report.reviewEvidence.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of report.reviewEvidence) {
      lines.push(`- \`${item.id}\` -> \`${item.path}\``);
    }
  }
  lines.push("");

  lines.push("## Downstream");
  lines.push("");
  for (const item of report.downstream) {
    lines.push(`- depth ${item.depth}: \`${item.id}\` [${item.impactClass}] -> \`${item.path}\``);
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
  const projectRoot = normalizePath(args.project);
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write impact report inside target project: ${outPath}`);
    }
  }
  const report = buildImpact(args);
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
  console.error(`gamespec-impact: ${error.message}`);
  process.exit(1);
}
