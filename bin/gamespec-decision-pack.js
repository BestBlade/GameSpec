#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage(exitCode = 0) {
  const text = `GameSpec producer decision pack

Usage:
  node bin/gamespec-decision-pack.js (--project <project-root> | --status <status.json>) [--project-id <id>] [--out <path>] [--format markdown|json]

Rules:
  - Read-only.
  - Builds on the status console fact layer.
  - Refuses to write reports inside the target project.
  - Produces decision options, recommended order, guardrails, and proof gates.
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
    } else if (arg === "--project-id") {
      args.projectId = argv[++i];
    } else if (arg === "--status") {
      args.status = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.project && !args.status) {
    console.error("Missing --project <project-root> or --status <status.json>.");
    usage(1);
  }
  if (args.project && args.status) {
    throw new Error("Use either --project or --status, not both.");
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

function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function readStatus(args) {
  if (args.status) {
    const statusPath = normalizePath(args.status);
    return JSON.parse(fs.readFileSync(statusPath, "utf8"));
  }

  const statusScript = path.join(scriptDir(), "gamespec-status.js");
  const statusArgs = [
    statusScript,
    "--project",
    normalizePath(args.project),
    "--format",
    "json"
  ];
  if (args.projectId) statusArgs.push("--project-id", args.projectId);
  return JSON.parse(execFileSync(process.execPath, statusArgs, { encoding: "utf8" }));
}

function hasAttention(status, id) {
  return (status.attention ?? []).some((item) => item.id === id);
}

function sourceRefs(status, keys) {
  const refs = [];
  for (const key of keys) {
    const value = status.sources?.[key];
    if (value) refs.push(value);
  }
  return refs;
}

function buildRosterDecision(status) {
  return {
    id: "protagonist_roster_freeze",
    title: "Freeze protagonist roster through irreducible-view proof",
    severity: "high",
    decisionOwner: "producer",
    whyNow: "SYS_001 can continue only as a working assumption until protagonist count and candidate roster are frozen.",
    blocks: [
      "SYS_001 final promotion",
      "stable exploration-skill mapping",
      "chapter planning",
      "LEVEL_001 thaw path"
    ],
    recommendedOption: "B",
    options: [
      {
        id: "A",
        name: "Freeze the current six-candidate assumption now",
        tradeoff: "Unlocks downstream work fastest, but may preserve an unproven viewpoint or force later rewrites.",
        requiredProof: [
          "Every protagonist owns an irreducible truth slice.",
          "Every protagonist has a public verb and chapter engine.",
          "Public narrative propagation is assigned."
        ]
      },
      {
        id: "B",
        name: "Run a roster decision sprint before freezing",
        tradeoff: "Slightly slower, but matches the product method: number follows truth coverage, not the other way around.",
        requiredProof: [
          "#3 and #4 remain anchored.",
          "Remaining slots pass the deletion test.",
          "Public narrative carrier is decided.",
          "SYS_001 recheck criteria are explicit."
        ]
      },
      {
        id: "C",
        name: "Shrink or defer the uncertain slot",
        tradeoff: "Reduces scope, but risks losing the public/common-sense truth slice and requires SYS_001 remapping."
      }
    ],
    proofGate: [
      "CAST_001 states the final protagonist count or explicitly records why it remains variable.",
      "active.md no longer lists protagonist count as a stability condition.",
      "REVIEW_034 condition is resolved by recheck or preserved as a deliberate product gate."
    ],
    evidence: sourceRefs(status, ["active", "review", "archaeology"])
  };
}

function buildPublicNarrativeDecision(status) {
  return {
    id: "public_narrative_carrier",
    title: "Decide whether public narrative propagation needs its own carrier",
    severity: "high",
    decisionOwner: "producer",
    whyNow: "The current open question can change roster closure and the meaning of player knowledge propagation.",
    blocks: [
      "roster freeze",
      "CAST_001 closure",
      "SYS_001 role-to-skill remap confidence"
    ],
    recommendedOption: "B",
    options: [
      {
        id: "A",
        name: "Promote it to an independent protagonist",
        tradeoff: "Strong if public/common-sense production is an irreducible truth slice, but expensive and easy to overfit."
      },
      {
        id: "B",
        name: "Test carrier ownership before promotion",
        tradeoff: "Best preserves product discipline: promote only if no existing protagonist can carry the slice without collapse.",
        requiredProof: [
          "Define the public narrative truth slice.",
          "Try assigning it to each anchored or candidate protagonist.",
          "Promote only if every assignment weakens the core theme or deletes necessary player understanding."
        ]
      },
      {
        id: "C",
        name: "Keep it as a system/NPC layer instead of protagonist identity",
        tradeoff: "Can keep scope lean, but may weaken the theme if public truth production should be personally embodied."
      }
    ],
    proofGate: [
      "The carrier decision is recorded in CAST_001 or active.md.",
      "If promoted, the protagonist has a public verb and chapter engine.",
      "If folded, the receiving protagonist's truth slice remains coherent."
    ],
    evidence: sourceRefs(status, ["active", "archaeology"])
  };
}

function buildCombatRewardDecision(status) {
  return {
    id: "combat_reward_frame_for_level_thaw",
    title: "Define the minimum combat/reward frame before thawing LEVEL_001",
    severity: "medium",
    decisionOwner: "producer + system design",
    whyNow: "LEVEL_001 is quarantined; its combat, reward, and validation sections should not be consumed until upstream frames exist.",
    blocks: [
      "LEVEL_001 thaw",
      "level-design production",
      "combat/reward-dependent validation"
    ],
    recommendedOption: "A",
    options: [
      {
        id: "A",
        name: "Define a minimum interface frame only",
        tradeoff: "Unlocks safe level redesign without pretending the full combat system is solved.",
        requiredProof: [
          "Combat encounter inputs/outputs are named.",
          "Reward categories and ownership are named.",
          "Exploration-to-combat handoff boundaries are named."
        ]
      },
      {
        id: "B",
        name: "Freeze a full combat/reward design first",
        tradeoff: "More stable, but risks blocking level learning behind a large system-design task."
      },
      {
        id: "C",
        name: "Keep LEVEL_001 quarantined and skip level work",
        tradeoff: "Safest for truth integrity, but delays validation of narrative/exploration/combat coupling."
      }
    ],
    proofGate: [
      "LEVEL_001 thaw conditions are checked explicitly.",
      "Quarantined sections are not used before the gate passes.",
      "Any level rewrite starts from allowed sections, not frozen combat/reward details."
    ],
    evidence: sourceRefs(status, ["active", "activeDocument"])
  };
}

function buildSysRecheckGate(status) {
  return {
    id: "sys_001_recheck_gate",
    title: "Recheck SYS_001 after roster freeze",
    severity: "high",
    type: "gate",
    whyNow: "REVIEW_034 says SYS_001 is conditionally passed, not final.",
    requiredAfter: [
      "protagonist_roster_freeze",
      "public_narrative_carrier"
    ],
    mustNotDoBeforeGate: [
      "Do not convert SYS_001 from .ai.md to .md final.",
      "Do not reintroduce a concrete skill-to-character table as final truth.",
      "Do not consume LEVEL_001 as an active dependency."
    ],
    proofGate: [
      "SYS_001 section 8 and any mapping section are reviewed against the frozen roster.",
      "If the roster differs from the working assumption, document-review is rerun.",
      "active.md is updated in the project by the project workflow, not by this report."
    ],
    evidence: sourceRefs(status, ["active", "review"])
  };
}

function buildPack(status) {
  const decisions = [];
  if (hasAttention(status, "freeze_protagonist_count")) decisions.push(buildRosterDecision(status));
  if (hasAttention(status, "decide_public_narrative_carrier")) decisions.push(buildPublicNarrativeDecision(status));
  if (hasAttention(status, "freeze_combat_reward_frame")) decisions.push(buildCombatRewardDecision(status));

  const gates = [];
  if (hasAttention(status, "recheck_sys_001_after_roster_freeze")) gates.push(buildSysRecheckGate(status));

  return {
    generated: new Date().toISOString(),
    mode: "producer_decision_pack_read_only",
    projectRoot: status.projectRoot,
    projectId: status.projectId,
    basedOnStatusGenerated: status.generated,
    current: status.current,
    driver: status.driver,
    executiveRecommendation: {
      summary: "Resolve the roster/public-narrative decision first, then recheck SYS_001, then define the minimum combat/reward frame needed to thaw LEVEL_001.",
      order: [
        "public_narrative_carrier",
        "protagonist_roster_freeze",
        "sys_001_recheck_gate",
        "combat_reward_frame_for_level_thaw"
      ],
      doNotDo: [
        "Do not convert SYS_001 to final while the roster condition remains open.",
        "Do not consume LEVEL_001 as active truth.",
        "Do not choose protagonist count by template or competitor parity.",
        "Do not import broad agent-inventory templates as a substitute for producer judgment."
      ]
    },
    decisions,
    gates,
    nonDecisions: [
      {
        id: "tooling_or_agent_count",
        reason: "Current target-project risk is not lack of agent surfaces; it is unresolved product truth ownership."
      },
      {
        id: "level_content_rewrite",
        reason: "LEVEL_001 is explicitly quarantined until upstream thaw conditions pass."
      }
    ],
    sources: status.sources,
    guardrails: [
      "Read-only decision report.",
      "No project files are edited.",
      "Recommendations are grounded in status-console evidence.",
      "Producer decisions remain owned by the user/project, not by the tool."
    ]
  };
}

function renderMarkdown(pack) {
  const lines = [];
  lines.push("# GameSpec Producer Decision Pack");
  lines.push("");
  lines.push(`Mode: \`${pack.mode}\``);
  lines.push(`Project root: \`${pack.projectRoot ?? "unknown"}\``);
  lines.push(`Project id: \`${pack.projectId ?? "unknown"}\``);
  lines.push(`Generated: ${pack.generated}`);
  lines.push("");

  lines.push("## Executive Recommendation");
  lines.push("");
  lines.push(pack.executiveRecommendation.summary);
  lines.push("");
  lines.push("Decision order:");
  for (const item of pack.executiveRecommendation.order) lines.push(`- \`${item}\``);
  lines.push("");
  lines.push("Do not do yet:");
  for (const item of pack.executiveRecommendation.doNotDo) lines.push(`- ${item}`);
  lines.push("");

  lines.push("## Current Driver");
  lines.push("");
  lines.push(`- Workflow: \`${pack.current?.workflow ?? "unknown"}\``);
  lines.push(`- Phase: \`${pack.current?.phase?.id ?? "unknown"}\` ${pack.current?.phase?.name ?? ""} (${pack.current?.phase?.status ?? "unknown"})`);
  lines.push(`- Driver: \`${pack.driver?.id ?? "unknown"}\` ${pack.driver?.title ?? ""}`);
  lines.push(`- Driver state: \`${pack.driver?.state ?? "unknown"}\``);
  if (pack.driver?.review) {
    lines.push(`- Review: \`${pack.driver.review.id}\` (${pack.driver.review.conclusion ?? "unknown"})`);
  }
  lines.push("");

  lines.push("## Decisions");
  lines.push("");
  for (const decision of pack.decisions) {
    lines.push(`### ${decision.id}`);
    lines.push("");
    lines.push(`- Title: ${decision.title}`);
    lines.push(`- Severity: \`${decision.severity}\``);
    lines.push(`- Owner: \`${decision.decisionOwner}\``);
    lines.push(`- Recommendation: option \`${decision.recommendedOption}\``);
    lines.push(`- Why now: ${decision.whyNow}`);
    lines.push(`- Blocks: ${decision.blocks.map((item) => `\`${item}\``).join(", ")}`);
    lines.push("");
    for (const option of decision.options) {
      lines.push(`- Option ${option.id}: ${option.name}`);
      lines.push(`  - Tradeoff: ${option.tradeoff}`);
      if (option.requiredProof) {
        lines.push(`  - Required proof: ${option.requiredProof.join("; ")}`);
      }
    }
    lines.push("");
    lines.push("Proof gate:");
    for (const gate of decision.proofGate) lines.push(`- ${gate}`);
    lines.push("");
  }

  lines.push("## Gates");
  lines.push("");
  for (const gate of pack.gates) {
    lines.push(`- \`${gate.id}\`: ${gate.title}`);
    lines.push(`  - Why now: ${gate.whyNow}`);
    lines.push(`  - Required after: ${gate.requiredAfter.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`  - Must not do before gate: ${gate.mustNotDoBeforeGate.join("; ")}`);
  }
  lines.push("");

  lines.push("## Non-Decisions");
  lines.push("");
  for (const item of pack.nonDecisions) lines.push(`- \`${item.id}\`: ${item.reason}`);
  lines.push("");

  lines.push("## Sources");
  lines.push("");
  for (const [key, value] of Object.entries(pack.sources ?? {})) {
    lines.push(`- ${key}: \`${value ?? "missing"}\``);
  }
  lines.push("");

  lines.push("## Guardrails");
  lines.push("");
  for (const guardrail of pack.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(pack) {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const status = readStatus(args);
  const projectRoot = status.projectRoot ? normalizePath(status.projectRoot) : (args.project ? normalizePath(args.project) : null);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (projectRoot && isPathInside(outPath, projectRoot)) {
      throw new Error(`Refusing to write decision pack inside target project: ${outPath}`);
    }
  }

  const pack = buildPack(status);
  const rendered = args.format === "json" ? renderJson(pack) : renderMarkdown(pack);
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
  console.error(`gamespec-decision-pack: ${error.message}`);
  process.exit(1);
}
