#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { resolvePackageRootFromBin } from "../lib/product-root.js";

function usage(exitCode = 0) {
  const text = `GameSpec held surface audit

Usage:
  node bin/gamespec-audit-held-surfaces.js --review <admission-review.json> [--out <path>] [--format markdown|json]

Rules:
  - Scans the staged GameSpec kernel for role and template references.
  - Compares those references against held role/template source surfaces.
  - Performs no file copy.
  - Refuses to write reports inside the classified project.
`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--review") {
      args.review = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--format") {
      args.format = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }
  if (!args.review) {
    console.error("Missing --review <admission-review.json>.");
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

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkMarkdown(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function toPosix(nativePath) {
  return nativePath.split(path.sep).join("/");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function scanKernelReferences(productRoot) {
  const roleRefs = [];
  const templateRefs = [];
  const files = walkMarkdown(path.join(productRoot, "kernel"));

  for (const filePath of files) {
    const relativePath = toPosix(path.relative(productRoot, filePath));
    const text = fs.readFileSync(filePath, "utf8");
    const roleMatches = text.matchAll(/@game-[\p{Script=Han}A-Za-z0-9_-]+/gu);
    for (const match of roleMatches) {
      roleRefs.push({ id: match[0].slice(1), file: relativePath });
    }
    const templateMatches = text.matchAll(/\bTMPL_[\p{Script=Han}A-Za-z0-9_-]+/gu);
    for (const match of templateMatches) {
      const id = match[0];
      if (id === "TMPL_xxx" || id === "TMPL_模板名") continue;
      templateRefs.push({ id, file: relativePath });
    }
  }

  return {
    roleRefs,
    templateRefs,
    roleIds: uniqueSorted(roleRefs.map((ref) => ref.id)),
    templateIds: uniqueSorted(templateRefs.map((ref) => ref.id))
  };
}

function basenameNoExt(posixPath) {
  const base = posixPath.split("/").pop() ?? posixPath;
  return base.replace(/\.md$/i, "");
}

function roleIdFromHeld(item) {
  return basenameNoExt(item.sourcePath);
}

function templateIdsFromHeld(item) {
  const base = basenameNoExt(item.sourcePath);
  const ids = [base];
  const asciiPrefix = base.match(/^(TMPL_(?:[A-Z0-9]+_)*[A-Z0-9]*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)/u);
  if (asciiPrefix) ids.push(asciiPrefix[1]);
  return uniqueSorted(ids);
}

function refsFor(id, refs) {
  return uniqueSorted(refs.filter((ref) => ref.id === id).map((ref) => ref.file));
}

function templateRefsFor(candidateIds, refs) {
  return uniqueSorted(
    refs
      .filter((ref) => candidateIds.some((id) => ref.id === id || id.startsWith(`${ref.id}_`)))
      .map((ref) => ref.file)
  );
}

function buildAudit(review, reviewPath, productRoot) {
  if (!review.projectRoot || !Array.isArray(review.items)) {
    throw new Error("Admission review must contain projectRoot and items.");
  }

  const refs = scanKernelReferences(productRoot);
  const held = review.items.filter((item) =>
    item.admission === "needs_product_review" &&
    (item.area === "kernel/roles" || item.area === "kernel/templates")
  );

  const roleItems = held
    .filter((item) => item.area === "kernel/roles")
    .map((item) => {
      const id = roleIdFromHeld(item);
      const references = refsFor(id, refs.roleRefs);
      return {
        id,
        sourcePath: item.sourcePath,
        proposedTarget: item.targetPath,
        references,
        decision: references.length > 0 ? "required_by_kernel_contract" : "candidate_pack_or_defer"
      };
    });

  const templateItems = held
    .filter((item) => item.area === "kernel/templates")
    .map((item) => {
      const ids = templateIdsFromHeld(item);
      const references = templateRefsFor(ids, refs.templateRefs);
      return {
        ids,
        sourcePath: item.sourcePath,
        proposedTarget: item.targetPath,
        references,
        decision: references.length > 0 ? "required_by_kernel_contract" : "candidate_pack_or_defer"
      };
    });

  const heldRoleIds = new Set(roleItems.map((item) => item.id));
  const missingRoleReferences = refs.roleIds.filter((id) => !heldRoleIds.has(id));
  const allTemplateCandidateIds = new Set(templateItems.flatMap((item) => item.ids));
  const missingTemplateReferences = refs.templateIds.filter((id) =>
    ![...allTemplateCandidateIds].some((candidate) => candidate === id || candidate.startsWith(`${id}_`))
  );

  return {
    projectRoot: review.projectRoot,
    productRoot,
    sourceReview: reviewPath,
    generated: new Date().toISOString(),
    mode: "held_surface_audit",
    counts: {
      heldRoles: roleItems.length,
      requiredRoles: roleItems.filter((item) => item.decision === "required_by_kernel_contract").length,
      deferredRoles: roleItems.filter((item) => item.decision !== "required_by_kernel_contract").length,
      heldTemplates: templateItems.length,
      requiredTemplates: templateItems.filter((item) => item.decision === "required_by_kernel_contract").length,
      deferredTemplates: templateItems.filter((item) => item.decision !== "required_by_kernel_contract").length,
      missingRoleReferences: missingRoleReferences.length,
      missingTemplateReferences: missingTemplateReferences.length
    },
    decisions: {
      roleImport: "Import required roles only after role contract is accepted.",
      templateImport: "Import required templates only after template contract is accepted.",
      deferredSurface: "Candidate pack/defer items remain source material, not release surface."
    },
    missingRoleReferences,
    missingTemplateReferences,
    roles: roleItems,
    templates: templateItems
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push("# GameSpec Held Surface Audit");
  lines.push("");
  lines.push(`Project: \`${audit.projectRoot}\``);
  lines.push(`Product root: \`${audit.productRoot}\``);
  lines.push(`Generated: ${audit.generated}`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  for (const [key, value] of Object.entries(audit.counts)) {
    lines.push(`| \`${key}\` | ${value} |`);
  }
  lines.push("");
  lines.push("## Decisions");
  lines.push("");
  for (const [key, value] of Object.entries(audit.decisions)) {
    lines.push(`- \`${key}\`: ${value}`);
  }
  lines.push("");
  lines.push("## Missing References");
  lines.push("");
  lines.push(`- Roles: ${audit.missingRoleReferences.length === 0 ? "none" : audit.missingRoleReferences.join(", ")}`);
  lines.push(`- Templates: ${audit.missingTemplateReferences.length === 0 ? "none" : audit.missingTemplateReferences.join(", ")}`);
  lines.push("");
  lines.push("## Roles");
  lines.push("");
  for (const role of audit.roles) {
    lines.push(`- \`${role.id}\` -> \`${role.proposedTarget}\``);
    lines.push(`  - decision: ${role.decision}`);
    lines.push(`  - references: ${role.references.length === 0 ? "none" : role.references.join(", ")}`);
  }
  lines.push("");
  lines.push("## Templates");
  lines.push("");
  for (const template of audit.templates) {
    lines.push(`- \`${template.ids.join(" / ")}\` -> \`${template.proposedTarget}\``);
    lines.push(`  - decision: ${template.decision}`);
    lines.push(`  - references: ${template.references.length === 0 ? "none" : template.references.join(", ")}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderJson(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reviewPath = normalizePath(args.review);
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  const productRoot = resolvePackageRootFromBin(import.meta.url);

  let outPath = null;
  if (args.out) {
    outPath = normalizePath(args.out);
    if (review.projectRoot && isPathInside(outPath, normalizePath(review.projectRoot))) {
      throw new Error(`Refusing to write held surface audit inside classified project: ${outPath}`);
    }
  }

  const audit = buildAudit(review, reviewPath, productRoot);
  const rendered = args.format === "json" ? renderJson(audit) : renderMarkdown(audit);
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
  console.error(`gamespec-audit-held-surfaces: ${error.message}`);
  process.exit(1);
}
