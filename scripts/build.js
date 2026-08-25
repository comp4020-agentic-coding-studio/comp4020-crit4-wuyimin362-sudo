#!/usr/bin/env node
// Zero-bundler build, carried forward from last week's tooling: copy the
// static site into dist/ as-is. No bundler, no framework — plain ES modules,
// the browser runs what's on disk unmodified.
//
// Entries are discovered, not hardcoded, so a page or module added later
// doesn't silently drop out of dist/ the way a bundler configured for a
// single entry point would.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";

const OUT = "dist";
const SKIP = new Set([
  ".git",
  ".github",
  ".githooks",
  "node_modules",
  "dist",
  "spec",
  "scripts",
  "reflections",
  "notes",
]);

async function topLevelEntries() {
  const names = [];
  for (const entry of await readdir(".", { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    names.push(entry.name);
  }
  return names;
}

/** @param {string} dir @returns {Promise<string[]>} */
async function jsFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsFiles(path)));
    else if (extname(path) === ".js") found.push(path);
  }
  return found;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const name of await topLevelEntries()) {
  await cp(name, join(OUT, name), { recursive: true });
}

// Parse every emitted module. If a file is broken, the build fails here
// rather than the deployed page failing in a browser.
const emitted = await jsFiles(OUT);
for (const file of emitted) {
  execFileSync(process.execPath, ["--check", file]);
}

console.log(`built ${OUT}/ — ${emitted.length} modules checked`);
