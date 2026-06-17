#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec release readiness audit

Usage:
  node bin/gamespec-audit-release-readiness.js [--root <repo-root>] [--remote <name>] [--branch <name>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Audits source repository readiness for a GitHub remote push.
  - Checks package metadata, git remote, branch, public worktree cleanliness, and npm pack dry-run.
  - Reports npm publish readiness separately from source push readiness.
  - Does not push, tag, publish, or modify files.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    format: "markdown",
    root: resolvePackageRootFromBin(import.meta.url),
    remote: "origin",
    branch: "master"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--root") {
      args.root = argv[++i];
    } else if (arg === "--remote") {
      args.remote = argv[++i];
    } else if (arg === "--branch") {
      args.branch = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
  }
  return args;
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function run(command, args, cwd) {
  const spawnCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
  const spawnArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")]
    : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false
  });
  return {
    exitCode: result.status ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? (result.error.code ?? result.error.message) : null
  };
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./\\:-]+$/u.test(text)) return text;
  return `"${text.replace(/(["^&|<>])/gu, "^$1")}"`;
}

function runGit(root, args) {
  return run("git", args, root);
}

function runNpm(root, args) {
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, root);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parsePorcelain(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith("!! "));
}

function parsePack(stdout) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --dry-run --json returned no package entries.");
  }
  return parsed[0];
}

function hasMeta(packInfo) {
  return (packInfo.files ?? []).some((file) => String(file.path ?? file).startsWith(".meta/"));
}

function buildAudit(args) {
  const root = normalizePath(args.root);
  const issues = [];
  if (!fs.existsSync(root)) throw new Error(`Root does not exist: ${root}`);
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) throw new Error(`Missing package.json: ${packagePath}`);
  const pkg = readJson(packagePath);

  const branchResult = runGit(root, ["branch", "--show-current"]);
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;
  if (branchResult.exitCode !== 0) issues.push("git_branch_unavailable");
  if (branch !== args.branch) issues.push(`branch_mismatch:${branch ?? "unknown"}!=${args.branch}`);

  const remoteResult = runGit(root, ["remote", "get-url", args.remote]);
  const remoteUrl = remoteResult.exitCode === 0 ? remoteResult.stdout.trim() : null;
  if (remoteResult.exitCode !== 0 || !remoteUrl) issues.push(`remote_missing:${args.remote}`);

  const statusResult = runGit(root, ["status", "--short", "--ignored"]);
  const publicStatus = statusResult.exitCode === 0 ? parsePorcelain(statusResult.stdout) : [];
  if (statusResult.exitCode !== 0) issues.push("git_status_unavailable");
  if (publicStatus.length > 0) issues.push("public_worktree_not_clean");

  const logResult = runGit(root, ["log", "--oneline", "-1"]);
  const head = logResult.exitCode === 0 ? logResult.stdout.trim() : null;
  if (!head) issues.push("head_commit_unavailable");

  const revListResult = runGit(root, ["rev-list", "--count", `${args.remote}/${args.branch}..HEAD`]);
  const aheadOfRemote = revListResult.exitCode === 0 ? Number(revListResult.stdout.trim()) : null;
  const remoteBranchAvailable = revListResult.exitCode === 0;

  const packResult = runNpm(root, ["pack", "--dry-run", "--json"]);
  let packInfo = null;
  if (packResult.exitCode !== 0) {
    issues.push("npm_pack_dry_run_failed");
  } else {
    try {
      packInfo = parsePack(packResult.stdout);
      if (hasMeta(packInfo)) issues.push("npm_pack_includes_meta");
    } catch (error) {
      issues.push(`npm_pack_parse_failed:${error.message}`);
    }
  }

  const gitPushReady = issues.length === 0;
  const license = typeof pkg.license === "string" ? pkg.license.trim() : "";
  const npmPublishReady = pkg.private !== true && license === "MIT";
  const publishVisibility = pkg.private === true ? "restricted_by_package_metadata" : "public_candidate";

  return {
    generated: new Date().toISOString(),
    mode: "release_readiness_audit_read_only",
    root,
    state: gitPushReady ? "ready_for_git_push" : "blocked",
    package: {
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      publishVisibility,
      license: license || null,
      npmPublishReady,
      npmPublishNote: npmPublishReady
        ? "Package metadata is public and MIT-licensed."
        : "Source push can be ready while npm registry publish remains disabled."
    },
    git: {
      branch,
      expectedBranch: args.branch,
      remote: args.remote,
      remoteUrl,
      head,
      aheadOfRemote,
      remoteBranchAvailable,
      publicStatus,
      ignoredMetaPresent: fs.existsSync(path.join(root, ".meta"))
    },
    pack: packInfo
      ? {
          filename: packInfo.filename ?? null,
          fileCount: (packInfo.files ?? []).length,
          unpackedSize: packInfo.unpackedSize ?? null,
          metaIncluded: hasMeta(packInfo)
        }
      : null,
    summary: {
      issues,
      gitPushReady,
      npmPublishReady,
      suggestedPushCommand: gitPushReady
        ? remoteBranchAvailable
          ? `git push ${args.remote} ${args.branch}`
          : `git push -u ${args.remote} ${args.branch}`
        : null
    },
    guardrails: [
      "Read-only release readiness audit.",
      "Does not push to remote.",
      "Does not tag or publish.",
      "Ignored .meta self-governance records do not block source release.",
      "Npm publish readiness is reported separately from GitHub source push readiness."
    ]
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Release Readiness Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Root: \`${audit.root}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Git push ready: ${audit.summary.gitPushReady}`);
  lines.push(`- NPM publish ready: ${audit.summary.npmPublishReady}`);
  lines.push(`- Issues: ${audit.summary.issues.length === 0 ? "none" : audit.summary.issues.join(", ")}`);
  lines.push(`- Suggested push: \`${audit.summary.suggestedPushCommand ?? "not ready"}\``);
  lines.push("");

  lines.push("## Git");
  lines.push("");
  lines.push(`- Branch: \`${audit.git.branch ?? "unknown"}\``);
  lines.push(`- Remote: \`${audit.git.remote}\` -> \`${audit.git.remoteUrl ?? "missing"}\``);
  lines.push(`- Head: \`${audit.git.head ?? "unknown"}\``);
  lines.push(`- Ahead of remote: ${audit.git.aheadOfRemote ?? "unknown"}`);
  lines.push(`- Public status entries: ${audit.git.publicStatus.length}`);
  lines.push(`- Ignored .meta present: ${audit.git.ignoredMetaPresent}`);
  lines.push("");

  lines.push("## Package");
  lines.push("");
  lines.push(`- Package: \`${audit.package.name}@${audit.package.version}\``);
  lines.push(`- Publish visibility: \`${audit.package.publishVisibility}\``);
  lines.push(`- License: \`${audit.package.license ?? "missing"}\``);
  lines.push(`- NPM publish note: ${audit.package.npmPublishNote}`);
  if (audit.pack) {
    lines.push(`- Pack file count: ${audit.pack.fileCount}`);
    lines.push(`- Pack .meta included: ${audit.pack.metaIncluded}`);
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
  console.error(`gamespec-audit-release-readiness: ${error.message}`);
  process.exit(1);
}
