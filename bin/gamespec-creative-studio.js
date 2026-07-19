#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRun, collectContext, runDivergence } from "./gamespec-cross-agent.js";

const ACTIONS = new Set(["diverge", "counterframe", "deepen", "cross-pollinate", "contrast"]);
const ADVANCE_DECISIONS = new Set(["continue", "curate", "park", "abandon"]);
const REOPENABLE = new Set(["curation-ready", "parked", "needs-user", "stale", "blocked-by-environment", "task-contract-mismatch"]);
const STATES = new Set(["round-required", "selection-required", "task-contract-mismatch", "blocked-by-environment", "stale", "needs-user", "curation-ready", "parked", "abandoned"]);

function usage() {
  return `GameSpec Creative Studio

Usage:
  gamespec-creative-studio start --project-root <path> --prompt <text> [--project-id <id>] [--action <action>] [--context-file <project-path>]... [--role-lens <name>]... [--desired-contrast <text>] [--primary-host claude|codex] [--reviewer auto|claude|codex] [--max-rounds 1..6] [--json]
  gamespec-creative-studio run --project-root <path> --session <id-or-path> [--json]
  gamespec-creative-studio advance --project-root <path> --session <id-or-path> --decision continue|curate|park|abandon --reason <text> [--next-action <action>] [--json]
  gamespec-creative-studio reopen --project-root <path> --session <id-or-path> --next-action <action> --reason <text> [--json]
  gamespec-creative-studio recover-previous --project-root <path> --session <id-or-path> --reason <text> [--json]
  gamespec-creative-studio status --project-root <path> --session <id-or-path> [--json]
  gamespec-creative-studio check --project-root <path> --session <id-or-path> [--json]

Creative Studio writes only local non-canon runtime artifacts under
gamespec/.runtime/creative-studio/. It never writes gamespec/projects/ and
never promotes Spark or Thread material to Candidate or Canon.
`;
}

