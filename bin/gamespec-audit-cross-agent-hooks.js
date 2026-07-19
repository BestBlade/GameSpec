#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksCli = path.join(root, "bin", "gamespec-hooks.js");
const crossAgentCli = path.join(root, "bin", "gamespec-cross-agent.js");

function usage() {
  return `GameSpec cross-agent hook audit

Usage:
  gamespec-audit-cross-agent-hooks [--json]

Runs an isolated fake-reviewer proof for adapter merge safety, project opt-in,
silent defaults, session scoping, trace artifacts, and primary selection.
`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || root,
    env: options.env || process.env,
    input: options.input,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(`${path.basename(script)} ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function hook(project, env, event, input, host = "claude") {
  return runNode(hooksCli, ["hook-event", event, "--host", host], {
    cwd: project,
    env,
    input: JSON.stringify({ cwd: project, ...input }),
  });
}

function managedCount(hooks) {
  return Object.values(hooks || {}).flat().filter((entry) =>
    entry?.hooks?.some((item) => String(item.command || "").includes("gamespec-cross-agent-hook-v1"))).length;
}

function createFakeReviewer(binDir) {
  const reviewer = path.join(binDir, "fake-reviewer.js");
  fs.writeFileSync(reviewer, [
    "process.stdin.resume();",
    "process.stdin.on('end', () => process.stdout.write(`## Divergence Directions\\n| Direction ID | Direction | Core Engine | Concrete Player Action | Conflict Source | Long-Horizon Consequence | Distinctive Risk |\\n| D1 | Route memory through trade | barter | negotiate | scarcity | changing alliances | bookkeeping |\\n| D2 | Make maps decay through travel | navigation | redraw | entropy | routes disappear | frustration |\\n| D3 | Grow paths through ritual | ecology | plant | seasons | living roads | pacing |\\n| D4 | Contest maps through testimony | politics | interview | deception | disputed truth | ambiguity |\\n\\n## Sameness Check\\n| Group | Direction IDs | Same Core? | Reason | Suggested Action |\\n| A | D1,D2 | no | different player verbs | retain |\\n\\n## Frame Challenge\\n| Assumption | What Changes If False | New Possibility |\\n| permanence | routes expire | map stewardship |\\n\\n## Remix Pool\\n| Fragment | Source Direction | Why It Survives | Possible Pairing |\\n| negotiated routes | D1 | social navigation | D2 |\\n\\n## Trace And Limits\\nSynthetic audit output; it proves plumbing only.\\n`));",
  ].join("\n"), "utf8");
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "claude.cmd"), `@echo off\r\n"${process.execPath}" "${reviewer}"\r\n`, "utf8");
    fs.writeFileSync(path.join(binDir, "codex.cmd"), `@echo off\r\n"${process.execPath}" "${reviewer}"\r\n`, "utf8");
  } else {
    for (const name of ["claude", "codex"]) {
      const command = path.join(binDir, name);
      fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${reviewer}"\n`, { mode: 0o755 });
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requestFor(project, scope) {
  const root = path.join(project, "gamespec", ".runtime", "hook-state");
  const file = fs.readdirSync(root).map((name) => path.join(root, name)).find((candidate) => readJson(candidate).scope === scope);
  assert(file, `request not found for scope ${scope}`);
  return file;
}

function completeSelection(runDir) {
  fs.writeFileSync(path.join(runDir, "selection.md"), [
    "schemaVersion: 1",
    "status: complete",
    "truthBoundary: runtime-non-canon",
    "",
    "| Direction ID | Decision | Reason | Surviving Fragment | Destination Or Reopen Trigger |",
    "|---|---|---|---|---|",
    "| D1 | keep | distinct verb | negotiated routes | user review |",
    "| D2 | park | higher risk | decaying maps | prototype cadence |",
    "| D3 | remix | physical ritual survives | planted routes | user review |",
    "| D4 | needs-user | political framing needs direction | testimony layers | user choice |",
    "",
  ].join("\n"), "utf8");
}

function main() {
  const json = process.argv.includes("--json");
  if (process.argv.some((arg) => ["--help", "-h"].includes(arg))) {
    process.stdout.write(usage());
    return;
  }
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--json");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gamespec-cross-agent-audit-"));
  const project = path.join(temp, "project");
  const home = path.join(temp, "home");
  const codexHome = path.join(home, ".codex");
  const fakeBin = path.join(temp, "bin");
  fs.mkdirSync(path.join(project, "gamespec", "projects", "demo"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(project, "gamespec", "AGENTS.md"), "# Audit project\n", "utf8");
  fs.writeFileSync(path.join(project, "gamespec", "projects", "demo", "PROJECT.md"), "# Demo\n", "utf8");
  fs.writeFileSync(path.join(project, ".gitignore"), "node_modules/\n", "utf8");
  const thirdParty = { matcher: "audit", hooks: [{ type: "command", command: "third-party-hook" }] };
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), `${JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { Stop: [thirdParty] } }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(codexHome, "hooks.json"), `${JSON.stringify({ custom: "preserve", hooks: { Stop: [thirdParty] } }, null, 2)}\n`, "utf8");
  createFakeReviewer(fakeBin);

  const inheritedPath = process.env.PATH || process.env.Path || "";
  const env = {
    ...process.env,
    GAMESPEC_HOME: home,
    CODEX_HOME: codexHome,
    PATH: `${fakeBin}${path.delimiter}${inheritedPath}`,
    Path: `${fakeBin}${path.delimiter}${inheritedPath}`,
  };
  const checks = [];

  runNode(hooksCli, ["install", "--target", "both", "--json"], { env });
  runNode(hooksCli, ["install", "--target", "both", "--json"], { env });
  for (const file of [path.join(home, ".claude", "settings.json"), path.join(codexHome, "hooks.json")]) {
    const data = readJson(file);
    assert(data.hooks.Stop.some((entry) => entry.hooks?.[0]?.command === "third-party-hook"), `${file} lost third-party hook`);
    assert(managedCount(data.hooks) === 2, `${file} managed hook install was not idempotent`);
  }
  checks.push("adapter_merge_preserves_siblings_and_is_idempotent");

  runNode(hooksCli, ["configure", "--project-root", project, "--project-id", "demo", "--mode", "ask"], { env });
  assert(fs.readFileSync(path.join(project, ".gitignore"), "utf8").includes("gamespec/.runtime/"), "runtime ignore missing");
  let result = hook(project, env, "UserPromptSubmit", { session_id: "ordinary", prompt: "Help me tune the inventory." });
  assert(!result.stdout.trim(), "ordinary prompt should be silent");
  result = hook(project, env, "UserPromptSubmit", { session_id: "ask", prompt: "Use gamespec-explore for this combat idea." });
  assert(result.stdout.includes("Ask the user to choose solo, role-lens divergence, or cross-agent divergence") && result.stdout.includes("claude -> codex"), "ask-mode explore did not route to a collaboration choice");
  result = hook(project, env, "Stop", { session_id: "ask", stop_hook_active: true });
  assert(!result.stdout.trim(), "recursive Stop event should be suppressed");
  result = hook(project, env, "Stop", { session_id: "ask", stop_hook_active: false });
  assert(result.stdout.includes("solo, role-lens divergence, or cross-agent divergence"), "ask mode did not request a collaboration choice");
  checks.push("non_git_project_opt_in_ask_mode_and_stop_suppression");

  runNode(hooksCli, ["configure", "--project-root", project, "--project-id", "demo", "--mode", "auto", "--pass-env", "ANTHROPIC_AUTH_TOKEN"], { env });
  runNode(hooksCli, ["configure", "--project-root", project, "--project-id", "demo", "--mode", "auto", "--pass-env", "ANTHROPIC_BASE_URL"], { env });
  const configuredPassEnv = readJson(path.join(project, "gamespec", ".cross-agent.json")).passEnv;
  assert(configuredPassEnv.includes("ANTHROPIC_AUTH_TOKEN") && configuredPassEnv.includes("ANTHROPIC_BASE_URL"), "reconfigure replaced existing passEnv entries");
  result = hook(project, env, "UserPromptSubmit", { session_id: "plain-explore", prompt: "Use gamespec-explore for this combat idea." });
  assert(!result.stdout.trim(), "auto mode should not trigger on plain explore");
  result = hook(project, env, "UserPromptSubmit", { session_id: "codex-primary", prompt: "使用跨代理进行创意发散，为地图系统提出不同核心。" }, "codex");
  assert(result.stdout.includes("primary host=codex; independent peer=claude") && result.stdout.includes("run-request"), "Codex host did not receive a Claude peer request");
  const codexRequest = requestFor(project, "codex-primary");
  result = hook(project, env, "Stop", { session_id: "codex-primary", stop_hook_active: false }, "codex");
  assert(result.stdout.includes('"decision":"block"') && readJson(codexRequest).pendingStatus, "Codex Stop must continue the turn and record pending peer work");
  const runsRoot = path.join(project, "gamespec", ".runtime", "cross-agent");
  fs.writeFileSync(runsRoot, "not-a-directory", "utf8");
  result = hook(project, env, "Stop", { session_id: "codex-primary", stop_hook_active: false }, "codex");
  assert(result.stdout.includes('"decision":"block"') && readJson(codexRequest).pendingStatus === "check-failed", "Codex Stop must fail closed when evidence checking throws");
  fs.rmSync(runsRoot, { force: true });
  result = runNode(crossAgentCli, ["run-request", "--project-root", project, "--request", codexRequest, "--json"], { env });
  const codexRunResult = JSON.parse(result.stdout);
  assert(codexRunResult.status === "selection-required", "Codex primary did not launch the Claude request");

  const runDirs = fs.readdirSync(runsRoot).filter((name) => fs.statSync(path.join(runsRoot, name)).isDirectory());
  assert(runDirs.length === 1, "expected exactly one auxiliary run");
  const runDir = path.join(runsRoot, runDirs[0]);
  const run = readJson(path.join(runDir, "run.json"));
  assert(run.reviewerStatus === "success" && run.outputStructured === true, "fake reviewer output was not accepted");
  assert(run.runner === "gamespec-cross-agent/v3" && run.action === "diverge" && run.primaryHost === "codex" && run.reviewer === "claude" && run.sameFamily === false && run.evidenceHashes?.raw && run.contextFingerprint && Array.isArray(run.contextManifest), "Codex -> Claude provenance is incomplete");
  assert(run.contextFiles.includes("gamespec/AGENTS.md"), "packet context trace missing");
  result = hook(project, env, "Stop", { session_id: "codex-primary", stop_hook_active: false }, "codex");
  assert(result.stdout.includes('"decision":"block"') && readJson(codexRequest).pendingStatus === "selection-required", "Codex incomplete selection must remain a durable continuation state");
  assert(fs.readdirSync(runsRoot).length === 1, "Stop retry created a duplicate run");
  completeSelection(runDir);
  result = runNode(crossAgentCli, ["check-request", "--project-root", project, "--request", codexRequest, "--json"], { env });
  assert(JSON.parse(result.stdout).status === "complete", "Codex -> Claude selection was not accepted");
  result = hook(project, env, "Stop", { session_id: "codex-primary", stop_hook_active: false }, "codex");
  assert(!result.stdout.trim() && !fs.existsSync(codexRequest), "completed Codex request should clear silently");
  checks.push("codex_to_claude_file_coupled_request_and_stop_continuation");

  result = hook(project, env, "UserPromptSubmit", { session_id: "claude-primary", prompt: "Use Spark Divergence with a cross-agent for a memory clock design." }, "claude");
  assert(result.stdout.includes("primary host=claude; independent peer=codex"), "Claude host did not receive a Codex peer request");
  const claudeRequest = requestFor(project, "claude-primary");
  result = runNode(crossAgentCli, ["run-request", "--project-root", project, "--request", claudeRequest, "--json"], { env });
  const claudeRunResult = JSON.parse(result.stdout);
  const claudeRun = readJson(path.join(claudeRunResult.runDir, "run.json"));
  assert(claudeRun.primaryHost === "claude" && claudeRun.reviewer === "codex" && claudeRun.sameFamily === false, "Claude -> Codex route is not independent");
  result = hook(project, env, "Stop", { session_id: "claude-primary", stop_hook_active: false }, "claude");
  assert(result.stdout.includes('"decision":"block"') && readJson(claudeRequest).pendingStatus === "selection-required", "Claude Stop must preserve durable pending state before selection");
  completeSelection(claudeRunResult.runDir);
  result = runNode(crossAgentCli, ["check-request", "--project-root", project, "--request", claudeRequest, "--json"], { env });
  assert(JSON.parse(result.stdout).status === "complete", "Claude -> Codex selection was not accepted");
  result = hook(project, env, "Stop", { session_id: "claude-primary", stop_hook_active: false }, "claude");
  assert(!result.stdout.trim() && !fs.existsSync(claudeRequest), "completed Claude request should release Stop");
  checks.push("claude_to_codex_file_coupled_request");

  const forgedDir = path.join(runsRoot, "20990101T000000000Z-claude-divergence");
  fs.mkdirSync(forgedDir, { recursive: true });
  fs.writeFileSync(path.join(forgedDir, "run.json"), `${JSON.stringify({ schemaVersion: 1, runner: "gamespec-cross-agent/v2", reviewerStatus: "success", outputStructured: true }, null, 2)}\n`, "utf8");
  result = runNode(crossAgentCli, ["check-latest", "--project-root", project, "--json"], { env });
  assert(JSON.parse(result.stdout).runDir === claudeRunResult.runDir, "unproven newer runtime directory shadowed authenticated evidence");
  checks.push("forged_runtime_evidence_rejected");

  result = runNode(hooksCli, ["hook-event", "UserPromptSubmit", "--host", "claude"], {
    cwd: project,
    env: { ...env, GAMESPEC_CROSS_AGENT_CHILD: "1" },
    input: JSON.stringify({ cwd: project, session_id: "child", prompt: "spark divergence" }),
  });
  assert(!result.stdout.trim(), "auxiliary child process was not suppressed");
  checks.push("recursive_child_suppression");

  runNode(hooksCli, ["uninstall", "--target", "both", "--json"], { env });
  for (const file of [path.join(home, ".claude", "settings.json"), path.join(codexHome, "hooks.json")]) {
    const data = readJson(file);
    assert(managedCount(data.hooks) === 0, `${file} retained managed hooks after uninstall`);
    assert(data.hooks.Stop.some((entry) => entry.hooks?.[0]?.command === "third-party-hook"), `${file} lost third-party hook on uninstall`);
  }
  checks.push("uninstall_preserves_siblings");

  const report = { state: "pass", mode: "isolated_fake_reviewer", checks, tempRoot: temp };
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `GameSpec cross-agent hook audit: pass (${checks.length} checks)\n`);
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-cross-agent-hooks: ${error.message}`);
  process.exitCode = 1;
}
