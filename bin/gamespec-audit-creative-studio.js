#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studioCli = path.join(root, "bin", "gamespec-creative-studio.js");
const crossAgentCli = path.join(root, "bin", "gamespec-cross-agent.js");

function usage() {
  return `GameSpec Creative Studio audit

Usage:
  gamespec-audit-creative-studio [--json]

Runs isolated fake-reviewer fixtures for unique direction coverage, task
contracts, explicit context, stale detection, bounded resumable sessions,
curation, recovery, and the project-truth write boundary.
`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const expected = options.expectedStatus ?? 0;
  if (result.status !== expected) throw new Error(`${path.basename(script)} ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`);
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function treeManifest(rootDir) {
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows.push({ path: path.relative(rootDir, file).replace(/\\/gu, "/"), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) });
    }
  }
  walk(rootDir);
  return rows;
}

function createFakeReviewer(binDir) {
  const reviewer = path.join(binDir, "fake-reviewer.js");
  const block = [
    "## Divergence Directions",
    "| Direction ID | Direction | Core Engine | Concrete Player Action | Conflict Source | Long-Horizon Consequence | Distinctive Risk |",
    "| D1 | Trade memories | barter | negotiate | scarcity | changing alliances | bookkeeping |",
    "| D2 | Decaying maps | navigation | redraw | entropy | disappearing routes | frustration |",
    "| D3 | Living roads | ecology | plant | seasons | migrating settlements | pacing |",
    "| D4 | Contested testimony | politics | interview | deception | disputed truth | ambiguity |",
    "",
    "## Sameness Check",
    "| Group | Direction IDs | Same Core? | Reason | Suggested Action |",
    "| A | D1,D2 | no | different verbs | retain |",
    "",
    "## Frame Challenge",
    "| Assumption | What Changes If False | New Possibility |",
    "| permanence | routes expire | map stewardship |",
    "",
    "## Remix Pool",
    "| Fragment | Source Direction | Why It Survives | Possible Pairing |",
    "| negotiated routes | D1 | social navigation | D2 |",
    "",
    "## Trace And Limits",
    "Synthetic fixture; it proves plumbing only.",
  ].join("\n");
  const deepenBlock = block.split("\n").filter((line) => !line.startsWith("| D3 |") && !line.startsWith("| D4 |")).join("\n");
  const reviewerSource = [
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { input += chunk; });',
    `process.stdin.on("end", () => process.stdout.write(input.includes(${JSON.stringify("Action: `deepen`")}) ? ${JSON.stringify(`${deepenBlock}\n\n${deepenBlock}\n`)} : ${JSON.stringify(`${block}\n\n${block}\n`)}));`,
    "",
  ].join("\n");
  fs.writeFileSync(reviewer, reviewerSource, "utf8");
  if (process.platform === "win32") {
    for (const name of ["claude", "codex"]) fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${reviewer}"\r\n`, "utf8");
  } else {
    for (const name of ["claude", "codex"]) {
      const command = path.join(binDir, name);
      fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${reviewer}"\n`, { mode: 0o755 });
    }
  }
}

function completeSelection(file, status = "complete") {
  const text = fs.readFileSync(file, "utf8")
    .replace(/^status:\s*template$/mu, `status: ${status}`)
    .replace(/keep \/ remix \/ park \/ reject-duplicate \/ needs-user/gu, "keep")
    .replace(/\| keep \|\s*\|\s*\|\s*\|/gu, "| keep | distinct core | surviving fragment | human curation |");
  fs.writeFileSync(file, text, "utf8");
}

