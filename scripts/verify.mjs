#!/usr/bin/env node
/**
 * Serialized verification runner.
 *
 *   node scripts/verify.mjs                                  # typegen + tsc + eslint + vitest (whole project)
 *   node scripts/verify.mjs --scope src/features/agents       # only report tsc/eslint issues under a scope
 *   node scripts/verify.mjs --tests agents                    # only run tests whose path contains "agents"
 *   node scripts/verify.mjs --skip-tests --skip-lint
 *
 * Why this exists: `next typegen` and `tsc --incremental` write into shared
 * generated/cache directories. When several agents or terminals verify at the
 * same time those writes interleave and produce corrupt `.next/**` type files.
 * This script takes an exclusive on-disk lock so concurrent runs queue instead
 * of racing, and always runs tsc with incremental compilation disabled.
 *
 * Exit code is 0 only when every requested step passes (scoped to `--scope`
 * when provided; the unscoped total is still reported so nothing hides).
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_DIR = path.join(root, "node_modules", ".cache", "dot-verify.lock");
const LOCK_STALE_MS = 15 * 60_000;
const LOCK_POLL_MS = 2_000;
const LOCK_WAIT_MS = 30 * 60_000;

function parseArgs(argv) {
  const options = { scope: [], tests: null, skipTests: false, skipLint: false, skipTypes: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") options.scope = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--tests") options.tests = argv[++i] ?? null;
    else if (arg === "--skip-tests") options.skipTests = true;
    else if (arg === "--skip-lint") options.skipLint = true;
    else if (arg === "--skip-types") options.skipTypes = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg.startsWith("--scope=")) options.scope = arg.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--tests=")) options.tests = arg.slice(8);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
      mkdirSync(LOCK_DIR);
      writeFileSync(path.join(LOCK_DIR, "owner"), `${process.pid}`);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - statSync(LOCK_DIR).mtimeMs;
      } catch {
        continue; // lock vanished between calls; retry immediately
      }
      if (age > LOCK_STALE_MS) {
        console.log(`[verify] removing stale lock (${Math.round(age / 1000)}s old)`);
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (!announced) {
        console.log("[verify] another verification run is in progress; waiting…");
        announced = true;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for the verification lock");
      await sleep(LOCK_POLL_MS);
    }
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", (error) => resolve({ code: 1, out: `${out}\n${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function inScope(line) {
  if (options.scope.length === 0) return true;
  const normalized = line.replaceAll("\\", "/");
  return options.scope.some((scope) => normalized.includes(scope.replaceAll("\\", "/")));
}

const results = [];

function report(step, ok, detail) {
  results.push({ step, ok });
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${step}`);
  if (detail && (!ok || !options.quiet)) console.log(detail);
}

async function main() {
  await acquireLock();
  console.log(`[verify] lock acquired${options.scope.length ? ` · scope: ${options.scope.join(", ")}` : ""}`);

  if (!options.skipTypes) {
    const typegen = await run("pnpm", ["exec", "next", "typegen"]);
    if (typegen.code !== 0) {
      report("next typegen", false, typegen.out.trim().split("\n").slice(-20).join("\n"));
    } else {
      report("next typegen", true);

      // Incremental compilation is disabled so parallel runs cannot corrupt .tsbuildinfo.
      const tsc = await run("pnpm", ["exec", "tsc", "--noEmit", "--incremental", "false"]);
      const lines = tsc.out.split("\n").filter((line) => /error TS\d+/.test(line));
      const scoped = lines.filter(inScope);
      const detail = [
        scoped.length ? scoped.slice(0, 60).join("\n") : "",
        options.scope.length ? `\n${lines.length} type error(s) project-wide, ${scoped.length} in scope.` : "",
      ]
        .filter(Boolean)
        .join("\n");
      report("tsc --noEmit", scoped.length === 0, detail || undefined);
      if (options.scope.length && scoped.length === 0 && lines.length > 0) {
        console.log(`[verify] note: ${lines.length} type error(s) exist outside your scope (other features in progress):`);
        console.log(lines.filter((line) => !inScope(line)).slice(0, 15).join("\n"));
      }
    }
  }

  if (!options.skipLint) {
    // ESLint treats CLI arguments as glob patterns, and route directories such as
    // `src/app/w/[workspaceSlug]/...` contain bracket character classes. Linting the
    // whole project and filtering the report by scope avoids that entirely.
    const eslint = await run("pnpm", ["exec", "eslint", "."]);
    const inScopeProblems = [];
    const outOfScopeFiles = new Set();
    let currentFile = null;
    let currentInScope = true;
    for (const rawLine of eslint.out.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      // File headings start at column 0 with an absolute path; problem lines are indented.
      if (/^([A-Za-z]:[\\/]|\/)/.test(line)) {
        currentFile = line.trim();
        currentInScope = inScope(currentFile);
        continue;
      }
      if (/^\s+\d+:\d+\s+(error|warning)\s/.test(line)) {
        if (currentInScope) inScopeProblems.push(`${currentFile ?? "?"}\n${line}`);
        else if (currentFile) outOfScopeFiles.add(currentFile);
      }
    }
    const ok = options.scope.length ? inScopeProblems.length === 0 : eslint.code === 0;
    report("eslint", ok, inScopeProblems.length ? inScopeProblems.slice(0, 40).join("\n") : undefined);
    if (options.scope.length && outOfScopeFiles.size > 0) {
      console.log(`[verify] note: lint problems in ${outOfScopeFiles.size} file(s) outside your scope (other features in progress).`);
    }
  }

  if (!options.skipTests) {
    const args = ["exec", "vitest", "run"];
    // Vitest takes several positional filters, so "a|b" means "either".
    const filters = options.tests ? options.tests.split("|").map((f) => f.trim()).filter(Boolean) : [];
    args.push(...filters);
    const vitest = await run("pnpm", args);
    // A filter that matches nothing exits non-zero and looks like a failure;
    // say what actually happened instead.
    const noMatch = /No test files found/.test(vitest.out);
    const summary = noMatch
      ? `No test file matched ${filters.join(" or ")}. Add tests, or drop --tests to run the whole suite.`
      : vitest.out
          .split("\n")
          .filter((line) => /Test Files|Tests\s|FAIL|✗|×|Error:/.test(line))
          .slice(0, 60)
          .join("\n");
    report("vitest", vitest.code === 0 && !noMatch, summary);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[verify] ${results.length - failed.length}/${results.length} steps passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`[verify] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  releaseLock();
}
