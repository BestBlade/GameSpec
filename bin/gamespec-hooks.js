#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkRequest } from "./gamespec-cross-agent.js";

const MANAGED_TAG = "gamespec-cross-agent-hook-v1";
const EVENTS = ["UserPromptSubmit", "Stop"];
const HOSTS = ["claude", "codex"];

function usage() {
  return `GameSpec host hooks

Usage:
  gamespec-hooks configure --project-root <path> --mode off|ask|auto [--project-id <id>] [--pass-env <names>]
  gamespec-hooks install [--target claude|codex|both] [--json]
  gamespec-hooks uninstall [--target claude|codex|both] [--json]
  gamespec-hooks status [--target claude|codex|both] [--json]
  gamespec-hooks hook-event <UserPromptSubmit|Stop> --host claude|codex

Global adapters are dispatchers only. Cross-agent work requires a project-level
gamespec/.cross-agent.json opt-in and an explicitly activated creative turn.
`;
}

function parseArgs(argv) {
  const first = argv[0] || "help";
  const args = { command: ["--help", "-h"].includes(first) ? "help" : first, event: null, host: null, target: "both", projectRoot: process.cwd(), mode: null, projectId: null, passEnv: [], json: false, dryRun: false };
  if (args.command === "hook-event") args.event = argv[1] || null;
  const start = args.command === "hook-event" ? 2 : 1;
  for (let i = start; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") args.host = argv[++i];
    else if (arg === "--target") args.target = argv[++i];
    else if (arg === "--project-root") args.projectRoot = argv[++i];
    else if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--project-id") args.projectId = argv[++i];
    else if (arg === "--pass-env") args.passEnv.push(...String(argv[++i] || "").split(",").map((value) => value.trim()).filter(Boolean));
    else if (arg === "--json") args.json = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--adapter-id") i += 1;
    else if (arg === "--help" || arg === "-h") args.command = "help";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["configure", "install", "uninstall", "status", "hook-event", "help"].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (!["claude", "codex", "both"].includes(args.target)) throw new Error("--target must be claude, codex, or both");
  if (args.command === "configure" && !["off", "ask", "auto"].includes(args.mode)) throw new Error("configure requires --mode off|ask|auto");
  if (args.command === "hook-event" && (!EVENTS.includes(args.event) || !HOSTS.includes(args.host))) throw new Error("hook-event requires a supported event and --host claude|codex");
  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

function homeRoot() {
  return process.env.GAMESPEC_HOME || process.env.HOME || os.homedir();
}

function hostConfigPath(host) {
  if (host === "codex") return path.join(process.env.CODEX_HOME || path.join(homeRoot(), ".codex"), "hooks.json");
  return path.join(homeRoot(), ".claude", "settings.json");
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function validateHooksShape(hooks, file) {
  if (hooks === undefined) return;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${file} hooks must be an object`);
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) throw new Error(`${file} hooks.${event} must be an array`);
    for (const entry of entries) if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) throw new Error(`${file} hooks.${event} contains an incompatible entry`);
  }
}

function isManaged(entry) {
  return Boolean(entry && Array.isArray(entry.hooks) && entry.hooks.some((hook) => typeof hook.command === "string" && hook.command.includes(MANAGED_TAG)));
}

function stripManaged(hooks = {}) {
  const result = {};
  for (const [event, entries] of Object.entries(hooks || {})) {
    const kept = Array.isArray(entries) ? entries.filter((entry) => !isManaged(entry)) : [];
    if (kept.length) result[event] = kept;
  }
  return result;
}

function hookCommand(event, host) {
  const script = fileURLToPath(import.meta.url).replace(/\\/gu, "/");
  return `node "${script}" hook-event ${event} --host ${host} --adapter-id ${MANAGED_TAG}`;
}

function managedHooks(host) {
  return Object.fromEntries(EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command: hookCommand(event, host), timeout: 30 }] }]]));
}

function mergeManaged(existing, host) {
  const result = stripManaged(existing);
  const managed = managedHooks(host);
  for (const event of EVENTS) result[event] = [...(result[event] || []), ...managed[event]];
  return result;
}

function writeJson(file, value, dryRun = false) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return "unchanged";
  if (dryRun) return current === null ? "would-create" : "would-update";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (current !== null) {
    const backup = `${file}.${MANAGED_TAG}-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  }
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, file);
  readJson(file);
  return current === null ? "created" : "updated";
}

function selectedHosts(target) {
  return target === "both" ? HOSTS : [target];
}

function adapterAction(args) {
  const results = [];
  for (const host of selectedHosts(args.target)) {
    const file = hostConfigPath(host);
    const data = readJson(file, {});
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} must contain a JSON object`);
    validateHooksShape(data.hooks, file);
    const installed = Object.values(data.hooks || {}).some((entries) => Array.isArray(entries) && entries.some(isManaged));
    if (args.command === "status") {
      results.push({ host, file, installed, events: Object.entries(data.hooks || {}).filter(([, entries]) => Array.isArray(entries) && entries.some(isManaged)).map(([event]) => event) });
      continue;
    }
    const hooks = args.command === "install" ? mergeManaged(data.hooks, host) : stripManaged(data.hooks);
    const action = writeJson(file, { ...data, hooks }, args.dryRun);
    const result = { host, file, installed: args.command === "install", action, events: args.command === "install" ? EVENTS : [] };
    if (host === "codex" && args.command === "install") result.note = "Restart/open a new Codex task and trust the reported hooks file before relying on Codex-host dispatch.";
    results.push(result);
  }
  if (args.json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: args.command, results }, null, 2)}\n`);
  else for (const result of results) {
    console.log(`[gamespec hooks] ${result.host}: ${result.action || (result.installed ? "installed" : "not-installed")} ${result.file}`);
    if (result.note) console.warn(`[gamespec hooks] WARN: ${result.note}`);
  }
}

