#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const LABELS = [
  "kernel_candidate",
  "runtime_candidate",
  "overlay_candidate",
  "project_truth",
  "derived_or_archive",
  "ignore"
];

function usage(exitCode = 0) {
  const text = `GameSpec migration classifier

Usage:
  node bin/gamespec-classify.js --project <path> [--out <path>] [--format markdown|json]

Rules:
  - Reads the target project.
  - Never writes inside the target project.
  - Classifies files for controlled package planning only.
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
    console.error("Missing --project <path>.");
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

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkFiles(root) {
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function toPosixRelative(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function classifyFile(rel) {
  const lower = rel.toLowerCase();
  const base = path.posix.basename(rel);

  if (lower.startsWith(".claude/commands/gamespec/") ||
      lower.startsWith(".claude/skills/gamespec") ||
      lower.startsWith(".codex/skills/gamespec") ||
      lower.startsWith(".agents/skills/gamespec") ||
      lower.startsWith(".agents/skills/source-command-gmsx") ||
      lower.startsWith(".opencode/")) {
    return {
      label: "runtime_candidate",
      reason: "Host-specific GameSpec runtime surface."
    };
  }

  if (lower.startsWith("gamespec/projects/archive/") ||
      lower.includes("/reviews/") ||
      lower.includes("/derived/") ||
      lower.includes("/archive/") ||
      lower.startsWith("openspec/changes/archive/")) {
    return {
      label: "derived_or_archive",
      reason: "Review, archive, or generated/historical project material; protect from installer overwrite."
    };
  }

  if (lower.startsWith("gamespec/projects/")) {
    if (base.startsWith("PHILOSOPHY_") || base.startsWith("PILLARS_")) {
      return {
        label: "overlay_candidate",
        reason: "Project-bound judging principle; may act as overlay but remains project-owned."
      };
    }
    return {
      label: "project_truth",
      reason: "Actual game project document or active state."
    };
  }

  if (lower.startsWith("gamespec/agents/") ||
      lower.startsWith("gamespec/skills/") ||
      lower.startsWith("gamespec/templates/") ||
      lower.startsWith("gamespec/workflows/") ||
      lower === "gamespec/agents.md" ||
      lower === "gamespec/roadmap.md" ||
      lower === "gamespec/config.yaml" ||
      lower.startsWith("gamespec/p")) {
    return {
      label: "kernel_candidate",
      reason: "Reusable GameSpec method, protocol, template, or role asset."
    };
  }

  if (lower.startsWith("gamespec/")) {
    return {
      label: "kernel_candidate",
      reason: "Unclassified GameSpec root asset; inspect before migration."
    };
  }

  if (lower.startsWith(".steadyspec/") ||
      lower.startsWith(".claude/commands/steadyspec/") ||
      lower.startsWith(".claude/skills/steadyspec") ||
      lower.startsWith(".codex/skills/steadyspec")) {
    return {
      label: "ignore",
      reason: "External governance runtime or state, not GameSpec package material."
    };
  }

  return {
    label: "ignore",
    reason: "Outside the current GameSpec package scope."
  };
}

function summarize(classified) {
  const counts = Object.fromEntries(LABELS.map((label) => [label, 0]));
  for (const item of classified) counts[item.label] += 1;
  return counts;
}

function firstItems(classified, label, limit = 12) {
  return classified.filter((item) => item.label === label).slice(0, limit);
}

function renderMarkdown({ projectRoot, classified, counts }) {
  const protectedPaths = [
    "gamespec/projects/",
    "gamespec/projects/hd2d-jrpg/",
    "gamespec/projects/hd2d-jrpg/reviews/"
  ];
  const lines = [];
  lines.push("# GameSpec Migration Classification Report");
  lines.push("");
  lines.push(`Project: \`${projectRoot}\``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Class | Count |");
  lines.push("| --- | ---: |");
  for (const label of LABELS) {
    lines.push(`| \`${label}\` | ${counts[label]} |`);
  }
  lines.push("");
  lines.push("## Protected Project Truth Roots");
  lines.push("");
  for (const protectedPath of protectedPaths) {
    lines.push(`- \`${protectedPath}\``);
  }
  lines.push("");
  lines.push("Installer and migration tooling must not overwrite protected project truth roots.");
  lines.push("");

  for (const label of LABELS) {
    lines.push(`## ${label}`);
    lines.push("");
    const items = firstItems(classified, label);
    if (items.length === 0) {
      lines.push("_No files detected._");
    } else {
      for (const item of items) {
        lines.push(`- \`${item.path}\` - ${item.reason}`);
      }
      const remaining = counts[label] - items.length;
      if (remaining > 0) {
        lines.push(`- ... ${remaining} more`);
      }
    }
    lines.push("");
  }

  lines.push("## Next Step");
  lines.push("");
  lines.push("Use this report to draft a kernel extraction plan. Do not copy files until each candidate has an explicit reason and target-project truth protection remains intact.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson({ projectRoot, classified, counts }) {
  return `${JSON.stringify({
    projectRoot,
    generated: new Date().toISOString(),
    counts,
    protectedRoots: [
      "gamespec/projects/",
      "gamespec/projects/hd2d-jrpg/",
      "gamespec/projects/hd2d-jrpg/reviews/"
    ],
    files: classified
  }, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectRoot}`);
  }

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write report inside target project: ${outPath}`);
    }
  }

  const files = walkFiles(projectRoot);
  const classified = files.map((file) => {
    const rel = toPosixRelative(projectRoot, file);
    const result = classifyFile(rel);
    return { path: rel, ...result };
  });
  const counts = summarize(classified);
  const rendered = args.format === "json"
    ? renderJson({ projectRoot, classified, counts })
    : renderMarkdown({ projectRoot, classified, counts });

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
  console.error(`gamespec-classify: ${error.message}`);
  process.exit(1);
}
