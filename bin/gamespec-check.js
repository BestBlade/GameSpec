#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

const PHASES = new Set(["proposal", "apply", "verify", "archive"]);
const RESULT_VALUES = new Set(["pass", "fail", "drift", "fallback", "blocked"]);
const RECOMMENDED_NEXT_VALUES = new Set(["continue", "archive", "handoff", "re-open-intent", "stop"]);
const DIRECTION_STATUSES = new Set(["candidate", "promoted", "parked", "rejected"]);

const REQUIRED_PROPOSAL_ANCHORS = [
  "## Intent",
  "## Boundary",
  "## Truth Boundary",
  "## Evidence Required",
  "## Stop Conditions",
  "## Decision Ledger",
  "## Risk Routing",
  "## Attention Report"
];

const REQUIRED_EVIDENCE_FIELDS = [
  "Proof Command",
  "Result",
  "Output Summary",
  "Coverage Limit",
  "Linked Decisions",
  "Fallback",
  "Accepted Debt"
];

const REQUIRED_TRUST_FIELDS = [
  "Change",
  "Intent Match",
  "Evidence Credibility",
  "Risk Routing Review",
  "Debt/Fallback Visibility",
  "Recommended Next"
];

const REQUIRED_ARCHIVE_ANCHORS = [
  "## Final Decisions",
  "## Intent Match",
  "## Evidence Summary",
  "## Accepted Debt And Fallback",
  "## Drift And Re-Slice Events",
  "## Human Decisions",
  "## Durable Truth Gates",
  "## Follow-Up And Re-Open Triggers"
];

const DIRECTION_MAP_FIELDS = [
  "Direction",
  "Status",
  "Basis",
  "Evidence Needed",
  "Reopen Trigger"
];

const EVIDENCE_CONTRACT_FIELDS = [
  "Claim",
  "Support Required",
  "Falsifier",
  "Source Label",
  "Coverage Limit",
  "Status"
];

const SELECTION_FINDING_ANCHORS = [
  "## Selection Findings",
  "### Promoted Direction",
  "### Parked Directions",
  "### Rejected Directions",
  "### Missing Evidence",
  "### Human-Owned Decisions",
  "### Independence Limit"
];

function usage(exitCode = 0) {
  const text = `GameSpec change structure check

Usage:
  node bin/gamespec-check.js [change-id-or-path] [--project <project-root>] [--phase proposal|apply|verify|archive] [--substrate docs] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Checks docs-mode change structure and optional capability-lane artifacts.
  - Does not validate semantic truth, design quality, or independent review.
  - Does not replace GameSpec project status, proposal, apply, review, or archive entrypoints.
  - OpenSpec-backed changes should be checked by OpenSpec's own lifecycle.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    format: "markdown",
    phase: "proposal",
    substrate: "docs",
    project: resolvePackageRootFromBin(import.meta.url)
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--change") {
      args.change = argv[++i];
    } else if (arg === "--phase") {
      args.phase = argv[++i];
    } else if (arg === "--substrate") {
      args.substrate = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg.startsWith("--")) {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    } else {
      positionals.push(arg);
    }
  }

  if (!args.change && positionals.length > 0) args.change = positionals[0];
  if (!["markdown", "json"].includes(args.format)) throw new Error(`Unsupported --format: ${args.format}`);
  if (!PHASES.has(args.phase)) throw new Error(`Unsupported --phase: ${args.phase}`);
  if (args.substrate !== "docs") throw new Error(`Unsupported --substrate: ${args.substrate}. Use the owning substrate checker.`);
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

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
}

function result(severity, code, file, message) {
  return { severity, code, file, message };
}

function addError(results, code, file, message) {
  results.push(result("error", code, file, message));
}

function addWarning(results, code, file, message) {
  results.push(result("warning", code, file, message));
}

function hasErrors(results) {
  return results.some((item) => item.severity === "error");
}

function hasWarnings(results) {
  return results.some((item) => item.severity === "warning");
}

function hasSchemaVersion(text) {
  return /^schemaVersion:\s*1\s*$/mu.test(text);
}

function hasAnchor(text, anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*$`, "mu").test(text);
}