function projectConfigPath(projectRoot) {
  return path.join(projectRoot, "gamespec", ".cross-agent.json");
}

function ensureGitignore(projectRoot) {
  const file = path.join(projectRoot, ".gitignore");
  const pattern = "gamespec/.runtime/";
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.includes(pattern)) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, `${prefix}${existing ? "\n" : ""}# GameSpec local cross-agent runtime\n${pattern}\n`, "utf8");
}

function configure(args) {
  if (!fs.existsSync(path.join(args.projectRoot, "gamespec"))) throw new Error(`GameSpec project surface not found: ${args.projectRoot}`);
  const file = projectConfigPath(args.projectRoot);
  const existing = readJson(file, {});
  const existingPassEnv = Array.isArray(existing.passEnv) ? existing.passEnv : [];
  const config = {
    schemaVersion: 1,
    reviewer: "auto",
    passEnv: [...new Set([...existingPassEnv, ...args.passEnv])],
    packetOnly: true,
    projectId: args.projectId || existing.projectId || null,
    hooks: {
      mode: args.mode,
      reviewer: "auto",
      activation: "explicit-gamespec-divergence-prompt",
      events: EVENTS,
      activationTtlMs: 21600000,
    },
    truthBoundary: "runtime artifacts are non-canon; user promotion required",
  };
  const action = writeJson(file, config, args.dryRun);
  if (!args.dryRun && args.mode !== "off") ensureGitignore(args.projectRoot);
  const envAuthenticated = Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  const authForwarded = config.passEnv.some((name) => ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"].includes(name));
  const authHint = envAuthenticated && !authForwarded
    ? "Local claude authentication appears environment-based. Reconfigure with --pass-env ANTHROPIC_AUTH_TOKEN plus any required gateway/model variables; secrets are never forwarded implicitly."
    : null;
  const result = { status: "configured", action, file, mode: args.mode, projectId: config.projectId, reviewer: config.reviewer, authHint };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`[gamespec hooks] ${args.mode} ${file} (${action})`);
    if (authHint) console.warn(`[gamespec hooks] WARN: ${authHint}`);
  }
}

