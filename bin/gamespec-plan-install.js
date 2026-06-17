#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

const STATUSES = [
  "would_create",
  "already_current",
  "blocked_target_exists_differs",
  "blocked_target_outside_project"
];

function usage(exitCode = 0) {
  const text = `GameSpec install planner

Usage:
  node bin/gamespec-plan-install.js --project <project-root> [--surface runtime|kernel|all] [--profile <profile-id>] [--runtime-host auto|all|none|<host>[,<host>...]] [--out <path>] [--format markdown|json]

Rules:
  - Dry-run only.
  - Reads product files from the current GameSpec repo.
  - Maps runtime adapters into project host surfaces.
  - Maps kernel assets into the project GameSpec method surface.
  - Defaults to the install surface manifest's default profile.
  - Filters kernel groups and runtime hosts when --profile is provided.
  - Runtime host selection defaults to the active profile policy.
  - Runtime host auto-selection only includes host directories already present in the target project.
  - Does not write to the target project.
  - Refuses to write reports inside the target project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { surface: "runtime", format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--surface") {
      args.surface = argv[++i];
    } else if (arg === "--profile") {
      args.profile = argv[++i];
    } else if (arg === "--runtime-host" || arg === "--runtime-hosts") {
      args.runtimeHost = argv[++i];
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
    console.error("Missing --project <project-root>.");
    usage(1);
  }
  if (!["runtime", "kernel", "all"].includes(args.surface)) {
    throw new Error(`Unsupported --surface: ${args.surface}`);
  }
  if (!["markdown", "json"].includes(args.format)) {
    throw new Error(`Unsupported --format: ${args.format}`);
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

function normalizeLineEndings(text) {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function compareInstallContent(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) {
    return {
      bytesEqual: false,
      sameIgnoringLineEndings: false,
      contentEquivalence: "missing"
    };
  }
  const leftBuffer = fs.readFileSync(left);
  const rightBuffer = fs.readFileSync(right);
  const bytesEqual = leftBuffer.equals(rightBuffer);
  if (bytesEqual) {
    return {
      bytesEqual: true,
      sameIgnoringLineEndings: true,
      contentEquivalence: "bytes_equal"
    };
  }
  const sameIgnoringLineEndings =
    normalizeLineEndings(leftBuffer.toString("utf8")) === normalizeLineEndings(rightBuffer.toString("utf8"));
  return {
    bytesEqual: false,
    sameIgnoringLineEndings,
    contentEquivalence: sameIgnoringLineEndings ? "line_endings_only" : "different"
  };
}

function mapRuntimeTarget(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] !== "runtime" || parts.length < 3) return null;
  const host = parts[1];
  const rest = parts.slice(2).join("/");
  if (host === "claude") return `.claude/${rest}`;
  if (host === "agents") return `.agents/${rest}`;
  if (host === "codex") return `.codex/${rest}`;
  if (host === "opencode") return `.opencode/${rest}`;
  return null;
}

function runtimeHostForSourcePath(relativePath) {
  const parts = relativePath.split("/");
  return parts[0] === "runtime" ? parts[1] ?? null : null;
}

function mapKernelTarget(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] !== "kernel" || parts.length < 2) return null;

  const area = parts[1];
  const rest = parts.slice(2).join("/");

  if (area === "config.yaml" && parts.length === 2) return "gamespec/config.yaml";
  if (area === "method" && rest) return `gamespec/${rest}`;
  if (area === "protocols" && rest) return `gamespec/${rest}`;
  if (area === "skills" && rest) return `gamespec/skills/${rest}`;
  if (area === "workflows" && rest) return `gamespec/workflows/${rest}`;
  if (area === "roles" && parts[2] === "agents" && parts.length > 3) {
    return `gamespec/agents/${parts.slice(3).join("/")}`;
  }
  if (area === "templates" && rest) return `gamespec/templates/${rest}`;

  return null;
}

function kernelGroupForSourcePath(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] !== "kernel" || parts.length < 2) return null;
  if (parts[1] === "config.yaml") return "config";
  if (["method", "protocols", "roles", "skills", "templates", "workflows"].includes(parts[1])) {
    return parts[1];
  }
  return null;
}

function sourceGroupForOperation(surface, sourcePath) {
  if (surface === "kernel") return kernelGroupForSourcePath(sourcePath);
  if (surface === "runtime") return runtimeHostForSourcePath(sourcePath);
  return null;
}

function isProjectTruthTarget(targetAbs, projectRoot) {
  const projectTruthRoot = path.join(projectRoot, "gamespec", "projects");
  return isPathInside(targetAbs, projectTruthRoot);
}

function countStatuses(operations) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const op of operations) counts[op.status] += 1;
  return counts;
}

function buildSurfaceOperations(productRoot, projectRoot, surface, surfaceRoot, targetMapper) {
  return walkFiles(surfaceRoot).map((sourceAbs) => {
    const sourcePath = toPosix(path.relative(productRoot, sourceAbs));
    const targetPath = targetMapper(sourcePath);
    const targetAbs = targetPath ? path.join(projectRoot, ...targetPath.split("/")) : null;
    const issues = [];

    if (!targetPath || !targetAbs || !isPathInside(targetAbs, projectRoot)) {
      issues.push("target_outside_project");
    }
    if (targetAbs && isProjectTruthTarget(targetAbs, projectRoot)) {
      issues.push("target_inside_project_truth");
    }

    let status = "would_create";
    let contentEquivalence = "target_missing";
    if (issues.length > 0) {
      status = "blocked_target_outside_project";
      contentEquivalence = "unsafe_target";
    } else if (fs.existsSync(targetAbs)) {
      const comparison = compareInstallContent(sourceAbs, targetAbs);
      contentEquivalence = comparison.contentEquivalence;
      status = comparison.bytesEqual || comparison.sameIgnoringLineEndings
        ? "already_current"
        : "blocked_target_exists_differs";
      if (status === "blocked_target_exists_differs") issues.push("target_exists_differs");
    }

    return {
      op: "copy",
      surface,
      surfaceGroup: sourceGroupForOperation(surface, sourcePath),
      sourcePath,
      sourceAbs,
      targetPath,
      targetAbs,
      status,
      contentEquivalence,
      issues
    };
  });
}

function buildRuntimeOperations(productRoot, projectRoot) {
  return buildSurfaceOperations(
    productRoot,
    projectRoot,
    "runtime",
    path.join(productRoot, "runtime"),
    mapRuntimeTarget
  );
}

function buildKernelOperations(productRoot, projectRoot) {
  return buildSurfaceOperations(
    productRoot,
    projectRoot,
    "kernel",
    path.join(productRoot, "kernel"),
    mapKernelTarget
  );
}

function selectedSurfaces(surface) {
  if (surface === "all") return ["kernel", "runtime"];
  return [surface];
}

function readPackageVersion(productRoot) {
  const packagePath = path.join(productRoot, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return packageJson.version ?? null;
}

function readInstallSurfaceManifest(productRoot) {
  const manifestPath = path.join(productRoot, "kernel", "method", "install-surface.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    sourcePath: "kernel/method/install-surface.json",
    targetPath: "gamespec/install-surface.json",
    schemaVersion: manifest.schemaVersion ?? null,
    surfaceId: manifest.surfaceId ?? null,
    surfaceVersion: manifest.surfaceVersion ?? null,
    releaseChannel: manifest.releaseChannel ?? null,
    installTargets: manifest.installTargets ?? {},
    surfaceGroups: manifest.surfaceGroups ?? {},
    defaultProfile: manifest.defaultProfile ?? null,
    installProfiles: manifest.installProfiles ?? {},
    groupStability: manifest.groupStability ?? {}
  };
}

function selectInstallProfile(manifest, requestedProfile) {
  if (!manifest) {
    if (requestedProfile) throw new Error("Cannot select --profile because install surface manifest is missing.");
    return {
      id: null,
      profile: null
    };
  }
  const profileId = requestedProfile ?? manifest.defaultProfile;
  if (!profileId) throw new Error("Install surface manifest does not define a default profile.");
  const profile = manifest.installProfiles?.[profileId];
  if (!profile) throw new Error(`Unknown install profile: ${profileId}`);
  return {
    id: profileId,
    profile
  };
}

function runtimeTargetForHost(manifest, host) {
  const manifestTarget = manifest?.installTargets?.runtime?.[host];
  if (manifestTarget) return manifestTarget.replace(/\/+$/u, "");
  if (host === "claude") return ".claude";
  if (host === "agents") return ".agents";
  if (host === "codex") return ".codex";
  if (host === "opencode") return ".opencode";
  return `.${host}`;
}

function detectRuntimeHosts(projectRoot, manifest, allowedHosts) {
  return allowedHosts.filter((host) => {
    const target = runtimeTargetForHost(manifest, host);
    return fs.existsSync(path.join(projectRoot, ...target.split("/")));
  });
}

function parseRuntimeHostList(value) {
  return String(value)
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

function selectRuntimeHosts(manifest, selectedProfile, projectRoot, requestedRuntimeHost) {
  const allowedHosts = selectedProfile.profile?.runtimeHosts ?? [];
  const detectedHosts = detectRuntimeHosts(projectRoot, manifest, allowedHosts);
  const mode = requestedRuntimeHost ?? selectedProfile.profile?.runtimeHostSelectionDefault ?? (
    allowedHosts.length > 0 ? "all" : "none"
  );

  let selectedHosts = [];
  if (allowedHosts.length === 0) {
    if (requestedRuntimeHost && !["auto", "none"].includes(requestedRuntimeHost)) {
      throw new Error(`Selected profile does not allow runtime hosts: ${selectedProfile.id ?? "unknown"}`);
    }
    selectedHosts = [];
  } else if (mode === "auto") {
    selectedHosts = detectedHosts;
  } else if (mode === "all") {
    selectedHosts = allowedHosts;
  } else if (mode === "none") {
    selectedHosts = [];
  } else {
    selectedHosts = parseRuntimeHostList(mode);
    const supportedHosts = manifest?.surfaceGroups?.runtime ?? allowedHosts;
    const unknownHosts = selectedHosts.filter((host) => !supportedHosts.includes(host));
    const disallowedHosts = selectedHosts.filter((host) => !allowedHosts.includes(host));
    if (unknownHosts.length > 0) throw new Error(`Unknown runtime host(s): ${unknownHosts.join(", ")}`);
    if (disallowedHosts.length > 0) throw new Error(`Runtime host(s) not allowed by selected profile: ${disallowedHosts.join(", ")}`);
  }

  return {
    requested: requestedRuntimeHost ?? null,
    mode,
    allowedHosts,
    detectedHosts,
    selectedHosts: Array.from(new Set(selectedHosts)).sort()
  };
}

function operationAllowedByProfile(op, selectedProfile, runtimeHostSelection) {
  if (!selectedProfile.profile) return true;
  if (op.surface === "kernel") {
    return selectedProfile.profile.kernelGroups?.includes(op.surfaceGroup);
  }
  if (op.surface === "runtime") {
    return runtimeHostSelection.selectedHosts.includes(op.surfaceGroup);
  }
  return false;
}

function buildPlan(args) {
  const productRoot = resolvePackageRootFromBin(import.meta.url);
  const projectRoot = normalizePath(args.project);
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }
  const installSurfaceManifest = readInstallSurfaceManifest(productRoot);
  const selectedProfile = selectInstallProfile(installSurfaceManifest, args.profile);
  const runtimeHostSelection = selectRuntimeHosts(
    installSurfaceManifest,
    selectedProfile,
    projectRoot,
    args.runtimeHost
  );
  const operations = selectedSurfaces(args.surface).flatMap((surface) => {
    if (surface === "kernel") return buildKernelOperations(productRoot, projectRoot);
    if (surface === "runtime") return buildRuntimeOperations(productRoot, projectRoot);
    throw new Error(`Unsupported surface: ${surface}`);
  }).filter((op) => operationAllowedByProfile(op, selectedProfile, runtimeHostSelection));
  const selectedManifest = installSurfaceManifest ? {
    sourcePath: installSurfaceManifest.sourcePath,
    targetPath: installSurfaceManifest.targetPath,
    schemaVersion: installSurfaceManifest.schemaVersion,
    surfaceId: installSurfaceManifest.surfaceId,
    surfaceVersion: installSurfaceManifest.surfaceVersion,
    releaseChannel: installSurfaceManifest.releaseChannel,
    defaultProfile: installSurfaceManifest.defaultProfile,
    selectedProfile: selectedProfile.id,
    activeProfile: selectedProfile.profile,
    runtimeHostSelection,
    groupStability: installSurfaceManifest.groupStability
  } : null;
  return {
    projectRoot,
    productRoot,
    generated: new Date().toISOString(),
    mode: "install_plan_dry_run",
    surface: args.surface,
    surfaces: selectedSurfaces(args.surface),
    productVersion: readPackageVersion(productRoot),
    installSurfaceManifest: selectedManifest,
    plannedInstallState: {
      path: "gamespec/.gamespec-install.json",
      fields: ["productRoot", "productVersion", "installSurfaceManifest", "installProfile", "runtimeHostSelection", "installedSurfaces", "generated"]
    },
    statusCounts: countStatuses(operations),
    operations,
    safetyInvariants: [
      "This command performs no install writes.",
      "Project truth under gamespec/projects/ is never targeted.",
      "Existing differing product-managed files block the plan.",
      "Already-current files are reported without copying.",
      "Install state is described but not written in this dry-run slice."
    ]
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push("# GameSpec Install Plan");
  lines.push("");
  lines.push(`Mode: \`${plan.mode}\``);
  lines.push(`Surface: \`${plan.surface}\``);
  lines.push(`Project: \`${plan.projectRoot}\``);
  lines.push(`Product root: \`${plan.productRoot}\``);
  lines.push(`Product version: \`${plan.productVersion ?? "unknown"}\``);
  if (plan.installSurfaceManifest) {
    lines.push(`Install surface: \`${plan.installSurfaceManifest.surfaceId}\` \`${plan.installSurfaceManifest.surfaceVersion}\``);
    lines.push(`Install profile: \`${plan.installSurfaceManifest.selectedProfile ?? "unknown"}\``);
    lines.push(`Runtime hosts: \`${plan.installSurfaceManifest.runtimeHostSelection?.selectedHosts?.join(", ") || "none"}\``);
  }
  lines.push(`Generated: ${plan.generated}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of STATUSES) {
    lines.push(`| \`${status}\` | ${plan.statusCounts[status]} |`);
  }
  lines.push("");
  lines.push("## Planned Install State");
  lines.push("");
  lines.push(`- Path: \`${plan.plannedInstallState.path}\``);
  lines.push(`- Fields: ${plan.plannedInstallState.fields.map((field) => `\`${field}\``).join(", ")}`);
  if (plan.installSurfaceManifest) {
    lines.push(`- Surface manifest: \`${plan.installSurfaceManifest.sourcePath}\` -> \`${plan.installSurfaceManifest.targetPath}\``);
    lines.push(`- Active profile: \`${plan.installSurfaceManifest.selectedProfile ?? "unknown"}\``);
    lines.push(`- Profile status: \`${plan.installSurfaceManifest.activeProfile?.status ?? "unknown"}\``);
    lines.push(`- Runtime host selection: \`${plan.installSurfaceManifest.runtimeHostSelection?.mode ?? "unknown"}\``);
    lines.push(`- Selected runtime hosts: \`${plan.installSurfaceManifest.runtimeHostSelection?.selectedHosts?.join(", ") || "none"}\``);
  }
  lines.push("");
  lines.push("## Safety Invariants");
  lines.push("");
  for (const invariant of plan.safetyInvariants) {
    lines.push(`- ${invariant}`);
  }
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const op of plan.operations) {
    lines.push(`- \`${op.sourcePath}\` -> \`${op.targetPath}\``);
    lines.push(`  - status: ${op.status}`);
    if (op.issues.length > 0) lines.push(`  - issues: ${op.issues.join(", ")}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = normalizePath(args.project);
  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write install plan inside target project: ${outPath}`);
    }
  }

  const plan = buildPlan(args);
  const rendered = args.format === "json" ? renderJson(plan) : renderMarkdown(plan);
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
  console.error(`gamespec-plan-install: ${error.message}`);
  process.exit(1);
}
