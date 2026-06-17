#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

const REQUIRED_GITIGNORE_PATTERNS = [
  ".meta/",
  "node_modules/",
  "dist/",
  "coverage/"
];

const REQUIRED_NPMIGNORE_PATTERNS = [
  ".meta/",
  "node_modules/",
  "dist/",
  "coverage/",
  "*.log"
];

const PUBLIC_ROOTS = [
  "README.md",
  "LICENSE",
  "package.json",
  ".gitignore",
  ".npmignore",
  "bin",
  "docs",
  "lib",
  "kernel",
  "runtime"
];

const PROHIBITED_PUBLIC_PATTERNS = [
  { id: "local_windows_path", regex: /\b[A-Z]:\\/u },
  { id: "named_validation_project", regex: new RegExp(["Project", ["J", "RPG"].join("")].join("_"), "u") },
  { id: "project_genre_marker", regex: new RegExp(`\\b${["H", "D2D"].join("")}\\b`, "u") },
  {
    id: "source_project_positioning",
    regex: new RegExp([
      ["re", "packaged copy"].join(""),
      ["direct", " extraction of"].join("")
    ].join("|"), "u")
  },
  { id: "reference_system_positioning", regex: new RegExp([["C", "CGS"].join(""), ["E", "CC"].join(""), ["Steady", "Spec"].join(""), ["Claude", "Code", "Game", "Studios"].join("-")].join("|"), "u") },
  {
    id: "unreleased_package_marker",
    regex: new RegExp([
      ["UN", "LICENSED"].join(""),
      [["product", "ization"].join(""), "specific"].join("-"),
      ["0.0.0", ["product", "ization"].join("")].join("-").replaceAll(".", "\\.")
    ].join("|"), "u")
  }
];