function jsonResult(result) {
  return JSON.parse(result.stdout);
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) { process.stdout.write(usage()); return; }
  const json = process.argv.includes("--json");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gamespec-creative-studio-audit-"));
  const project = path.join(tempRoot, "project");
  const binDir = path.join(tempRoot, "bin");
  const projectTruth = path.join(project, "gamespec", "projects", "demo");
  fs.mkdirSync(projectTruth, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(project, "gamespec", "AGENTS.md"), "GameSpec contract\n", "utf8");
  fs.writeFileSync(path.join(project, "gamespec", "config.yaml"), "gamespec:\n  mode: semi-auto\n", "utf8");
  fs.writeFileSync(path.join(projectTruth, "active.md"), "# Active\n", "utf8");
  fs.writeFileSync(path.join(projectTruth, ".gamespec-state.yaml"), "project: demo\n", "utf8");
  fs.writeFileSync(path.join(projectTruth, "source.md"), "A market built on borrowed shadows.\n", "utf8");
  fs.writeFileSync(path.join(project, "gamespec", ".cross-agent.json"), `${JSON.stringify({ schemaVersion: 1, reviewer: "auto", packetOnly: true, projectId: "demo", hooks: { mode: "off" } }, null, 2)}\n`, "utf8");
  createFakeReviewer(binDir);
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` };
  const checks = [];
  const beforeTruth = treeManifest(path.join(project, "gamespec", "projects"));

  let result = runNode(crossAgentCli, ["run", "--project-root", project, "--prompt", "Read `gamespec/projects/demo/source.md` and write `gamespec/projects/demo/output.md`.", "--primary-host", "codex", "--reviewer", "claude", "--json"], { env, expectedStatus: 2 });
  assert(jsonResult(result).status === "task-contract-mismatch" && jsonResult(result).invoked === false, "repo-writing packet task did not fail closed");
  assert(!fs.existsSync(path.join(project, "gamespec", ".runtime", "cross-agent")), "task-contract mismatch invoked or created a reviewer run");
  checks.push("packet_only_repo_write_request_fails_before_invocation");

  result = runNode(studioCli, ["start", "--project-root", project, "--project-id", "demo", "--prompt", "Invent different playable economies for borrowed shadows.", "--context-file", "gamespec/projects/demo/source.md", "--action", "diverge", "--primary-host", "codex", "--reviewer", "claude", "--max-rounds", "3", "--json"], { env });
  const started = jsonResult(result);
  const sessionDir = started.sessionDir;
  let state = readJson(path.join(sessionDir, "state.json"));
  const selected = state.contextManifest.find((item) => item.path === "gamespec/projects/demo/source.md");
  assert(started.status === "round-required" && selected && selected.sha256 && selected.clipped === false, "explicit context was not hash-bound at start");
  checks.push("explicit_context_manifest_is_project_bounded_and_hash_bound");

  result = runNode(studioCli, ["run", "--project-root", project, "--session", sessionDir, "--json"], { env });
  assert(jsonResult(result).studioStatus === "selection-required", "first studio round did not reach selection-required");
  state = readJson(path.join(sessionDir, "state.json"));
  let runDir = path.resolve(project, state.activeRun.runDir);
  let selectionFile = path.join(runDir, "selection.md");
  assert((fs.readFileSync(selectionFile, "utf8").match(/^\| D\d+ \|/gmu) || []).length === 4, "duplicate reviewer stdout inflated the selection template");
  completeSelection(selectionFile, "completed");
  result = runNode(crossAgentCli, ["check-latest", "--project-root", project, "--json"], { env });
  const compatibility = jsonResult(result);
  assert(compatibility.status === "complete" && compatibility.selection.requiredRows === 4 && compatibility.selection.statusRaw === "completed", "unique IDs or legacy completed compatibility failed");
  checks.push("duplicate_stdout_uses_unique_direction_ids_and_legacy_completed_normalizes");
  const compatibleSelectionText = fs.readFileSync(selectionFile, "utf8");
  fs.appendFileSync(selectionFile, "\n| D99 | keep | forged extra direction | none | none |\n", "utf8");
  result = runNode(crossAgentCli, ["check-latest", "--project-root", project, "--json"], { env, expectedStatus: 4 });
  assert(jsonResult(result).status === "selection-required" && jsonResult(result).selection.unexpectedIds.includes("D99"), "unexpected selection IDs did not fail exact coverage");
  fs.writeFileSync(selectionFile, compatibleSelectionText, "utf8");
  checks.push("unexpected_selection_ids_fail_exact_coverage");
  fs.writeFileSync(selectionFile, compatibleSelectionText.replace("| D1 | keep | distinct core |", "| D1 | keep |  |"), "utf8");
  result = runNode(crossAgentCli, ["check-latest", "--project-root", project, "--json"], { env, expectedStatus: 4 });
  assert(jsonResult(result).status === "selection-required" && jsonResult(result).selection.incompleteIds.includes("D1"), "a direction decision without a reason was accepted as complete");
  fs.writeFileSync(selectionFile, compatibleSelectionText, "utf8");
  checks.push("selection_reason_is_required_for_curation_trace");

  result = runNode(studioCli, ["recover-previous", "--project-root", project, "--session", sessionDir, "--reason", "prove interruption recovery", "--json"], { env });
  assert(jsonResult(result).status === "round-required", "previous-state recovery did not restore the pre-run state");
  state = readJson(path.join(sessionDir, "state.json"));
  assert(state.rounds.length === 0 && state.activeRun === null, "recovery invented completed role evidence");
  checks.push("previous_state_recovery_restores_without_inventing_evidence");

  result = runNode(studioCli, ["run", "--project-root", project, "--session", sessionDir, "--json"], { env });
  state = readJson(path.join(sessionDir, "state.json"));
  runDir = path.resolve(project, state.activeRun.runDir);
  selectionFile = path.join(runDir, "selection.md");
  completeSelection(selectionFile);
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", sessionDir, "--decision", "continue", "--next-action", "deepen", "--reason", "deepen the distinct cores", "--json"], { env });
  assert(jsonResult(result).status === "round-required" && jsonResult(result).rounds === 1, "continue did not commit the exact completed round");

  state = readJson(path.join(sessionDir, "state.json"));
  const committedSelection = path.resolve(project, state.rounds[0].selectionPath);
  const committedSelectionText = fs.readFileSync(committedSelection, "utf8");
  const runCountBeforeDrift = fs.readdirSync(path.join(project, "gamespec", ".runtime", "cross-agent")).length;
  fs.appendFileSync(committedSelection, "\npost-commit drift\n", "utf8");
  result = runNode(studioCli, ["run", "--project-root", project, "--session", sessionDir, "--json"], { env, expectedStatus: 3 });
  assert(jsonResult(result).status === "stale" && jsonResult(result).evidenceErrors.some((item) => item.includes("selection identity drifted")), "committed round drift did not stop before the next peer invocation");
  assert(fs.readdirSync(path.join(project, "gamespec", ".runtime", "cross-agent")).length === runCountBeforeDrift, "a peer run started after committed evidence drift");
  fs.writeFileSync(committedSelection, committedSelectionText, "utf8");
  result = runNode(studioCli, ["reopen", "--project-root", project, "--session", sessionDir, "--next-action", "deepen", "--reason", "restore the exact committed selection before continuing", "--json"], { env });
  assert(jsonResult(result).status === "round-required", "restored committed evidence could not be explicitly reopened");
  checks.push("committed_round_drift_stops_before_next_peer_run");

  result = runNode(studioCli, ["run", "--project-root", project, "--session", sessionDir, "--json"], { env });
  state = readJson(path.join(sessionDir, "state.json"));
  runDir = path.resolve(project, state.activeRun.runDir);
  selectionFile = path.join(runDir, "selection.md");
  assert((fs.readFileSync(selectionFile, "utf8").match(/^\| D\d+ \|/gmu) || []).length === 2, "deepen action did not accept its action-specific two-direction minimum");
  completeSelection(selectionFile);
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", sessionDir, "--decision", "curate", "--reason", "prepare the portfolio for human judgment", "--json"], { env });
  const curated = jsonResult(result);
  assert(curated.status === "curation-ready" && curated.rounds === 2 && fs.existsSync(path.join(sessionDir, "curation.md")), "curation did not preserve the two-round portfolio");
  result = runNode(studioCli, ["check", "--project-root", project, "--session", sessionDir, "--json"], { env });
  assert(jsonResult(result).status === "verified", "current Creative Studio carrier did not verify");
  checks.push("action_specific_direction_minimum_accepts_focused_deepening");
  checks.push("bounded_multi_round_deepen_and_curation_verifies");

  result = runNode(studioCli, ["start", "--project-root", project, "--project-id", "demo", "--prompt", "Test the finite round stop.", "--context-file", "gamespec/projects/demo/source.md", "--action", "diverge", "--primary-host", "codex", "--reviewer", "claude", "--max-rounds", "1", "--json"], { env });
  const limitSessionDir = jsonResult(result).sessionDir;
  result = runNode(studioCli, ["run", "--project-root", project, "--session", limitSessionDir, "--json"], { env });
  state = readJson(path.join(limitSessionDir, "state.json"));
  completeSelection(path.join(path.resolve(project, state.activeRun.runDir), "selection.md"));
  const sourceBeforeAdvanceDrift = fs.readFileSync(path.join(projectTruth, "source.md"), "utf8");
  fs.appendFileSync(path.join(projectTruth, "source.md"), "Context changes before advance.\n", "utf8");
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", limitSessionDir, "--decision", "continue", "--next-action", "deepen", "--reason", "attempt against changed context", "--json"], { env, expectedStatus: 3 });
  state = readJson(path.join(limitSessionDir, "state.json"));
  assert(jsonResult(result).status === "stale" && state.rounds.length === 0, "context drift between run and advance committed stale evidence");
  fs.writeFileSync(path.join(projectTruth, "source.md"), sourceBeforeAdvanceDrift, "utf8");
  result = runNode(studioCli, ["reopen", "--project-root", project, "--session", limitSessionDir, "--next-action", "diverge", "--reason", "restore the original context before a replacement run", "--json"], { env });
  result = runNode(studioCli, ["run", "--project-root", project, "--session", limitSessionDir, "--json"], { env });
  state = readJson(path.join(limitSessionDir, "state.json"));
  completeSelection(path.join(path.resolve(project, state.activeRun.runDir), "selection.md"));
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", limitSessionDir, "--decision", "continue", "--next-action", "deepen", "--reason", "attempt another purposeful pass", "--json"], { env });
  assert(jsonResult(result).status === "needs-user" && jsonResult(result).rounds === 1, "maximum round budget did not stop automatic continuation");
  checks.push("context_drift_between_run_and_advance_stops_commit");
  checks.push("maximum_round_budget_stops_for_user");
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", limitSessionDir, "--decision", "curate", "--reason", "resolve the exhausted budget for human curation", "--json"], { env });
  assert(jsonResult(result).status === "curation-ready" && jsonResult(result).rounds === 1, "exhausted budget could not resolve without inventing another round");
  result = runNode(studioCli, ["check", "--project-root", project, "--session", limitSessionDir, "--json"], { env });
  assert(jsonResult(result).status === "verified", "limit-resolved curation did not verify");
  checks.push("exhausted_budget_resolves_to_curation_without_new_round");

  result = runNode(studioCli, ["start", "--project-root", project, "--project-id", "demo", "--prompt", "Test park and abandon transitions.", "--context-file", "gamespec/projects/demo/source.md", "--action", "diverge", "--primary-host", "codex", "--reviewer", "claude", "--max-rounds", "2", "--json"], { env });
  const parkSessionDir = jsonResult(result).sessionDir;
  result = runNode(studioCli, ["run", "--project-root", project, "--session", parkSessionDir, "--json"], { env });
  state = readJson(path.join(parkSessionDir, "state.json"));
  completeSelection(path.join(path.resolve(project, state.activeRun.runDir), "selection.md"));
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", parkSessionDir, "--decision", "park", "--reason", "preserve the first portfolio", "--json"], { env });
  assert(jsonResult(result).status === "parked", "park did not stop with a curation carrier");
  result = runNode(studioCli, ["reopen", "--project-root", project, "--session", parkSessionDir, "--next-action", "contrast", "--reason", "test a deliberate reopened lineage", "--json"], { env });
  state = readJson(path.join(parkSessionDir, "state.json"));
  assert(jsonResult(result).status === "round-required" && state.curation === undefined && state.curationHistory.length === 1, "reopen did not archive the superseded curation carrier");
  result = runNode(studioCli, ["run", "--project-root", project, "--session", parkSessionDir, "--json"], { env });
  state = readJson(path.join(parkSessionDir, "state.json"));
  completeSelection(path.join(path.resolve(project, state.activeRun.runDir), "selection.md"));
  result = runNode(studioCli, ["advance", "--project-root", project, "--session", parkSessionDir, "--decision", "abandon", "--reason", "prove an explicit terminal stop", "--json"], { env });
  assert(jsonResult(result).status === "abandoned" && jsonResult(result).rounds === 2, "abandon did not stop the reopened session");
  result = runNode(studioCli, ["check", "--project-root", project, "--session", parkSessionDir, "--json"], { env });
  assert(jsonResult(result).status === "verified", "park/reopen/abandon lineage did not verify");
  checks.push("park_reopen_archives_curation_and_abandon_verifies");

  fs.appendFileSync(path.join(projectTruth, "source.md"), "The source changes.\n", "utf8");
  result = runNode(studioCli, ["check", "--project-root", project, "--session", sessionDir, "--json"], { env, expectedStatus: 3 });
  assert(jsonResult(result).status === "stale", "selected context drift did not invalidate the studio carrier");
  result = runNode(studioCli, ["reopen", "--project-root", project, "--session", sessionDir, "--next-action", "contrast", "--reason", "inspect the changed source", "--json"], { env });
  assert(jsonResult(result).status === "round-required", "curation-ready session did not reopen");
  result = runNode(studioCli, ["run", "--project-root", project, "--session", sessionDir, "--json"], { env, expectedStatus: 3 });
  assert(jsonResult(result).status === "stale", "run did not stop before invoking against stale context");
  result = runNode(studioCli, ["reopen", "--project-root", project, "--session", sessionDir, "--next-action", "contrast", "--reason", "accept the new source as a fresh creative lineage", "--json"], { env });
  assert(jsonResult(result).status === "round-required", "stale context could not be explicitly refreshed");
  checks.push("context_drift_stops_run_and_requires_reason_bound_refresh");

  result = runNode(studioCli, ["start", "--project-root", project, "--project-id", "demo", "--prompt", "state identity fixture", "--context-file", "gamespec/projects/demo/source.md", "--json"], { env });
  const identityStateFile = path.join(jsonResult(result).sessionDir, "state.json");
  const identityStateText = fs.readFileSync(identityStateFile, "utf8");
  const forgedIdentityState = JSON.parse(identityStateText);
  forgedIdentityState.projectRoot = tempRoot;
  fs.writeFileSync(identityStateFile, `${JSON.stringify(forgedIdentityState, null, 2)}\n`, "utf8");
  result = runNode(studioCli, ["status", "--project-root", project, "--session", path.dirname(identityStateFile), "--json"], { env, expectedStatus: 1 });
  assert(result.stderr.includes("project identity mismatch"), "forged Studio project identity was accepted");
  fs.writeFileSync(identityStateFile, identityStateText, "utf8");
  checks.push("forged_state_cannot_redirect_project_identity");

  const outside = path.join(tempRoot, "outside.md");
  fs.writeFileSync(outside, "outside", "utf8");
  result = runNode(studioCli, ["start", "--project-root", project, "--prompt", "escape", "--context-file", outside, "--json"], { env, expectedStatus: 1 });
  assert(result.stderr.includes("escapes project root"), "context path escape was not rejected");
  checks.push("context_path_escape_is_rejected");

  const large = path.join(projectTruth, "large.md");
  fs.writeFileSync(large, "x".repeat(140000), "utf8");
  result = runNode(studioCli, ["start", "--project-root", project, "--project-id", "demo", "--prompt", "clip", "--context-file", "gamespec/projects/demo/large.md", "--json"], { env });
  const clippedState = readJson(path.join(jsonResult(result).sessionDir, "state.json"));
  const clipped = clippedState.contextManifest.find((item) => item.path === "gamespec/projects/demo/large.md");
  assert(clipped?.clipped === true && clipped.includedBytes < clipped.bytes, "large explicit context did not expose clipping");
  checks.push("context_clipping_is_explicit");

  const afterTruth = treeManifest(path.join(project, "gamespec", "projects"));
  const expectedTruth = beforeTruth.map((item) => item.path).includes("demo/source.md") ? afterTruth.filter((item) => !["demo/large.md"].includes(item.path)) : afterTruth;
  assert(!afterTruth.some((item) => item.path === "demo/output.md"), "Creative Studio wrote the requested project output");
  assert(expectedTruth.some((item) => item.path === "demo/source.md"), "project truth fixture unexpectedly disappeared");
  checks.push("runtime_never_writes_requested_project_output");

  const report = { state: "pass", mode: "isolated_fake_reviewer", checks, tempRoot };
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`GameSpec Creative Studio audit: pass (${checks.length} checks)\n`);
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-creative-studio: ${error.message}`);
  process.exitCode = 1;
}
