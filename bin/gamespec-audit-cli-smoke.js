#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec CLI smoke audit

Usage:
  node bin/gamespec-audit-cli-smoke.js [--root <package-root>] [--out <path>] [--format markdown|json] [--timeout-ms <ms>]

Rules:
  - Read-only package CLI smoke audit.
  - Runs every package bin target with --help.
  - Requires each help invocation to exit 0 and print Usage.
  - Does not inspect or write project truth.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", root: resolvePackageRootFromBin(import.meta.url), timeoutMs: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--root") {
      args.root = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${args.timeoutMs}`);
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function byteLength(text) {
  return Buffer.byteLength(text ?? "", "utf8");
}

function checkBinHelp(root, name, relativeTarget, timeoutMs) {
  const targetAbs = normalizePath(path.join(root, relativeTarget));
  const issues = [];

  if (!isPathInside(targetAbs, root)) {
    issues.push("bin_target_outside_package_root");
  }
  if (!fs.existsSync(targetAbs)) {
    issues.push("bin_target_missing");
  }

  let result = null;
  if (issues.length === 0) {
    result = spawnSync(process.execPath, [targetAbs, "--help"], {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true
    });

    if (result.error) {
      issues.push(`spawn_error:${result.error.code ?? result.error.message}`);
    }
    if (result.status !== 0) {
      issues.push(`nonzero_exit:${result.status ?? "null"}`);
    }

    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (!/(^|\r?\n)Usage:/u.test(combined)) {
      issues.push("help_missing_usage");
    }
  }

  return {
    name,
    target: toPosix(path.relative(root, targetAbs)),
    status: issues.length === 0 ? "pass" : "blocked",
    exitCode: result?.status ?? null,
    signal: result?.signal ?? null,
    stdoutBytes: byteLength(result?.stdout),
    stderrBytes: byteLength(result?.stderr),
    timedOut: result?.error?.code === "ETIMEDOUT",
    issues
  };
}

function buildAudit(args) {
  const root = normalizePath(args.root);
  const packagePath = path.join(root, "package.json");
  const pkg = readJson(packagePath);
  const bin = pkg.bin ?? {};
  const commandResults = Object.entries(bin)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, target]) => checkBinHelp(root, name, target, args.timeoutMs));
  const blocked = commandResults.filter((item) => item.status === "blocked");

  return {
    generated: new Date().toISOString(),
    mode: "cli_smoke_audit_read_only",
    root,
    packageName: pkg.name ?? null,
    packageVersion: pkg.version ?? null,
    state: blocked.length > 0 ? "blocked" : "pass",
    summary: {
      commands: commandResults.length,
      pass: commandResults.filter((item) => item.status === "pass").length,
      blocked: blocked.length
    },
    commandResults,
    guardrails: [
      "Read-only CLI smoke audit.",
      "Executes only package bin targets with --help.",
      "Does not pass project paths to commands.",
      "Does not inspect any target project.",
      "Does not write project truth."
    ]
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec CLI Smoke Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Root: \`${audit.root}\``);
  lines.push(`Package: \`${audit.packageName}@${audit.packageVersion}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Commands: ${audit.summary.commands}`);
  lines.push(`- Pass: ${audit.summary.pass}`);
  lines.push(`- Blocked: ${audit.summary.blocked}`);
  lines.push("");

  lines.push("## Commands");
  lines.push("");
  lines.push("| Command | Target | Status | Issues |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of audit.commandResults) {
    lines.push(`| \`${item.name}\` | \`${item.target}\` | \`${item.status}\` | ${item.issues.length === 0 ? "" : item.issues.join(", ")} |`);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of audit.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = buildAudit(args);
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
  if (args.out) {
    const outPath = normalizePath(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
  if (audit.state === "blocked") process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-cli-smoke: ${error.message}`);
  process.exit(1);
}