function usage(exitCode = 0) {
  const text = `GameSpec package readiness audit

Usage:
  node bin/gamespec-audit-package-readiness.js [--root <package-root>] [--out <path>] [--format markdown|json] [--installed]

Rules:
  - Read-only package audit.
  - Checks package/bin/script/docs boundary hygiene.
  - Checks that self-governance records are ignored.
  - Checks that public file paths do not include project truth directories.
  - Use --installed when auditing a node_modules package where source-only ignore files are not expected.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown", root: resolvePackageRootFromBin(import.meta.url), installed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--root") {
      args.root = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else if (arg === "--installed") {
      args.installed = true;
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

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
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

function publicFiles(root) {
  const files = [];
  for (const item of PUBLIC_ROOTS) {
    const abs = path.join(root, item);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) files.push(...walkFiles(abs));
    else files.push(abs);
  }
  return files.sort();
}

function check(id, title, severity, facts = {}, issues = []) {
  return {
    id,
    title,
    severity,
    status: issues.length > 0 ? severity : "pass",
    facts,
    issues
  };
}

function packageMetadataCheck(root, pkg) {
  const issues = [];
  if (!pkg.name) issues.push("missing_name");
  if (!pkg.version) issues.push("missing_version");
  if (pkg.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    issues.push("version_not_semver_like");
  }
  if (pkg.type !== "module") issues.push("type_must_be_module");
  if (!pkg.license) issues.push("missing_license");
  if (pkg.license !== "MIT") issues.push("license_must_be_mit");
  if (pkg.private === true) issues.push("package_must_be_public_release_candidate");
  if (!pkg.repository?.url) issues.push("missing_repository_url");
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) issues.push("missing_package_files_allowlist");
  return check("package_metadata", "Package metadata", "blocked", {
    name: pkg.name ?? null,
    version: pkg.version ?? null,
    publishVisibility: pkg.private === true ? "restricted_by_package_metadata" : "public_candidate",
    type: pkg.type ?? null,
    license: pkg.license ?? null,
    repository: pkg.repository?.url ?? null,
    files: pkg.files ?? null,
    root
  }, issues);
}

function licenseCheck(root) {
  const licensePath = path.join(root, "LICENSE");
  const text = readTextIfExists(licensePath) ?? "";
  const issues = [];
  if (!text) issues.push("missing_license_file");
  if (text && !text.startsWith("MIT License")) issues.push("license_file_not_mit");
  if (text && !text.includes("Copyright (c)")) issues.push("license_file_missing_copyright");
  return check("license_file", "License file", "blocked", {
    licensePath,
    present: Boolean(text)
  }, issues);
}

function binChecks(root, pkg) {
  const binDir = path.join(root, "bin");
  const binFiles = walkFiles(binDir).filter((file) => file.endsWith(".js"));
  const binMap = pkg.bin ?? {};
  const issues = [];
  const missingTargets = [];
  const unexposedBinFiles = [];
  const missingShebang = [];
  const syntaxFailures = [];

  for (const [name, relTarget] of Object.entries(binMap)) {
    const target = path.resolve(root, relTarget);
    if (!fs.existsSync(target)) missingTargets.push(`${name}:${relTarget}`);
  }

  const exposedTargets = new Set(Object.values(binMap).map((relTarget) => path.resolve(root, relTarget)));
  for (const file of binFiles) {
    if (!exposedTargets.has(file)) unexposedBinFiles.push(toPosix(path.relative(root, file)));
    const firstLine = fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0];
    if (firstLine !== "#!/usr/bin/env node") missingShebang.push(toPosix(path.relative(root, file)));
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      syntaxFailures.push(`${toPosix(path.relative(root, file))}:${String(error.message).split(/\r?\n/)[0]}`);
    }
  }

  if (missingTargets.length > 0) issues.push(`missing_bin_targets:${missingTargets.join(",")}`);
  if (unexposedBinFiles.length > 0) issues.push(`unexposed_bin_files:${unexposedBinFiles.join(",")}`);
  if (missingShebang.length > 0) issues.push(`missing_shebang:${missingShebang.join(",")}`);
  if (syntaxFailures.length > 0) issues.push(`syntax_failures:${syntaxFailures.join(",")}`);

  return check("bin_surface", "Package bin surface", "blocked", {
    binEntries: Object.keys(binMap).length,
    binFiles: binFiles.map((file) => toPosix(path.relative(root, file))),
    missingTargets,
    unexposedBinFiles,
    missingShebang,
    syntaxFailures
  }, issues);
}

function scriptChecks(root, pkg) {
  const scripts = pkg.scripts ?? {};
  const issues = [];
  const checkedScripts = [];
  for (const [name, command] of Object.entries(scripts)) {
    const match = /^node\s+\.\/(bin\/[^ ]+\.js)$/.exec(command);
    if (!match) continue;
    const target = path.join(root, match[1]);
    checkedScripts.push({ name, command, target: match[1] });
    if (!fs.existsSync(target)) issues.push(`missing_script_target:${name}:${match[1]}`);
  }
  return check("script_targets", "Package script targets", "blocked", {
    checkedScripts
  }, issues);
}

function gitignoreCheck(root, options = {}) {
  if (options.installed) {
    return check("gitignore_boundary", "Self-governance ignore boundary", "blocked", {
      requiredPatterns: REQUIRED_GITIGNORE_PATTERNS,
      gitignoreExists: fs.existsSync(path.join(root, ".gitignore")),
      sourceBoundaryApplicable: false,
      reason: "installed_package_root"
    }, []);
  }
  const gitignore = readTextIfExists(path.join(root, ".gitignore"));
  const issues = [];
  if (!gitignore) {
    issues.push("missing_gitignore");
  } else {
    const lines = new Set(gitignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    for (const pattern of REQUIRED_GITIGNORE_PATTERNS) {
      if (!lines.has(pattern)) issues.push(`missing_gitignore_pattern:${pattern}`);
    }
  }
  return check("gitignore_boundary", "Self-governance ignore boundary", "blocked", {
    requiredPatterns: REQUIRED_GITIGNORE_PATTERNS,
    gitignoreExists: Boolean(gitignore)
  }, issues);
}

function npmignoreCheck(root, options = {}) {
  if (options.installed) {
    return check("npmignore_boundary", "Package publish ignore boundary", "blocked", {
      requiredPatterns: REQUIRED_NPMIGNORE_PATTERNS,
      npmignoreExists: fs.existsSync(path.join(root, ".npmignore")),
      sourceBoundaryApplicable: false,
      reason: "installed_package_root"
    }, []);
  }
  const npmignore = readTextIfExists(path.join(root, ".npmignore"));
  const issues = [];
  if (!npmignore) {
    issues.push("missing_npmignore");
  } else {
    const lines = new Set(npmignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    for (const pattern of REQUIRED_NPMIGNORE_PATTERNS) {
      if (!lines.has(pattern)) issues.push(`missing_npmignore_pattern:${pattern}`);
    }
  }
  return check("npmignore_boundary", "Package publish ignore boundary", "blocked", {
    requiredPatterns: REQUIRED_NPMIGNORE_PATTERNS,
    npmignoreExists: Boolean(npmignore)
  }, issues);
}

function publicPathCheck(root) {
  const files = publicFiles(root);
  const leakedProjectTruthPaths = files
    .map((file) => toPosix(path.relative(root, file)))
    .filter((rel) => rel.startsWith("gamespec/projects/") || rel.includes("/gamespec/projects/"));
  const issues = leakedProjectTruthPaths.map((rel) => `public_project_truth_path:${rel}`);
  return check("public_path_boundary", "Public file path boundary", "blocked", {
    publicFileCount: files.length,
    leakedProjectTruthPaths
  }, issues);
}

function textEncodingCheck(root) {
  const files = publicFiles(root).filter((file) => /\.(?:md|json|yaml|yml|js|txt)$/i.test(file));
  const replacementCharHits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("\uFFFD")) replacementCharHits.push(toPosix(path.relative(root, file)));
  }
  const issues = replacementCharHits.map((rel) => `replacement_char:${rel}`);
  return check("public_text_encoding", "Public text encoding", "blocked", {
    checkedTextFiles: files.length,
    replacementCharHits
  }, issues);
}

function readmeCapabilityCheck(root) {
  const readme = readTextIfExists(path.join(root, "README.md")) ?? "";
  const requiredPhrases = [
    "Spark -> Thread -> Candidate -> Canon",
    "Admission Review",
    "stable-core",
    "MIT License"
  ];
  const missing = requiredPhrases.filter((phrase) => !readme.includes(phrase));
  return check("readme_capability_summary", "README capability summary", "warning", {
    requiredPhrases,
    missing
  }, missing.map((phrase) => `missing_readme_phrase:${phrase}`));
}

function publicHygieneCheck(root) {
  const files = publicFiles(root).filter((file) => /\.(?:md|json|yaml|yml|js|txt)$/i.test(file));
  const hits = [];
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of PROHIBITED_PUBLIC_PATTERNS) {
      if (pattern.regex.test(text)) hits.push({ path: rel, pattern: pattern.id });
    }
  }
  return check("public_hygiene", "Public surface hygiene", "blocked", {
    prohibitedPatterns: PROHIBITED_PUBLIC_PATTERNS.map((pattern) => pattern.id),
    hits
  }, hits.map((hit) => `public_hygiene:${hit.path}:${hit.pattern}`));
}

function buildAudit(root, options = {}) {
  root = normalizePath(root);
  const packagePath = path.join(root, "package.json");
  const checks = [];
  let pkg = null;

  try {
    pkg = readJson(packagePath);
  } catch (error) {
    checks.push(check("package_json_parse", "Package JSON parse", "blocked", { packagePath }, [`package_json_parse_failed:${error.message}`]));
    return renderAudit(root, checks);
  }

  checks.push(check("package_json_parse", "Package JSON parse", "blocked", { packagePath }, []));
  checks.push(packageMetadataCheck(root, pkg));
  checks.push(licenseCheck(root));
  checks.push(binChecks(root, pkg));
  checks.push(scriptChecks(root, pkg));
  checks.push(gitignoreCheck(root, options));
  checks.push(npmignoreCheck(root, options));
  checks.push(publicPathCheck(root));
  checks.push(textEncodingCheck(root));
  checks.push(readmeCapabilityCheck(root));
  checks.push(publicHygieneCheck(root));

  return renderAudit(root, checks);
}

function renderAudit(root, checks) {
  const blocked = checks.filter((item) => item.status === "blocked");
  const warnings = checks.filter((item) => item.status === "warning");
  return {
    generated: new Date().toISOString(),
    mode: "package_readiness_audit_read_only",
    root,
    state: blocked.length > 0 ? "blocked" : warnings.length > 0 ? "warnings" : "pass",
    summary: {
      checks: checks.length,
      blocked: blocked.map((item) => item.id),
      warnings: warnings.map((item) => item.id)
    },
    checks,
    guardrails: [
      "Read-only package readiness audit.",
      "Does not inspect any target project directly.",
      "Does not include .meta as public package surface.",
      "Public release files must avoid non-public project names, local paths, source-project positioning, and unreleased package markers."
    ]
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Package Readiness Audit");
  lines.push("");
  lines.push(`Mode: \`${audit.mode}\``);
  lines.push(`State: \`${audit.state}\``);
  lines.push(`Package context: \`${audit.packageContext ?? "source"}\``);
  lines.push(`Root: \`${audit.root}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Checks: ${audit.summary.checks}`);
  lines.push(`- Blocked: ${audit.summary.blocked.length === 0 ? "none" : audit.summary.blocked.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(`- Warnings: ${audit.summary.warnings.length === 0 ? "none" : audit.summary.warnings.map((id) => `\`${id}\``).join(", ")}`);
  lines.push("");

  lines.push("## Checks");
  lines.push("");
  lines.push("| Check | Status | Issues |");
  lines.push("| --- | --- | --- |");
  for (const item of audit.checks) {
    lines.push(`| \`${item.id}\` | \`${item.status}\` | ${item.issues.length === 0 ? "" : item.issues.join(", ")} |`);
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
  const audit = buildAudit(args.root, { installed: args.installed });
  audit.packageContext = args.installed ? "installed" : "source";
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
  if (args.out) {
    const outPath = normalizePath(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-package-readiness: ${error.message}`);
  process.exit(1);
}