function parseArgs(argv) {
  const command = ["--help", "-h"].includes(argv[0]) ? "help" : (argv[0] || "help");
  const args = { command, projectRoot: process.cwd(), projectId: null, prompt: null, action: "diverge", contextFiles: [], roleLenses: [], desiredContrast: null, primaryHost: "codex", reviewer: null, maxRounds: 3, session: null, decision: null, nextAction: null, reason: null, json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-root") args.projectRoot = argv[++index];
    else if (arg === "--project-id") args.projectId = argv[++index];
    else if (arg === "--prompt") args.prompt = argv[++index];
    else if (arg === "--action") args.action = argv[++index];
    else if (arg === "--context-file") args.contextFiles.push(argv[++index]);
    else if (arg === "--role-lens") args.roleLenses.push(argv[++index]);
    else if (arg === "--desired-contrast") args.desiredContrast = argv[++index];
    else if (arg === "--primary-host") args.primaryHost = argv[++index];
    else if (arg === "--reviewer") args.reviewer = argv[++index];
    else if (arg === "--max-rounds") args.maxRounds = Number(argv[++index]);
    else if (arg === "--session") args.session = argv[++index];
    else if (arg === "--decision") args.decision = argv[++index];
    else if (arg === "--next-action") args.nextAction = argv[++index];
    else if (arg === "--reason") args.reason = argv[++index];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.command = "help";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["start", "run", "advance", "reopen", "recover-previous", "status", "check", "help"].includes(args.command)) throw new Error(`unknown command: ${args.command}`);
  args.projectRoot = path.resolve(args.projectRoot);
  if (args.command === "start" && !args.prompt) throw new Error("start requires --prompt");
  if (args.command !== "start" && args.command !== "help" && !args.session) throw new Error(`${args.command} requires --session`);
  if (args.command === "advance" && (!ADVANCE_DECISIONS.has(args.decision) || !args.reason?.trim())) throw new Error("advance requires a valid --decision and non-empty --reason");
  if (args.command === "reopen" && (!ACTIONS.has(args.nextAction) || !args.reason?.trim())) throw new Error("reopen requires a valid --next-action and non-empty --reason");
  if (args.command === "recover-previous" && !args.reason?.trim()) throw new Error("recover-previous requires --reason");
  if (!ACTIONS.has(args.action)) throw new Error(`--action must be one of: ${[...ACTIONS].join(", ")}`);
  if (args.nextAction && !ACTIONS.has(args.nextAction)) throw new Error(`--next-action must be one of: ${[...ACTIONS].join(", ")}`);
  if (!Number.isInteger(args.maxRounds) || args.maxRounds < 1 || args.maxRounds > 6) throw new Error("--max-rounds must be an integer from 1 to 6");
  if (!["claude", "codex"].includes(args.primaryHost)) throw new Error("--primary-host must be claude or codex");
  if (args.reviewer && !["auto", "claude", "codex"].includes(args.reviewer)) throw new Error("--reviewer must be auto, claude, or codex");
  return args;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function timestamp() {
  return now().replace(/[-:.]/gu, "").replace("Z", "Z");
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function studioRoot(projectRoot) {
  return path.join(projectRoot, "gamespec", ".runtime", "creative-studio");
}

function resolveSessionDir(projectRoot, requested) {
  const root = path.resolve(studioRoot(projectRoot));
  const candidate = path.resolve(path.isAbsolute(requested) ? requested : path.join(root, requested));
  if (!inside(normalized(root), normalized(candidate)) || normalized(path.dirname(candidate)) !== normalized(root)) throw new Error("session must be an immediate child of gamespec/.runtime/creative-studio");
  return candidate;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function validateState(state, sessionDir) {
  if (!state || state.schemaVersion !== 1 || state.runner !== "gamespec-creative-studio/v1") throw new Error("invalid Creative Studio state schema");
  if (state.sessionId !== path.basename(sessionDir)) throw new Error("Creative Studio session identity mismatch");
  const expectedProjectRoot = path.resolve(sessionDir, "..", "..", "..", "..");
  if (normalized(state.projectRoot) !== normalized(expectedProjectRoot)) throw new Error("Creative Studio project identity mismatch");
  if (state.truthBoundary !== "runtime-non-canon" || state.promotionAuthority !== "human-only") throw new Error("Creative Studio truth boundary is invalid");
  if (!STATES.has(state.status) || !ACTIONS.has(state.action) || !Number.isInteger(state.maxRounds) || state.maxRounds < 1 || state.maxRounds > 6) throw new Error("Creative Studio state transition contract is invalid");
  if (typeof state.prompt !== "string" || state.promptHash !== sha256(state.prompt)) throw new Error("Creative Studio prompt identity mismatch");
  if (!Array.isArray(state.contextFiles) || !Array.isArray(state.contextManifest) || !Array.isArray(state.contextHistory) || state.contextFingerprint !== sha256(JSON.stringify(state.contextManifest))) throw new Error("Creative Studio context identity mismatch");
  if (!Array.isArray(state.roleLenses) || !Array.isArray(state.rounds) || !Array.isArray(state.decisions) || !Array.isArray(state.curationHistory)) throw new Error("Creative Studio state collections are invalid");
  if (state.rounds.length > state.maxRounds || (state.status === "selection-required" && !state.activeRun) || (state.activeRun && !["selection-required", "stale"].includes(state.status))) throw new Error("Creative Studio active-run invariant is invalid");
  return state;
}

function loadState(sessionDir, fileName = "state.json") {
  const file = path.join(sessionDir, fileName);
  if (!fs.existsSync(file)) throw new Error(`${fileName} does not exist`);
  return validateState(readJson(file), sessionDir);
}

function writeState(sessionDir, state, { preservePrevious = false } = {}) {
  validateState(state, sessionDir);
  fs.mkdirSync(sessionDir, { recursive: true });
  const stateFile = path.join(sessionDir, "state.json");
  const previousFile = path.join(sessionDir, "state.prev.json");
  const temp = path.join(sessionDir, `.state.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  if (fs.existsSync(stateFile) && !preservePrevious) {
    const previousTemp = path.join(sessionDir, `.previous.${process.pid}.${Date.now()}.tmp`);
    fs.copyFileSync(stateFile, previousTemp);
    if (fs.existsSync(previousFile)) fs.rmSync(previousFile, { force: true });
    fs.renameSync(previousTemp, previousFile);
  }
  fs.renameSync(temp, stateFile);
}

function contextRecord(item) {
  return { path: item.relativePath, bytes: item.bytes, includedBytes: item.includedBytes, sha256: item.sha256, clipped: item.clipped };
}

function composeContext(projectRoot, projectId, explicitFiles) {
  const items = collectContext(projectRoot, projectId, explicitFiles);
  const manifest = items.map(contextRecord);
  return { manifest, fingerprint: sha256(JSON.stringify(manifest)) };
}

function contextStatus(state) {
  try {
    const current = composeContext(state.projectRoot, state.projectId, state.contextFiles);
    return { current: current.fingerprint === state.contextFingerprint, ...current };
  } catch (error) {
    return { current: false, fingerprint: null, manifest: [], error: error.message };
  }
}

function relativeToProject(projectRoot, file) {
  return path.relative(projectRoot, file).replace(/\\/gu, "/");
}

function projectPath(projectRoot, requested) {
  const file = path.resolve(projectRoot, requested);
  if (!inside(normalized(projectRoot), normalized(file))) throw new Error(`runtime evidence path escapes project root: ${requested}`);
  return file;
}

function roundEvidenceErrors(state) {
  const errors = [];
  for (const round of state.rounds) {
    let runDir;
    try {
      runDir = projectPath(state.projectRoot, round.runDir);
      const checked = checkRun({ projectRoot: state.projectRoot, runDir, prompt: state.prompt });
      if (checked.status !== "complete") errors.push(`round ${round.round} is ${checked.status}`);
    } catch (error) {
      errors.push(`round ${round.round} run identity is invalid: ${error.message}`);
      continue;
    }
    const records = [
      [path.join(runDir, "run.json"), round.runManifestSha256, "run manifest"],
      [round.rawPath, round.rawSha256, "raw output"],
      [round.selectionPath, round.selectionSha256, "selection"],
    ];
    for (const [requested, expected, label] of records) {
      try {
        const file = projectPath(state.projectRoot, requested);
        if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== expected) errors.push(`round ${round.round} ${label} identity drifted`);
      } catch (error) {
        errors.push(`round ${round.round} ${label} path is invalid: ${error.message}`);
      }
    }
  }
  return errors;
}

function activeRunErrors(state) {
  if (!state.activeRun) return [];
  try {
    const runDir = projectPath(state.projectRoot, state.activeRun.runDir);
    const checked = checkRun({ projectRoot: state.projectRoot, runDir, prompt: state.prompt });
    if (!["selection-required", "complete"].includes(checked.status)) return [`active run is ${checked.status}`];
    const run = readJson(path.join(runDir, "run.json"));
    if (run.action !== state.activeRun.action || run.contextFingerprint !== state.activeRun.contextFingerprint) return ["active run action or context identity drifted"];
    return [];
  } catch (error) {
    return [`active run identity is invalid: ${error.message}`];
  }
}

function explicitContextPaths(projectRoot, requested) {
  return requested.map((file) => {
    const absolute = path.resolve(projectRoot, file);
    const relative = path.relative(projectRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`context file escapes project root: ${file}`);
    return relative.replace(/\\/gu, "/");
  });
}

function startSession(args) {
  const contextFiles = explicitContextPaths(args.projectRoot, args.contextFiles);
  const context = composeContext(args.projectRoot, args.projectId, contextFiles);
  const sessionId = `${timestamp()}-${crypto.randomBytes(4).toString("hex")}`;
  const sessionDir = path.join(studioRoot(args.projectRoot), sessionId);
  const state = {
    schemaVersion: 1,
    runner: "gamespec-creative-studio/v1",
    truthBoundary: "runtime-non-canon",
    promotionAuthority: "human-only",
    sessionId,
    projectRoot: args.projectRoot,
    projectId: args.projectId,
    prompt: args.prompt,
    promptHash: sha256(args.prompt),
    contextFiles,
    contextManifest: context.manifest,
    contextFingerprint: context.fingerprint,
    contextHistory: [],
    action: args.action,
    roleLenses: args.roleLenses,
    desiredContrast: args.desiredContrast,
    primaryHost: args.primaryHost,
    reviewer: args.reviewer,
    maxRounds: args.maxRounds,
    status: "round-required",
    nextOwner: "primary-agent",
    activeRun: null,
    rounds: [],
    decisions: [],
    curationHistory: [],
    createdAt: now(),
    updatedAt: now(),
  };
  writeState(sessionDir, state);
  return { status: state.status, exitCode: 0, sessionId, sessionDir, action: state.action, contextFingerprint: state.contextFingerprint, nextOwner: state.nextOwner };
}

function priorRoundContext(state) {
  return state.rounds.flatMap((round) => [round.rawPath, round.selectionPath]).filter(Boolean);
}

function runRound(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const state = loadState(sessionDir);
  if (state.status !== "round-required") return { status: state.status, exitCode: 3, sessionDir, errors: [`run requires round-required, found ${state.status}`] };
  if (state.rounds.length >= state.maxRounds) return { status: "needs-user", exitCode: 3, sessionDir, errors: ["maximum rounds are exhausted; resolve existing rounds or start a new session with an explicit budget"] };
  const context = contextStatus(state);
  if (!context.current) {
    state.status = "stale";
    state.nextOwner = "user";
    state.stale = { detectedAt: now(), expected: state.contextFingerprint, observed: context.fingerprint, error: context.error || null };
    state.updatedAt = now();
    writeState(sessionDir, state);
    return { status: "stale", exitCode: 3, sessionDir, ...state.stale };
  }
  const priorEvidenceErrors = roundEvidenceErrors(state);
  if (priorEvidenceErrors.length) {
    state.status = "stale";
    state.nextOwner = "user";
    state.stale = { detectedAt: now(), expected: state.contextFingerprint, observed: context.fingerprint, error: "prior round evidence drift", evidenceErrors: priorEvidenceErrors };
    state.updatedAt = now();
    writeState(sessionDir, state);
    return { status: "stale", exitCode: 3, sessionDir, ...state.stale };
  }
  const result = runDivergence({
    projectRoot: state.projectRoot,
    projectId: state.projectId,
    prompt: state.prompt,
    primaryHost: state.primaryHost,
    reviewer: state.reviewer,
    action: state.action,
    contextFiles: [...state.contextFiles, ...priorRoundContext(state)],
    roleLenses: state.roleLenses,
    desiredContrast: state.desiredContrast,
  });
  state.updatedAt = now();
  if (result.status === "selection-required") {
    state.status = "selection-required";
    state.nextOwner = "primary-agent";
    state.activeRun = { action: state.action, runDir: relativeToProject(state.projectRoot, result.runDir), contextFingerprint: result.contextFingerprint, startedAt: now() };
  } else if (result.status === "task-contract-mismatch") {
    state.status = "task-contract-mismatch";
    state.nextOwner = "user";
    state.block = { detectedAt: now(), errors: result.errors };
  } else {
    state.status = "blocked-by-environment";
    state.nextOwner = "user";
    state.block = { detectedAt: now(), errors: result.errors || [result.error || result.status] };
  }
  writeState(sessionDir, state);
  return { ...result, sessionDir, studioStatus: state.status, nextOwner: state.nextOwner };
}

function selectionRows(file) {
  const decisions = new Set(["keep", "remix", "park", "reject-duplicate", "needs-user"]);
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length >= 5 && /^D\d+$/iu.test(cells[0]) && decisions.has(cells[1])) rows.push({ directionId: cells[0].toUpperCase(), decision: cells[1], reason: cells[2], survivingFragment: cells[3], destinationOrReopenTrigger: cells[4] });
  }
  return rows;
}

function buildCuration(sessionDir, state) {
  const lines = [
    "schemaVersion: 1",
    "truthBoundary: runtime-non-canon",
    "status: ready-for-human-curation",
    "",
    `# Creative Studio Curation: ${state.sessionId}`,
    "",
    "## Boundary",
    "",
    "- This is a non-canon creative map, not acceptance or project truth.",
    "- Candidate/Canon promotion authority remains human-only.",
    "- Parked material remains recoverable and is not classified as failure.",
    "",
    "## Objective",
    "",
    state.prompt,
    "",
    "## Round Trace",
    "",
    "| Round | Action | Run | Raw SHA-256 | Selection SHA-256 |",
    "|---:|---|---|---|---|",
    ...state.rounds.map((round) => `| ${round.round} | ${round.action} | \`${round.runDir}\` | \`${round.rawSha256}\` | \`${round.selectionSha256}\` |`),
    "",
    "## Direction And Fragment Map",
    "",
    "| Round | Direction | Decision | Reason | Surviving Fragment | Destination Or Reopen Trigger |",
    "|---:|---|---|---|---|---|",
    ...state.rounds.flatMap((round) => round.selection.map((row) => `| ${round.round} | ${row.directionId} | ${row.decision} | ${row.reason || ""} | ${row.survivingFragment || ""} | ${row.destinationOrReopenTrigger || ""} |`)),
    "",
    "## Human Questions",
    "",
    "- Which directions deserve deeper project-owned exploration?",
    "- Which fragments should stay parked with a reopen trigger?",
    "- What important perspective or lived reality is still missing?",
    "- Does any surviving direction merit explicit promotion into a project Spark or Thread?",
    "",
    "## Limits",
    "",
    "- Agent output does not prove originality, fun, feasibility, fit, or truth.",
    "- Runtime hashes prove carrier identity, not semantic quality.",
    "- Promotion must use the project's existing human-owned GameSpec workflow.",
    "",
  ];
  const file = path.join(sessionDir, "curation.md");
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return { path: relativeToProject(state.projectRoot, file), sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size };
}

function advanceSession(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const state = loadState(sessionDir);
  if (state.status === "needs-user" && !state.activeRun && state.limit?.kind === "max-rounds") {
    if (args.decision === "continue") return { status: "needs-user", exitCode: 3, sessionDir, errors: ["maximum rounds are exhausted; resolve with curate, park, or abandon, or start a new session with an explicit new budget"] };
    state.decisions.push({ at: now(), decision: args.decision, reason: args.reason, round: null, nextAction: null, owner: "user-required-after-limit" });
    state.updatedAt = now();
    if (args.decision === "curate") {
      state.curation = buildCuration(sessionDir, state);
      state.status = "curation-ready";
      state.nextOwner = "user";
    } else if (args.decision === "park") {
      state.curation = buildCuration(sessionDir, state);
      state.status = "parked";
      state.nextOwner = "user";
    } else {
      state.status = "abandoned";
      state.nextOwner = "none";
    }
    delete state.limit;
    writeState(sessionDir, state);
    return { status: state.status, exitCode: 0, sessionDir, completedRound: null, rounds: state.rounds.length, maxRounds: state.maxRounds, nextOwner: state.nextOwner, curation: state.curation || null };
  }
  if (state.status !== "selection-required" || !state.activeRun) return { status: state.status, exitCode: 3, sessionDir, errors: ["advance requires selection-required with an exact active run"] };
  const context = contextStatus(state);
  const priorEvidenceErrors = roundEvidenceErrors(state);
  if (!context.current || priorEvidenceErrors.length) {
    state.status = "stale";
    state.nextOwner = "user";
    state.stale = { detectedAt: now(), expected: state.contextFingerprint, observed: context.fingerprint, error: context.error || (priorEvidenceErrors.length ? "prior round evidence drift" : null), evidenceErrors: priorEvidenceErrors };
    state.updatedAt = now();
    writeState(sessionDir, state);
    return { status: "stale", exitCode: 3, sessionDir, ...state.stale };
  }
  const runDir = path.resolve(state.projectRoot, state.activeRun.runDir);
  const checked = checkRun({ projectRoot: state.projectRoot, runDir, prompt: state.prompt });
  if (checked.status !== "complete") return { ...checked, sessionDir, studioStatus: state.status };
  const run = readJson(path.join(runDir, "run.json"));
  const rawPath = path.join(runDir, "raw.md");
  const selectionPath = path.join(runDir, "selection.md");
  const round = {
    round: state.rounds.length + 1,
    action: state.activeRun.action,
    runDir: relativeToProject(state.projectRoot, runDir),
    rawPath: relativeToProject(state.projectRoot, rawPath),
    selectionPath: relativeToProject(state.projectRoot, selectionPath),
    runManifestSha256: sha256(fs.readFileSync(path.join(runDir, "run.json"))),
    rawSha256: sha256(fs.readFileSync(rawPath)),
    selectionSha256: sha256(fs.readFileSync(selectionPath)),
    contextFingerprint: run.contextFingerprint || null,
    selection: selectionRows(selectionPath),
    completedAt: now(),
  };
  state.rounds.push(round);
  state.decisions.push({ at: now(), decision: args.decision, reason: args.reason, round: round.round, nextAction: args.nextAction || null, owner: "primary-agent-with-human-boundary" });
  state.activeRun = null;
  state.updatedAt = now();
  if (args.decision === "continue") {
    if (!args.nextAction) throw new Error("continue requires --next-action");
    if (state.rounds.length >= state.maxRounds) {
      state.status = "needs-user";
      state.nextOwner = "user";
      state.limit = { kind: "max-rounds", maxRounds: state.maxRounds, reachedAt: now() };
    } else {
      state.action = args.nextAction;
      state.status = "round-required";
      state.nextOwner = "primary-agent";
    }
  } else if (args.decision === "curate") {
    state.curation = buildCuration(sessionDir, state);
    state.status = "curation-ready";
    state.nextOwner = "user";
  } else if (args.decision === "park") {
    state.curation = buildCuration(sessionDir, state);
    state.status = "parked";
    state.nextOwner = "user";
  } else {
    state.status = "abandoned";
    state.nextOwner = "none";
  }
  writeState(sessionDir, state);
  return { status: state.status, exitCode: 0, sessionDir, completedRound: round.round, rounds: state.rounds.length, maxRounds: state.maxRounds, nextOwner: state.nextOwner, curation: state.curation || null };
}

function reopenSession(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const state = loadState(sessionDir);
  if (!REOPENABLE.has(state.status)) return { status: state.status, exitCode: 3, sessionDir, errors: [`${state.status} cannot be reopened`] };
  if (state.rounds.length >= state.maxRounds) return { status: "needs-user", exitCode: 3, sessionDir, errors: ["maximum rounds are exhausted; start a new studio session or explicitly choose a larger budget"] };
  if (state.status === "stale") {
    const current = composeContext(state.projectRoot, state.projectId, state.contextFiles);
    state.contextHistory.push({ fingerprint: state.contextFingerprint, manifest: state.contextManifest, supersededAt: now(), reason: args.reason });
    state.contextFingerprint = current.fingerprint;
    state.contextManifest = current.manifest;
    delete state.stale;
  }
  if (state.curation) {
    let curationFile = null;
    try { curationFile = projectPath(state.projectRoot, state.curation.path); } catch {}
    if (curationFile && fs.existsSync(curationFile) && sha256(fs.readFileSync(curationFile)) === state.curation.sha256) {
      const archivedFile = path.join(sessionDir, `curation-${timestamp()}.md`);
      fs.copyFileSync(curationFile, archivedFile);
      state.curationHistory.push({ ...state.curation, path: relativeToProject(state.projectRoot, archivedFile), supersededAt: now(), reason: args.reason, fromStatus: state.status });
    } else {
      state.curationHistory.push({ ...state.curation, supersededAt: now(), reason: args.reason, fromStatus: state.status, identityDrifted: true });
    }
    delete state.curation;
  }
  state.decisions.push({ at: now(), decision: "reopen", reason: args.reason, from: state.status, nextAction: args.nextAction, owner: "user-required" });
  state.action = args.nextAction;
  state.status = "round-required";
  state.nextOwner = "primary-agent";
  state.activeRun = null;
  delete state.block;
  state.updatedAt = now();
  writeState(sessionDir, state);
  return { status: state.status, exitCode: 0, sessionDir, action: state.action, contextFingerprint: state.contextFingerprint, nextOwner: state.nextOwner };
}

function recoverPrevious(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const currentFile = path.join(sessionDir, "state.json");
  const previous = loadState(sessionDir, "state.prev.json");
  const recoveryFile = path.join(sessionDir, `recovery-${timestamp()}.json`);
  const recovery = { schemaVersion: 1, kind: "creative-studio-previous-state-recovery", reason: args.reason, recoveredAt: now(), currentSha256: fs.existsSync(currentFile) ? sha256(fs.readFileSync(currentFile)) : null, previousSha256: sha256(fs.readFileSync(path.join(sessionDir, "state.prev.json"))) };
  fs.writeFileSync(recoveryFile, `${JSON.stringify(recovery, null, 2)}\n`, "utf8");
  previous.decisions.push({ at: now(), decision: "recover-previous", reason: args.reason, recoveryRecord: path.basename(recoveryFile), owner: "user-required" });
  previous.updatedAt = now();
  writeState(sessionDir, previous, { preservePrevious: true });
  return { status: previous.status, exitCode: 0, sessionDir, recovered: "state.prev.json", recoveryRecord: recoveryFile, nextOwner: previous.nextOwner };
}

function checkSession(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const state = loadState(sessionDir);
  const errors = [];
  const context = contextStatus(state);
  if (!context.current) errors.push(`context drift: expected ${state.contextFingerprint}, observed ${context.fingerprint || context.error}`);
  errors.push(...roundEvidenceErrors(state));
  errors.push(...activeRunErrors(state));
  if (state.curation) {
    try {
      const file = projectPath(state.projectRoot, state.curation.path);
      if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== state.curation.sha256) errors.push("curation identity drifted");
    } catch (error) { errors.push(`curation path is invalid: ${error.message}`); }
  }
  for (const [index, curation] of state.curationHistory.entries()) {
    try {
      const file = projectPath(state.projectRoot, curation.path);
      if (!curation.identityDrifted && (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== curation.sha256)) errors.push(`curation history ${index + 1} identity drifted`);
    } catch (error) { errors.push(`curation history ${index + 1} path is invalid: ${error.message}`); }
  }
  return { status: errors.length ? "stale" : "verified", exitCode: errors.length ? 3 : 0, sessionDir, studioStatus: state.status, rounds: state.rounds.length, maxRounds: state.maxRounds, contextFingerprint: state.contextFingerprint, nextOwner: state.nextOwner, errors };
}

function statusSession(args) {
  const sessionDir = resolveSessionDir(args.projectRoot, args.session);
  const state = loadState(sessionDir);
  const context = contextStatus(state);
  return { status: state.status, exitCode: 0, sessionDir, sessionId: state.sessionId, action: state.action, rounds: state.rounds.length, maxRounds: state.maxRounds, contextCurrent: context.current, contextFingerprint: state.contextFingerprint, activeRun: state.activeRun, curation: state.curation || null, curationHistory: state.curationHistory, nextOwner: state.nextOwner, truthBoundary: state.truthBoundary, promotionAuthority: state.promotionAuthority };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") { process.stdout.write(usage()); return; }
  let result;
  if (args.command === "start") result = startSession(args);
  else if (args.command === "run") result = runRound(args);
  else if (args.command === "advance") result = advanceSession(args);
  else if (args.command === "reopen") result = reopenSession(args);
  else if (args.command === "recover-previous") result = recoverPrevious(args);
  else if (args.command === "check") result = checkSession(args);
  else result = statusSession(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`[gamespec creative-studio] ${result.status} ${result.sessionDir || ""}\n`);
  process.exitCode = result.exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (error) { console.error(`gamespec-creative-studio: ${error.message}`); process.exitCode = 1; }
}
