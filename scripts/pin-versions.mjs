#!/usr/bin/env node
/*
  Rewrites every dependency range in the workspace package.json files to the
  exact version that is actually installed. Run after `npm install` when adding
  or upgrading packages; commit the result together with package-lock.json.

  The brief requires dependency pinning. `save-exact` in .npmrc covers
  `npm install <pkg>`, but ranges written by scaffolding tools are not
  rewritten by a plain `npm install`, so this closes that gap.
*/
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifests = ["package.json", "apps/web/package.json", "packages/config/package.json"];

function installedVersion(name, from) {
  for (const dir of [from, root]) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")).version;
    }
  }
  return null;
}

let changed = 0;
for (const relative of manifests) {
  const file = join(root, relative);
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const dir = dirname(file);

  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (range.startsWith("workspace:") || range.startsWith("file:")) continue;
      const version = installedVersion(name, dir);
      if (version && version !== range) {
        pkg[field][name] = version;
        changed++;
        console.log(`${relative}: ${name} ${range} -> ${version}`);
      } else if (!version) {
        console.warn(`${relative}: ${name} is not installed; left as ${range}`);
      }
    }
  }

  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

console.log(changed ? `Pinned ${changed} dependencies.` : "All dependencies already pinned.");
