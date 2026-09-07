#!/usr/bin/env node
/*
  Import-boundary check for the marketing route group (AT-22, second half).

  The landing page must never import the API client, money arithmetic, or
  anything under the authenticated app. It renders copy and illustrations;
  it computes nothing financial. This script fails the build if that changes.
*/
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const scanned = [join(root, "app", "(marketing)"), join(root, "components", "marketing")];

const forbidden = [
  /@\/lib\/api/,
  /@\/lib\/money/,
  /@\/lib\/ledger/,
  /@\/app\/\(app\)/,
  /@\/app\/\(admin\)/,
  /@abay\/contracts/,
  /@abay\/database/,
  /@tanstack\/react-query/,
  /\bbigint\b/i,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const failures = [];
for (const dir of scanned) {
  let files = [];
  try {
    files = walk(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        failures.push(`${relative(root, file)}: matches ${pattern}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Marketing boundary violated:\n  " + failures.join("\n  "));
  process.exit(1);
}

console.log("Marketing boundary intact: no API, money, or app imports in the landing page.");