function sectionText(text, anchor) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === anchor);
  if (start === -1) return "";
  const level = anchor.match(/^#+/u)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s+/u);
    if (match && match[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function hasField(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\|\\s*${escaped}\\s*\\|`, "iu").test(text);
}

function fieldValue(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "imu"));
  return match ? match[1].trim() : "";
}

function checkedTaskCount(tasksText) {
  if (!tasksText) return 0;
  return (tasksText.match(/^\s*-\s*\[[xX]\]\s+/gmu) || []).length;
}

function markdownTable(text) {
  const lines = text.split(/\r?\n/u).filter((line) => /^\s*\|.*\|\s*$/u.test(line));
  for (let i = 0; i < lines.length; i += 1) {
    const header = splitTableRow(lines[i]);
    if (header.length === 0) continue;
    const separator = lines[i + 1] ? splitTableRow(lines[i + 1]) : [];
    if (separator.length === header.length && separator.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))) {
      return {
        header,
        rows: lines.slice(i + 2).map(splitTableRow).filter((row) => row.length === header.length)
      };
    }
  }
  return { header: [], rows: [] };
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

function checkSchema(text, file, results) {
  if (!hasSchemaVersion(text)) {
    addWarning(results, "DOCS_SCHEMA_MISSING", file, `${file} has no schemaVersion: 1 marker; treating it as legacy input.`);
  }
}

function checkRequiredAnchors(text, file, anchors, results, codePrefix) {
  for (const anchor of anchors) {
    if (!hasAnchor(text, anchor)) {
      addError(results, `${codePrefix}_MISSING_ANCHOR`, file, `Missing required anchor: ${anchor}`);
      continue;
    }
    if (!sectionText(text, anchor)) {
      addError(results, `${codePrefix}_EMPTY_SECTION`, file, `Required section is empty: ${anchor}`);
    }
  }
}

function validateProposal(changeDir, results) {
  const proposalPath = path.join(changeDir, "proposal.md");
  const proposal = readIfExists(proposalPath);
  if (proposal === null) {
    addError(results, "DOCS_PROPOSAL_MISSING_FILE", "proposal.md", "proposal.md is required.");
    return;
  }
  checkSchema(proposal, "proposal.md", results);
  checkRequiredAnchors(proposal, "proposal.md", REQUIRED_PROPOSAL_ANCHORS, results, "DOCS_PROPOSAL");
  validateMainlineDecision(proposal, "proposal.md", results);
}

function validateApply(changeDir, results) {
  validateProposal(changeDir, results);
  const tasks = readIfExists(path.join(changeDir, "tasks.md"));
  if (tasks !== null) checkSchema(tasks, "tasks.md", results);
  if (checkedTaskCount(tasks) === 0) {
    validateCapabilityLane(changeDir, results);
    return;
  }

  const evidence = readIfExists(path.join(changeDir, "evidence.md"));
  if (evidence === null) {
    addError(results, "DOCS_EVIDENCE_MISSING_FILE", "evidence.md", "Completed tasks require evidence.md.");
    validateCapabilityLane(changeDir, results);
    return;
  }
  checkSchema(evidence, "evidence.md", results);
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!hasField(evidence, field)) {
      addError(results, "DOCS_EVIDENCE_MISSING_FIELD", "evidence.md", `Missing required evidence field: ${field}`);
    }
  }
  const evidenceResult = fieldValue(evidence, "Result");
  if (evidenceResult && !RESULT_VALUES.has(evidenceResult)) {
    addError(results, "DOCS_EVIDENCE_INVALID_RESULT", "evidence.md", `Evidence Result must be one of: ${Array.from(RESULT_VALUES).join(", ")}`);
  }
  validateCapabilityLane(changeDir, results);
}

function validateVerify(changeDir, results) {
  validateApply(changeDir, results);
  const trust = readIfExists(path.join(changeDir, "trust-checkpoint.md"));
  if (trust === null) {
    addError(results, "DOCS_TRUST_MISSING_FILE", "trust-checkpoint.md", "trust-checkpoint.md is required for verify/archive.");
    return;
  }
  checkSchema(trust, "trust-checkpoint.md", results);
  for (const field of REQUIRED_TRUST_FIELDS) {
    if (!hasField(trust, field)) {
      addError(results, "DOCS_TRUST_MISSING_FIELD", "trust-checkpoint.md", `Missing required trust-checkpoint field: ${field}`);
    }
  }
  const recommendedNext = fieldValue(trust, "Recommended Next");
  if (recommendedNext && !RECOMMENDED_NEXT_VALUES.has(recommendedNext)) {
    addError(results, "DOCS_TRUST_INVALID_RECOMMENDED_NEXT", "trust-checkpoint.md", `Recommended Next must be one of: ${Array.from(RECOMMENDED_NEXT_VALUES).join(", ")}`);
  }
}

function validateArchive(changeDir, results) {
  validateVerify(changeDir, results);
  const archive = readIfExists(path.join(changeDir, "archive.md"));
  if (archive === null) {
    addError(results, "DOCS_ARCHIVE_MISSING_FILE", "archive.md", "archive.md is required for archive.");
    return;
  }
  checkSchema(archive, "archive.md", results);
  checkRequiredAnchors(archive, "archive.md", REQUIRED_ARCHIVE_ANCHORS, results, "DOCS_ARCHIVE");
  validateMainlineDecision(archive, "archive.md", results);

  const evidenceSummary = sectionText(archive, "## Evidence Summary");
  const debtAsProof = evidenceSummary
    .split(/\r?\n/u)
    .some((line) => /\b(fallback|accepted debt|debt)\b/iu.test(line) && /\b(proof|proved|proves|verified|pass|passed)\b/iu.test(line));
  if (debtAsProof) {
    addError(
      results,
      "DOCS_ARCHIVE_DEBT_AS_PROOF",
      "archive.md",
      "Evidence Summary must not convert fallback, accepted debt, or debt into proof."
    );
  }
}

function validateCapabilityLane(changeDir, results) {
  const directionMap = readIfExists(path.join(changeDir, "direction-map.md"));
  const evidenceContract = readIfExists(path.join(changeDir, "evidence-contract.md"));
  const findings = readIfExists(path.join(changeDir, "findings.md"));
  const proposal = readIfExists(path.join(changeDir, "proposal.md")) ?? "";
  const archive = readIfExists(path.join(changeDir, "archive.md")) ?? "";

  let promotedDirections = 0;
  if (directionMap !== null) {
    checkSchema(directionMap, "direction-map.md", results);
    promotedDirections = validateDirectionMap(directionMap, results);
  }
  if (evidenceContract !== null) {
    checkSchema(evidenceContract, "evidence-contract.md", results);
    validateEvidenceContract(evidenceContract, results);
  }
  if (findings !== null) {
    checkSchema(findings, "findings.md", results);
    validateSelectionFindings(findings, results);
  }

  const hasCapabilityLane = directionMap !== null || evidenceContract !== null || findings !== null || hasAnchor(proposal, "## Mainline Decision") || hasAnchor(archive, "## Mainline Decision");
  if (!hasCapabilityLane) return;

  if (directionMap !== null && !hasAnchor(proposal, "## Mainline Decision") && !hasAnchor(archive, "## Mainline Decision")) {
    addWarning(results, "CAPABILITY_MAINLINE_DECISION_ABSENT", "proposal.md", "direction-map.md exists but no ## Mainline Decision section was found in proposal.md or archive.md.");
  }
  if (promotedDirections > 0 && findings === null) {
    addWarning(results, "CAPABILITY_SELECTION_FINDINGS_ABSENT", "findings.md", "A promoted direction exists, but findings.md was not found. Record selection findings if a selection run happened.");
  }
}

function validateDirectionMap(text, results) {
  if (!hasAnchor(text, "## Direction Map")) {
    addError(results, "CAPABILITY_DIRECTION_MAP_MISSING_ANCHOR", "direction-map.md", "Missing required anchor: ## Direction Map");
  }
  for (const field of DIRECTION_MAP_FIELDS) {
    if (!hasField(text, field)) {
      addError(results, "CAPABILITY_DIRECTION_MAP_MISSING_FIELD", "direction-map.md", `Missing direction-map field: ${field}`);
    }
  }

  const table = markdownTable(text);
  const statusIndex = table.header.findIndex((cell) => cell.toLowerCase() === "status");
  let promoted = 0;
  if (statusIndex === -1 || table.rows.length === 0) return promoted;

  for (const row of table.rows) {
    const status = row[statusIndex].trim().toLowerCase();
    if (!status) continue;
    if (status === "failed") {
      addError(results, "CAPABILITY_DIRECTION_FAILED_STATUS", "direction-map.md", "Use parked or rejected instead of failed for direction status.");
      continue;
    }
    if (!DIRECTION_STATUSES.has(status)) {
      addError(results, "CAPABILITY_DIRECTION_INVALID_STATUS", "direction-map.md", `Direction status must be one of: ${Array.from(DIRECTION_STATUSES).join(", ")}`);
    }
    if (status === "promoted") promoted += 1;
  }
  return promoted;
}

function validateEvidenceContract(text, results) {
  if (!hasAnchor(text, "## Evidence Contract")) {
    addError(results, "CAPABILITY_EVIDENCE_CONTRACT_MISSING_ANCHOR", "evidence-contract.md", "Missing required anchor: ## Evidence Contract");
  }
  for (const field of EVIDENCE_CONTRACT_FIELDS) {
    if (!hasField(text, field)) {
      addError(results, "CAPABILITY_EVIDENCE_CONTRACT_MISSING_FIELD", "evidence-contract.md", `Missing evidence-contract field: ${field}`);
    }
  }
}

function validateSelectionFindings(text, results) {
  for (const anchor of SELECTION_FINDING_ANCHORS) {
    if (!hasAnchor(text, anchor)) {
      addWarning(results, "CAPABILITY_FINDINGS_MISSING_ANCHOR", "findings.md", `Missing selection findings anchor: ${anchor}`);
    }
  }
}

function validateMainlineDecision(text, file, results) {
  if (!hasAnchor(text, "## Mainline Decision")) return;
  const body = sectionText(text, "## Mainline Decision");
  if (!body) {
    addError(results, "CAPABILITY_MAINLINE_DECISION_EMPTY", file, "## Mainline Decision is present but empty.");
    return;
  }
  if (!/\bparked\b/iu.test(body)) {
    addWarning(results, "CAPABILITY_MAINLINE_PARKED_UNCLEAR", file, "Mainline Decision should name what remains parked, or explicitly say none.");
  }
  if (!/\breopen\b/iu.test(body)) {
    addWarning(results, "CAPABILITY_MAINLINE_REOPEN_UNCLEAR", file, "Mainline Decision should name a fallback or reopen trigger.");
  }
}

function resolveDocsChangeDir(project, target) {
  if (!target) return null;
  const absoluteTarget = path.resolve(project, target);
  if (fs.existsSync(absoluteTarget) && fs.statSync(absoluteTarget).isDirectory()) {
    return absoluteTarget;
  }
  return path.join(project, "docs", "changes", target);
}

function auditDocsRoot(project, results) {
  const docsRoot = path.join(project, "docs");
  const changesRoot = path.join(docsRoot, "changes");
  const openspecRoot = path.join(project, "openspec");

  if (!fs.existsSync(docsRoot)) {
    addError(results, "DOCS_ROOT_MISSING", "docs/", "docs/ does not exist; docs substrate structure cannot be audited.");
    return {
      docsRoot,
      changesRoot,
      openspecRoot,
      docsRootExists: false,
      changesRootExists: false,
      changeCount: 0,
      openspecExists: fs.existsSync(openspecRoot)
    };
  }

  const changesRootExists = fs.existsSync(changesRoot) && fs.statSync(changesRoot).isDirectory();
  let changeCount = 0;
  if (changesRootExists) {
    changeCount = fs.readdirSync(changesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    if (changeCount === 0) {
      addWarning(results, "DOCS_CHANGES_EMPTY", "docs/changes/", "docs/changes/ exists but contains no change directories.");
    }
  } else {
    addWarning(results, "DOCS_CHANGES_ROOT_MISSING", "docs/changes/", "docs/changes/ does not exist. This is acceptable for a package with no docs-mode changes, but no change records can be checked by id.");
  }

  if (fs.existsSync(openspecRoot)) {
    addWarning(results, "OPENSPEC_PRESENT", "openspec/", "OpenSpec is present. OpenSpec-backed changes should use OpenSpec's own structure and lifecycle.");
  }

  return {
    docsRoot,
    changesRoot,
    openspecRoot,
    docsRootExists: true,
    changesRootExists,
    changeCount,
    openspecExists: fs.existsSync(openspecRoot)
  };
}

function checkDocsChange(changeDir, phase, rootResults = []) {
  const results = [...rootResults];
  if (!fs.existsSync(changeDir) || !fs.statSync(changeDir).isDirectory()) {
    addError(results, "DOCS_CHANGE_DIR_MISSING", ".", `Change directory not found: ${changeDir}`);
    return { changeDir, phase, results };
  }
  if (phase === "proposal") {
    validateProposal(changeDir, results);
    validateCapabilityLane(changeDir, results);
  }
  if (phase === "apply") validateApply(changeDir, results);
  if (phase === "verify") validateVerify(changeDir, results);
  if (phase === "archive") validateArchive(changeDir, results);
  return { changeDir, phase, results };
}

function buildReport(args) {
  const project = normalizePath(args.project);
  const results = [];
  const rootAudit = auditDocsRoot(project, results);
  const changeDir = resolveDocsChangeDir(project, args.change);
  const changeReport = changeDir ? checkDocsChange(changeDir, args.phase, results) : {
    changeDir: null,
    phase: args.phase,
    results
  };

  const errors = changeReport.results.filter((item) => item.severity === "error");
  const warnings = changeReport.results.filter((item) => item.severity === "warning");
  return {
    generated: new Date().toISOString(),
    mode: "docs_change_structure_check_read_only",
    project,
    substrate: args.substrate,
    phase: args.phase,
    change: args.change ?? null,
    changeDir,
    state: errors.length > 0 ? "blocked" : warnings.length > 0 ? "warnings" : "pass",
    ok: errors.length === 0,
    rootAudit: {
      docsRoot: rootAudit.docsRoot,
      changesRoot: rootAudit.changesRoot,
      openspecRoot: rootAudit.openspecRoot,
      docsRootExists: rootAudit.docsRootExists,
      changesRootExists: rootAudit.changesRootExists,
      changeCount: rootAudit.changeCount,
      openspecExists: rootAudit.openspecExists
    },
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      results: changeReport.results.length
    },
    results: changeReport.results,
    guardrails: [
      "Read-only structural check.",
      "Does not prove design truth, implementation correctness, or independent validation.",
      "Does not write project truth or promote creative material to canon.",
      "Capability-lane artifacts are optional and should be used only for meaningful direction forks or evidence risk."
    ]
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Change Structure Check");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`State: \`${report.state}\``);
  lines.push(`Project: \`${report.project}\``);
  lines.push(`Substrate: \`${report.substrate}\``);
  lines.push(`Phase: \`${report.phase}\``);
  lines.push(`Change: \`${report.change ?? "none"}\``);
  lines.push(`Change dir: \`${report.changeDir ?? "not checked"}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");
  lines.push("## Root Audit");
  lines.push("");
  lines.push(`- docs exists: ${report.rootAudit.docsRootExists}`);
  lines.push(`- docs/changes exists: ${report.rootAudit.changesRootExists}`);
  lines.push(`- docs change count: ${report.rootAudit.changeCount}`);
  lines.push(`- openspec exists: ${report.rootAudit.openspecExists}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(`- Errors: ${report.summary.errors}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push("");
  if (report.results.length === 0) {
    lines.push("- No issues.");
  } else {
    lines.push("| Severity | Code | File | Message |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of report.results) {
      lines.push(`| \`${item.severity}\` | \`${item.code}\` | \`${item.file}\` | ${item.message} |`);
    }
  }
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  for (const item of report.guardrails) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  const rendered = args.format === "json" ? renderJson(report) : renderMarkdown(report);
  if (args.out) {
    const outPath = normalizePath(args.out);
    if (isPathInside(outPath, normalizePath(args.project))) {
      throw new Error(`Refusing to write check report inside the audited project: ${outPath}`);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
  if (hasErrors(report.results)) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`gamespec-check: ${error.message}`);
  process.exit(1);
}
