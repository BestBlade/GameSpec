#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

const PROJECT_REFERENCE_PATTERNS = [
  { id: "windows_absolute_path", label: "Windows absolute local path", regex: /\b[A-Z]:\\/gu }
];

const EXAMPLE_MARKER_PATTERNS = [
  { id: "review_number_example", label: "REVIEW_0* example marker", regex: /REVIEW_0\d+/gu },
  { id: "combat_system_example", label: "SYS_COMBAT example marker", regex: /SYS_COMBAT/gu },
  { id: "cast_example", label: "CAST_001 example marker", regex: /CAST_001/gu }
];

const INSTALL_SURFACE_MANIFEST_PATH = "kernel/method/install-surface.json";
const STABILITY_LEVELS = ["stable", "beta", "experimental", "deprecated"];
const DEFAULT_PROFILE_FORBIDDEN_REFERENCE_PATTERNS = [
  { id: "optional_skills_path", label: "optional skills path", regex: /gamespec\/skills\//gu },
  { id: "optional_workflows_path", label: "optional workflows path", regex: /gamespec\/workflows\//gu },
  { id: "optional_templates_path", label: "optional templates path", regex: /gamespec\/templates\//gu },
  { id: "optional_agents_path", label: "optional agents path", regex: /gamespec\/agents\//gu },
  { id: "optional_claude_runtime_path", label: "optional Claude runtime path", regex: /\.claude\//gu },
  { id: "optional_agents_runtime_path", label: "optional Agents runtime path", regex: /\.agents\//gu },
  { id: "optional_codex_runtime_path", label: "optional Codex runtime path", regex: /\.codex\//gu }
];

function usage(exitCode = 0) {
  const text = `GameSpec core install surface audit

Usage:
  node bin/gamespec-audit-core-install-surface.js [--root <gamespec-root>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Audits the product install surface under kernel/ and runtime/.
  - Reports project-specific references, example markers, version signals, and runtime entrypoint coverage.
  - Does not inspect or modify target game projects.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--root") {
      args.root = argv[++i];
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

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function scanPatterns(filePath, relativePath, patterns) {
  const text = readText(filePath);
  const matches = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      matches.push({
        id: pattern.id,
        label: pattern.label,
        path: relativePath,
        line: lineNumberAt(text, match.index ?? 0),
        match: match[0]
      });
    }
  }
  return matches;
}

function countByArea(files) {
  const counts = {};
  for (const file of files) {
    const parts = file.split("/");
    const area = parts[1] ? `${parts[0]}/${parts[1]}` : parts[0];
    counts[area] = (counts[area] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function surfaceGroupForInstallFile(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] === "kernel") {
    if (parts[1] === "config.yaml") return { surface: "kernel", group: "config" };
    return { surface: "kernel", group: parts[1] ?? "unknown" };
  }
  if (parts[0] === "runtime") {
    return { surface: "runtime", group: parts[1] ?? "unknown" };
  }
  return { surface: "unknown", group: "unknown" };
}

function buildInstallFileEntries(installFiles) {
  return installFiles.map((file) => ({
    path: file,
    ...surfaceGroupForInstallFile(file)
  }));
}

function filesForProfile(manifestData, installFiles, profileId) {
  const profile = manifestData?.installProfiles?.[profileId];
  if (!profile) return [];
  const kernelGroups = new Set(profile.kernelGroups ?? []);
  const runtimeHosts = new Set(profile.runtimeHosts ?? []);

  return buildInstallFileEntries(installFiles).filter((entry) => {
    if (entry.surface === "kernel") return kernelGroups.has(entry.group);
    if (entry.surface === "runtime") return runtimeHosts.has(entry.group);
    return false;
  });
}

function buildProfileFootprints(manifestData, installFiles) {
  const footprints = {
    defaultProfile: manifestData?.defaultProfile ?? null,
    profiles: {}
  };
  if (!manifestData?.installProfiles) return footprints;

  const fileEntries = buildInstallFileEntries(installFiles);

  for (const [profileId, profile] of Object.entries(manifestData.installProfiles)) {
    const kernelGroups = new Set(profile.kernelGroups ?? []);
    const runtimeHosts = new Set(profile.runtimeHosts ?? []);
    const included = fileEntries.filter((entry) => {
      if (entry.surface === "kernel") return kernelGroups.has(entry.group);
      if (entry.surface === "runtime") return runtimeHosts.has(entry.group);
      return false;
    });
    const groupCounts = {};
    for (const entry of included) {
      const key = `${entry.surface}/${entry.group}`;
      groupCounts[key] = (groupCounts[key] ?? 0) + 1;
    }

    footprints.profiles[profileId] = {
      status: profile.status ?? null,
      isDefault: profileId === manifestData.defaultProfile,
      description: profile.description ?? null,
      totalFiles: included.length,
      kernelFiles: included.filter((entry) => entry.surface === "kernel").length,
      runtimeFiles: included.filter((entry) => entry.surface === "runtime").length,
      kernelGroups: Array.from(kernelGroups).sort(),
      runtimeHosts: Array.from(runtimeHosts).sort(),
      groupCounts: Object.fromEntries(Object.entries(groupCounts).sort(([left], [right]) => left.localeCompare(right)))
    };
  }

  return footprints;
}

function configEnablesWorkflowList(text) {
  const lines = text.split(/\r?\n/u);
  let inWorkflows = false;
  let inEnabled = false;
  for (const line of lines) {
    if (/^\S/u.test(line)) {
      inWorkflows = line.trim() === "workflows:";
      inEnabled = false;
      continue;
    }
    if (!inWorkflows) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 2 && trimmed.startsWith("enabled:")) {
      inEnabled = true;
      const inlineValue = trimmed.slice("enabled:".length).trim();
      if (inlineValue && inlineValue !== "[]") return true;
      continue;
    }
    if (inEnabled && indent > 2 && trimmed.startsWith("-")) return true;
    if (indent <= 2) inEnabled = false;
  }
  return false;
}

function firstLineMatching(text, regex) {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (regex.test(lines[index])) return index + 1;
  }
  return 1;
}

function auditDefaultProfileSelfContainment(productRoot, manifestData, installFiles) {
  const defaultProfile = manifestData?.defaultProfile ?? null;
  const issues = [];
  const matches = [];
  const inspectedFiles = [];

  if (!defaultProfile) issues.push("missing_default_profile");
  const defaultProfileData = defaultProfile ? manifestData?.installProfiles?.[defaultProfile] : null;
  if (defaultProfile && !defaultProfileData) issues.push("default_profile_missing_from_manifest");
  if ((defaultProfileData?.runtimeHosts ?? []).length > 0) issues.push("default_profile_includes_runtime_hosts");

  for (const entry of filesForProfile(manifestData, installFiles, defaultProfile)) {
    if (entry.path === INSTALL_SURFACE_MANIFEST_PATH) continue;
    inspectedFiles.push(entry.path);
    const sourcePath = path.join(productRoot, ...entry.path.split("/"));
    if (!fs.existsSync(sourcePath)) {
      issues.push(`missing_default_profile_file_${entry.path}`);
      continue;
    }
    matches.push(...scanPatterns(sourcePath, entry.path, DEFAULT_PROFILE_FORBIDDEN_REFERENCE_PATTERNS));
    if (entry.path === "kernel/config.yaml") {
      const text = readText(sourcePath);
      if (configEnablesWorkflowList(text)) {
        matches.push({
          id: "default_config_enables_workflows",
          label: "default config enables workflows without default workflow files",
          path: entry.path,
          line: firstLineMatching(text, /^\s*enabled:/u),
          match: "workflows.enabled"
        });
      }
    }
  }

  if (matches.length > 0) issues.push("default_profile_references_optional_surface");

  return {
    state: issues.length === 0 ? "clean" : "attention_required",
    defaultProfile,
    inspectedFiles,
    issues,
    matches
  };
}

function readPackageVersion(productRoot) {
  const packagePath = path.join(productRoot, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  return JSON.parse(readText(packagePath)).version ?? null;
}

function readKernelConfigVersion(productRoot) {
  const configPath = path.join(productRoot, "kernel", "config.yaml");
  if (!fs.existsSync(configPath)) return null;
  const match = readText(configPath).match(/^\s*version:\s*"?([^"\n]+)"?\s*$/mu);
  return match?.[1]?.trim() ?? null;
}

function readInstallSurfaceManifest(productRoot) {
  const manifestPath = path.join(productRoot, ...INSTALL_SURFACE_MANIFEST_PATH.split("/"));
  const targetPath = "gamespec/install-surface.json";
  if (!fs.existsSync(manifestPath)) {
    return {
      present: false,
      sourcePath: INSTALL_SURFACE_MANIFEST_PATH,
      targetPath,
      issues: ["missing_manifest"],
      data: null
    };
  }

  const issues = [];
  let data = null;
  try {
    data = JSON.parse(readText(manifestPath));
  } catch {
    issues.push("invalid_json");
  }

  if (data) {
    for (const field of ["schemaVersion", "surfaceId", "surfaceVersion", "releaseChannel", "installedAs"]) {
      if (!data[field]) issues.push(`missing_${field}`);
    }
    if (data.installedAs !== targetPath) issues.push("installedAs_mismatch");
    if (data.installTargets?.kernel !== "gamespec/") issues.push("kernel_target_mismatch");
    if (data.installTargets?.protectedProjectTruth !== "gamespec/projects/") {
      issues.push("project_truth_target_mismatch");
    }
    for (const host of data.surfaceGroups?.runtime ?? []) {
      if (!data.installTargets?.runtime?.[host]) issues.push(`missing_runtime_target_${host}`);
    }
    for (const role of ["installSurfaceVersion", "packageVersion", "kernelConfigVersion", "runtimeSkillSystem"]) {
      if (!data.versionSignalRoles?.[role]) issues.push(`missing_version_role_${role}`);
    }
    if (!data.defaultProfile) issues.push("missing_defaultProfile");
    if (data.defaultProfile && !data.installProfiles?.[data.defaultProfile]) {
      issues.push("defaultProfile_missing_from_installProfiles");
    }
    if (!data.installProfiles || Object.keys(data.installProfiles).length === 0) {
      issues.push("missing_installProfiles");
    }
    for (const [profileId, profile] of Object.entries(data.installProfiles ?? {})) {
      if (!profile.status) issues.push(`missing_profile_status_${profileId}`);
      if (!Array.isArray(profile.kernelGroups)) issues.push(`missing_profile_kernelGroups_${profileId}`);
      if (!Array.isArray(profile.runtimeHosts)) issues.push(`missing_profile_runtimeHosts_${profileId}`);
      for (const group of profile.kernelGroups ?? []) {
        if (!data.surfaceGroups?.kernel?.includes(group)) issues.push(`profile_unknown_kernel_group_${profileId}_${group}`);
      }
      for (const host of profile.runtimeHosts ?? []) {
        if (!data.surfaceGroups?.runtime?.includes(host)) issues.push(`profile_unknown_runtime_host_${profileId}_${host}`);
      }
    }
    const kernelGroups = data.surfaceGroups?.kernel ?? [];
    const runtimeHosts = data.surfaceGroups?.runtime ?? [];
    for (const group of kernelGroups) {
      const stability = data.groupStability?.kernel?.[group];
      if (!stability) issues.push(`missing_kernel_stability_${group}`);
      else if (!STABILITY_LEVELS.includes(stability)) issues.push(`invalid_kernel_stability_${group}`);
    }
    for (const host of runtimeHosts) {
      const stability = data.groupStability?.runtime?.[host];
      if (!stability) issues.push(`missing_runtime_stability_${host}`);
      else if (!STABILITY_LEVELS.includes(stability)) issues.push(`invalid_runtime_stability_${host}`);
    }
  }

  return {
    present: true,
    sourcePath: INSTALL_SURFACE_MANIFEST_PATH,
    targetPath,
    issues,
    data
  };
}

function summarizeManifestStability(manifestData) {
  const summary = {
    stable: 0,
    beta: 0,
    experimental: 0,
    deprecated: 0,
    unknown: 0
  };
  if (!manifestData) return summary;

  for (const area of ["kernel", "runtime"]) {
    for (const stability of Object.values(manifestData.groupStability?.[area] ?? {})) {
      if (Object.hasOwn(summary, stability)) summary[stability] += 1;
      else summary.unknown += 1;
    }
  }
  return summary;
}

function readRuntimeSystemVersions(productRoot) {
  const versions = {};
  const runtimeFiles = walkFiles(path.join(productRoot, "runtime"))
    .filter((file) => path.basename(file) === "SKILL.md");
  for (const file of runtimeFiles) {
    const relativePath = toPosix(path.relative(productRoot, file));
    const match = readText(file).match(/^\s*system:\s*"([^"]+)"\s*$/mu);
    versions[relativePath] = match?.[1] ?? null;
  }
  return versions;
}

function auditRuntimeDuplication(productRoot) {
  const hostsRoot = path.join(productRoot, "runtime");
  if (!fs.existsSync(hostsRoot)) return [];
  const hostDirs = fs.readdirSync(hostsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const byLogicalPath = new Map();
  for (const host of hostDirs) {
    const hostRoot = path.join(hostsRoot, host);
    for (const file of walkFiles(hostRoot)) {
      const logicalPath = toPosix(path.relative(hostRoot, file));
      if (!byLogicalPath.has(logicalPath)) byLogicalPath.set(logicalPath, []);
      byLogicalPath.get(logicalPath).push({
        host,
        path: toPosix(path.relative(productRoot, file)),
        sha256: hashFile(file)
      });
    }
  }

  return Array.from(byLogicalPath.entries()).map(([logicalPath, entries]) => {
    const uniqueHashes = Array.from(new Set(entries.map((entry) => entry.sha256))).sort();
    return {
      logicalPath,
      hosts: entries.map((entry) => entry.host).sort(),
      identicalAcrossHosts: uniqueHashes.length === 1,
      hashes: uniqueHashes,
      entries: entries.sort((left, right) => left.path.localeCompare(right.path))
    };
  }).sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
}

function auditRuntimeHostCoverage(runtimeDuplication, expectedHosts) {
  const expected = Array.from(new Set(expectedHosts ?? [])).sort();
  const issues = [];
  if (expected.length === 0) {
    return {
      state: "not_applicable",
      expectedHosts: expected,
      issues
    };
  }

  for (const group of runtimeDuplication) {
    const hosts = new Set(group.hosts);
    for (const host of expected) {
      if (!hosts.has(host)) {
        issues.push(`missing_${host}_${group.logicalPath}`);
      }
    }
    for (const host of group.hosts) {
      if (!expected.includes(host)) {
        issues.push(`unexpected_${host}_${group.logicalPath}`);
      }
    }
  }

  return {
    state: issues.length === 0 ? "clean" : "attention_required",
    expectedHosts: expected,
    issues
  };
}

function buildAudit(args) {
  const productRoot = path.resolve(args.root ?? resolvePackageRootFromBin(import.meta.url));
  for (const required of ["kernel", "runtime", "package.json"]) {
    const requiredPath = path.join(productRoot, required);
    if (!fs.existsSync(requiredPath)) throw new Error(`Missing required product path: ${requiredPath}`);
  }

  const kernelFilesAbs = walkFiles(path.join(productRoot, "kernel"));
  const runtimeFilesAbs = walkFiles(path.join(productRoot, "runtime"));
  const installFiles = [...kernelFilesAbs, ...runtimeFilesAbs]
    .map((file) => toPosix(path.relative(productRoot, file)))
    .sort();

  const projectReferences = [];
  const exampleMarkers = [];
  for (const file of [...kernelFilesAbs, ...runtimeFilesAbs]) {
    const relativePath = toPosix(path.relative(productRoot, file));
    projectReferences.push(...scanPatterns(file, relativePath, PROJECT_REFERENCE_PATTERNS));
    exampleMarkers.push(...scanPatterns(file, relativePath, EXAMPLE_MARKER_PATTERNS));
  }

  const runtimeDuplication = auditRuntimeDuplication(productRoot);
  const runtimeDuplicateGroups = runtimeDuplication.filter((group) => group.hosts.length > 1);
  const nonIdenticalRuntimeGroups = runtimeDuplicateGroups.filter((group) => !group.identicalAcrossHosts);
  const installSurfaceManifest = readInstallSurfaceManifest(productRoot);
  const runtimeHostCoverage = auditRuntimeHostCoverage(
    runtimeDuplication,
    installSurfaceManifest.data?.surfaceGroups?.runtime ?? []
  );
  const manifestStabilitySummary = summarizeManifestStability(installSurfaceManifest.data);
  const profileFootprints = buildProfileFootprints(installSurfaceManifest.data, installFiles);
  const defaultProfileSelfContainment = auditDefaultProfileSelfContainment(
    productRoot,
    installSurfaceManifest.data,
    installFiles
  );
  const state = projectReferences.length > 0 ||
    runtimeHostCoverage.state === "attention_required" ||
    !installSurfaceManifest.present ||
    installSurfaceManifest.issues.length > 0 ||
    defaultProfileSelfContainment.state !== "clean"
    ? "attention_required"
    : "clean";

  return {
    generated: new Date().toISOString(),
    mode: "core_install_surface_audit_read_only",
    root: productRoot,
    state,
    installSurface: {
      totalFiles: installFiles.length,
      kernelFiles: kernelFilesAbs.length,
      runtimeFiles: runtimeFilesAbs.length,
      areaCounts: countByArea(installFiles),
      profileFootprints
    },
    defaultProfileSelfContainment,
    versionSignals: {
      packageVersion: readPackageVersion(productRoot),
      kernelConfigVersion: readKernelConfigVersion(productRoot),
      runtimeSkillSystemVersions: readRuntimeSystemVersions(productRoot),
      installSurfaceManifest: {
        present: installSurfaceManifest.present,
        sourcePath: installSurfaceManifest.sourcePath,
        targetPath: installSurfaceManifest.targetPath,
        schemaVersion: installSurfaceManifest.data?.schemaVersion ?? null,
        surfaceId: installSurfaceManifest.data?.surfaceId ?? null,
        surfaceVersion: installSurfaceManifest.data?.surfaceVersion ?? null,
        releaseChannel: installSurfaceManifest.data?.releaseChannel ?? null,
        defaultProfile: installSurfaceManifest.data?.defaultProfile ?? null,
        installProfiles: installSurfaceManifest.data?.installProfiles ?? null,
        groupStability: installSurfaceManifest.data?.groupStability ?? null,
        stabilitySummary: manifestStabilitySummary,
        issues: installSurfaceManifest.issues
      }
    },
    projectSpecificReferences: {
      count: projectReferences.length,
      matches: projectReferences
    },
    exampleMarkers: {
      count: exampleMarkers.length,
      matches: exampleMarkers
    },
    runtimeAdapterDuplication: {
      duplicateGroups: runtimeDuplicateGroups.length,
      nonIdenticalGroups: nonIdenticalRuntimeGroups.length,
      coverage: runtimeHostCoverage,
      groups: runtimeDuplication
    },
    productRead: {
      good: [
        "The install surface is physically separated into kernel assets and runtime host adapters.",
        "The kernel maps into gamespec/ while runtime maps into host-owned adapter directories.",
        "Project truth under gamespec/projects/ is not part of the product install surface.",
        "The installed manifest declares stable-core plus explicit opt-in beta profiles with group-level stability metadata.",
        "The audit reports profile footprints so the default installed contract is distinct from the full available surface.",
        "The default stable-core profile installs a minimal durable contract without runtime host adapters.",
        "The default profile entrypoint is audited for references to optional beta install paths.",
        "Runtime entrypoint packs are checked for verb coverage across supported hosts."
      ],
      risks: [
        "The installed surface manifest should remain the source of truth for version-signal semantics.",
        "Runtime host entrypoint content may be host-specific, so coverage and intent parity should stay audited."
      ]
    },
    guardrails: [
      "This audit is read-only.",
      "It does not inspect target game projects.",
      "It reports product-surface structure only.",
      "attention_required is not a package failure; it is a product-structure signal."
    ]
  };
}

function formatListOrNone(items) {
  return items.length > 0 ? items.map((item) => `\`${item}\``).join(", ") : "none";
}

function formatGroupCounts(groupCounts) {
  const entries = Object.entries(groupCounts);
  if (entries.length === 0) return "none";
  return entries.map(([group, count]) => `\`${group}\` ${count}`).join(", ");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# GameSpec Core Install Surface Audit");
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`State: \`${report.state}\``);
  lines.push(`Root: \`${report.root}\``);
  lines.push(`Generated: ${report.generated}`);
  lines.push("");
  lines.push("## Install Surface");
  lines.push("");
  lines.push(`- Total files: ${report.installSurface.totalFiles}`);
  lines.push(`- Kernel files: ${report.installSurface.kernelFiles}`);
  lines.push(`- Runtime files: ${report.installSurface.runtimeFiles}`);
  lines.push("");
  lines.push("| Area | Files |");
  lines.push("| --- | ---: |");
  for (const [area, count] of Object.entries(report.installSurface.areaCounts)) {
    lines.push(`| \`${area}\` | ${count} |`);
  }
  lines.push("");
  lines.push("## Install Profiles");
  lines.push("");
  lines.push(`Default profile: \`${report.installSurface.profileFootprints.defaultProfile ?? "unknown"}\``);
  lines.push("");
  lines.push("| Profile | Default | Status | Files | Kernel | Runtime | Kernel Groups | Runtime Hosts |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const [profileId, footprint] of Object.entries(report.installSurface.profileFootprints.profiles)) {
    lines.push(`| \`${profileId}\` | ${footprint.isDefault ? "yes" : "no"} | \`${footprint.status ?? "unknown"}\` | ${footprint.totalFiles} | ${footprint.kernelFiles} | ${footprint.runtimeFiles} | ${formatListOrNone(footprint.kernelGroups)} | ${formatListOrNone(footprint.runtimeHosts)} |`);
  }
  if (Object.keys(report.installSurface.profileFootprints.profiles).length === 0) {
    lines.push("| none | no | unknown | 0 | 0 | 0 | none | none |");
  }
  lines.push("");
  lines.push("Profile group counts:");
  for (const [profileId, footprint] of Object.entries(report.installSurface.profileFootprints.profiles)) {
    lines.push(`- \`${profileId}\`: ${formatGroupCounts(footprint.groupCounts)}`);
  }
  if (Object.keys(report.installSurface.profileFootprints.profiles).length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Default Profile Self-Containment");
  lines.push("");
  lines.push(`State: \`${report.defaultProfileSelfContainment.state}\``);
  lines.push(`Default profile: \`${report.defaultProfileSelfContainment.defaultProfile ?? "unknown"}\``);
  lines.push(`Inspected files: ${formatListOrNone(report.defaultProfileSelfContainment.inspectedFiles)}`);
  if (report.defaultProfileSelfContainment.issues.length > 0) {
    lines.push(`Issues: ${report.defaultProfileSelfContainment.issues.map((item) => `\`${item}\``).join(", ")}`);
  } else {
    lines.push("Issues: none");
  }
  lines.push("");
  lines.push("Matches:");
  for (const match of report.defaultProfileSelfContainment.matches) {
    lines.push(`- \`${match.path}:${match.line}\` ${match.label}: \`${match.match}\``);
  }
  if (report.defaultProfileSelfContainment.matches.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Version Signals");
  lines.push("");
  lines.push(`- Package version: \`${report.versionSignals.packageVersion ?? "unknown"}\``);
  lines.push(`- Kernel config version: \`${report.versionSignals.kernelConfigVersion ?? "unknown"}\``);
  lines.push(`- Install surface manifest: ${report.versionSignals.installSurfaceManifest.present ? "`present`" : "`missing`"}`);
  lines.push(`- Install surface version: \`${report.versionSignals.installSurfaceManifest.surfaceVersion ?? "unknown"}\``);
  lines.push(`- Default install profile: \`${report.versionSignals.installSurfaceManifest.defaultProfile ?? "unknown"}\``);
  const stabilitySummary = report.versionSignals.installSurfaceManifest.stabilitySummary;
  lines.push(`- Stability groups: stable ${stabilitySummary.stable}, beta ${stabilitySummary.beta}, experimental ${stabilitySummary.experimental}, deprecated ${stabilitySummary.deprecated}, unknown ${stabilitySummary.unknown}`);
  if (report.versionSignals.installSurfaceManifest.issues.length > 0) {
    lines.push(`- Install surface manifest issues: ${report.versionSignals.installSurfaceManifest.issues.map((item) => `\`${item}\``).join(", ")}`);
  }
  const runtimeVersions = Array.from(new Set(Object.values(report.versionSignals.runtimeSkillSystemVersions).filter(Boolean))).sort();
  lines.push(`- Runtime skill system versions: ${runtimeVersions.length > 0 ? runtimeVersions.map((item) => `\`${item}\``).join(", ") : "`unknown`"}`);
  lines.push("");
  lines.push("## Project-Specific References");
  lines.push("");
  lines.push(`Count: ${report.projectSpecificReferences.count}`);
  for (const match of report.projectSpecificReferences.matches) {
    lines.push(`- \`${match.path}:${match.line}\` ${match.label}: \`${match.match}\``);
  }
  if (report.projectSpecificReferences.matches.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Example Markers");
  lines.push("");
  lines.push(`Count: ${report.exampleMarkers.count}`);
  for (const match of report.exampleMarkers.matches) {
    lines.push(`- \`${match.path}:${match.line}\` ${match.label}: \`${match.match}\``);
  }
  if (report.exampleMarkers.matches.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Runtime Adapter Duplication");
  lines.push("");
  lines.push(`- Duplicate logical files across hosts: ${report.runtimeAdapterDuplication.duplicateGroups}`);
  lines.push(`- Non-identical duplicate groups: ${report.runtimeAdapterDuplication.nonIdenticalGroups}`);
  lines.push("");
  lines.push("## Product Read");
  lines.push("");
  lines.push("Good:");
  for (const item of report.productRead.good) lines.push(`- ${item}`);
  lines.push("");
  lines.push("Risks:");
  for (const item of report.productRead.risks) lines.push(`- ${item}`);
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
  const report = buildAudit(args);
  const rendered = args.format === "json" ? renderJson(report) : renderMarkdown(report);
  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}

try {
  main();
} catch (error) {
  console.error(`gamespec-audit-core-install-surface: ${error.message}`);
  process.exit(1);
}