function projectRoot(startPath = process.cwd()) {
  let candidate = path.resolve(startPath);
  try {
    if (fs.statSync(candidate).isFile()) candidate = path.dirname(candidate);
  } catch {
    return null;
  }
  while (true) {
    if (fs.existsSync(projectConfigPath(candidate))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function readProjectConfig(projectRoot) {
  const file = projectConfigPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const config = readJson(file);
    return ["ask", "auto"].includes(config?.hooks?.mode) ? config : null;
  } catch { return null; }
}

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").replace(/^\uFEFF/u, "");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function firstString(input, keys) {
  for (const key of keys) if (typeof input[key] === "string" && input[key].trim()) return input[key].trim();
  return "";
}

function scopeId(input) {
  return firstString(input, ["run_id", "session_id", "transcript_path"]) || null;
}

function activation(prompt, mode) {
  const discussion = /\b(what\s+is|explain|tell\s+me\s+about|how\s+does|want\s+to\s+understand)\b[^\r\n]{0,120}\b(spark\s+divergence|cross[- ]?agent|multi[- ]?agent|gamespec(?::|-)?explore)\b/i.test(prompt)
    || /(?:\u4ec0\u4e48\u662f|\u89e3\u91ca|\u4ecb\u7ecd|\u60f3\u4e86\u89e3)[^\r\n]{0,60}(?:\u53d1\u6563|\u8de8\u4ee3\u7406|\u8de8\u6a21\u578b|\u591a\u4ee3\u7406|gamespec)/iu.test(prompt);
  if (discussion) return null;
  const divergence = /spark[- ]?divergence|gamespec(?::|-)?spark[- ]?divergence|\b(use|run|start|launch|perform)\b[^\r\n]{0,80}\b(cross[- ]?agent|multi[- ]?agent)\b[^\r\n]{0,80}\b(idea|creative|design|spark|divergence)\b/i.test(prompt)
    || /(?:\u4f7f\u7528|\u8fd0\u884c|\u542f\u52a8|\u8fdb\u884c|\u5f00\u542f)[^\r\n]{0,50}(?:cross[- ]?agent|multi[- ]?agent|\u8de8\u4ee3\u7406|\u8de8\u6a21\u578b|\u591a\u4ee3\u7406)[^\r\n]{0,50}(?:\u521b\u610f|\u8bbe\u8ba1|\u706b\u82b1|\u53d1\u6563)/iu.test(prompt);
  const explore = /gamespec(?::|-)?explore(?:-flow)?/i.test(prompt);
  if (divergence) return { kind: "divergence", prompt };
  if (mode === "ask" && explore) return { kind: "explore-choice", prompt };
  return null;
}

function runtimeStatePath(projectRoot, scope) {
  const key = scope ? crypto.createHash("sha256").update(scope).digest("hex").slice(0, 20) : "default";
  return path.join(projectRoot, "gamespec", ".runtime", "hook-state", `${key}.json`);
}

function writeState(projectRoot, state) {
  const file = runtimeStatePath(projectRoot, state.scope);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
  return file;
}

function clearState(projectRoot, scope) {
  const file = runtimeStatePath(projectRoot, scope);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

function emitContext(event, text) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`);
}

function emitBlock(reason) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

function peerForHost(host) {
  return host === "claude" ? "codex" : "claude";
}

function requestCommand(projectRoot, requestFile, command) {
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "gamespec-cross-agent.js").replace(/\\/gu, "/");
  return `node "${runner}" ${command} --project-root "${projectRoot.replace(/\\/gu, "/")}" --request "${requestFile.replace(/\\/gu, "/")}" --json`;
}

function recordPending(projectRoot, state, status, detail) {
  writeState(projectRoot, { ...state, pendingStatus: status, pendingDetail: detail, updatedAt: Date.now() });
}

function stopDecision(host, projectRoot, state, status, reason) {
  recordPending(projectRoot, state, status, reason);
  emitBlock(reason);
}

function handlePrompt(projectRoot, config, input, host) {
  const prompt = firstString(input, ["prompt", "user_prompt", "user_message", "message", "input"]);
  const scope = scopeId(input);
  const trigger = activation(prompt, config.hooks.mode);
  if (!trigger) { clearState(projectRoot, scope); return; }
  const now = Date.now();
  const reviewer = peerForHost(host);
  if (reviewer === host) {
    emitBlock(`[gamespec:cross-agent] Invalid cross-agent route: primary and reviewer are both ${host}. Configure the opposite agent family.`);
    return;
  }
  const state = { schemaVersion: 2, active: true, host, reviewer, sameFamily: false, projectId: config.projectId || null, scope, kind: trigger.kind, prompt, startedAt: now, expiresAt: now + (Number(config.hooks.activationTtlMs) || 21600000) };
  const requestFile = writeState(projectRoot, state);
  if (config.hooks.mode === "ask" || trigger.kind === "explore-choice") {
    emitContext("UserPromptSubmit", `[gamespec:cross-agent] This project-scoped creative turn is eligible for collaboration. Ask the user to choose solo, role-lens divergence, or cross-agent divergence. Cross-agent means ${host} -> ${state.reviewer}; a ${host} second pass must be labeled same-agent and cannot satisfy cross-agent evidence.`);
    return;
  }
  emitContext("UserPromptSubmit", `[gamespec:cross-agent] REQUIRED for this explicitly activated Spark Divergence: primary host=${host}; independent peer=${state.reviewer}. Hooks do not run long model processes. In this same task, execute:\n${requestCommand(projectRoot, requestFile, "run-request")}\nThen inspect raw.md and complete every direction in selection.md. Verify with:\n${requestCommand(projectRoot, requestFile, "check-request")}\nOutput remains runtime-non-canon. Do not write gamespec/projects or claim cross-agent completion until check-request returns complete. If the peer CLI is unavailable, report unavailable evidence; do not substitute a ${host} second pass.`);
}

function handleStop(projectRoot, config, input, host) {
  if (input.stop_hook_active === true || input.subagent_stop_hook_active === true) return;
  const scope = scopeId(input);
  const file = runtimeStatePath(projectRoot, scope);
  if (!fs.existsSync(file)) return;
  let state;
  try { state = readJson(file); } catch { clearState(projectRoot, scope); return; }
  if (!state.active || Date.now() > state.expiresAt) { clearState(projectRoot, scope); return; }
  if (state.scope && scope && state.scope !== scope) return;
  if (config.hooks.mode === "ask" || state.kind === "explore-choice") {
    clearState(projectRoot, scope);
    emitBlock("[GameSpecCrossAgent] Ask the user which creative collaboration mode to use: solo, role-lens divergence, or cross-agent divergence. Keep every result as non-canon Spark material until explicit promotion.");
    return;
  }
  let latest;
  try {
    latest = checkRequest({ projectRoot, request: file });
  } catch (error) {
    stopDecision(host, projectRoot, state, "check-failed", `[GameSpecCrossAgent] Cross-agent evidence check failed closed: ${error.message}. Repair the runtime evidence, then run:\n${requestCommand(projectRoot, file, "check-request")}`);
    return;
  }
  if (latest.status === "complete") { clearState(projectRoot, scope); return; }
  if (latest.status === "selection-required") {
    stopDecision(host, projectRoot, state, "selection-required", `[GameSpecCrossAgent] ${state.reviewer} divergence exists but primary selection is incomplete. Complete ${latest.selectionPath}; classify every direction as keep, remix, park, reject-duplicate, or needs-user. Do not write project truth.`);
    return;
  }
  stopDecision(host, projectRoot, state, latest.status || "peer-run-required", `[GameSpecCrossAgent] Required ${state.host} -> ${state.reviewer} divergence evidence is missing or unusable. Run:\n${requestCommand(projectRoot, file, "run-request")}\nThen complete selection.md and check-request. Hooks never launch the long peer process.`);
}

function hookEvent(args) {
  if (process.env.GAMESPEC_CROSS_AGENT_CHILD === "1") return;
  const input = readHookInput();
  const hintedRoot = firstString(input, ["cwd", "project_root", "projectRoot"]);
  const root = projectRoot(hintedRoot || process.cwd());
  if (!root) return;
  const config = readProjectConfig(root);
  if (!config) return;
  if (args.event === "UserPromptSubmit") handlePrompt(root, config, input, args.host);
  else handleStop(root, config, input, args.host);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") { process.stdout.write(usage()); return; }
  if (args.command === "configure") configure(args);
  else if (args.command === "hook-event") hookEvent(args);
  else adapterAction(args);
}

try { main(); } catch (error) { console.error(`gamespec-hooks: ${error.message}`); process.exitCode = 1; }
