import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePackageRootFromBin(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}
