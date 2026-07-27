#!/usr/bin/env node
/**
 * stop hook: if the working tree is dirty and the agent completed,
 * run `pnpm run typecheck` + `pnpm test`. On failure, return
 * followup_message so the agent can auto-correct (loop_limit: 3).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_CHARS = 12_000;
const LOOP_LIMIT = 3;

function projectRoot() {
  return process.env.CURSOR_PROJECT_DIR || process.cwd();
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function run(cmd, { inheritStdio = false } = {}) {
  const r = spawnSync(cmd, {
    encoding: "utf8",
    shell: true,
    cwd: projectRoot(),
    env: process.env,
    stdio: inheritStdio ? "inherit" : "pipe",
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0, status: r.status ?? 1, out, cmd };
}

function truncateTail(s, max = MAX_CHARS) {
  if (s.length <= max) return s;
  return `…[truncated ${s.length - max} chars]…\n` + s.slice(-max);
}

function isWorkingTreeDirty() {
  const r = spawnSync("git status --porcelain", {
    encoding: "utf8",
    shell: true,
    cwd: projectRoot(),
    env: process.env,
  });
  if (r.status !== 0) {
    // Fail open on git errors: skip verify rather than loop forever.
    return false;
  }
  return (r.stdout ?? "").trim().length > 0;
}

function writeJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const input = readStdin();

if (input.status !== "completed" || (input.loop_count ?? 0) >= LOOP_LIMIT) {
  writeJson({});
  process.exit(0);
}

if (!isWorkingTreeDirty()) {
  writeJson({});
  process.exit(0);
}

const steps = ["pnpm run typecheck", "pnpm test"];
for (const cmd of steps) {
  const r = run(cmd);
  if (!r.ok) {
    const body = truncateTail(r.out || "(sin salida)");
    const followup_message = [
      `El hook \`stop\` falló en \`${r.cmd}\` (exit ${r.status}, loop_count=${input.loop_count ?? 0}).`,
      "Corregí el problema y no digas que está listo hasta que typecheck y tests pasen.",
      "",
      "Salida:",
      "```",
      body,
      "```",
    ].join("\n");
    writeJson({ followup_message });
    process.exit(0);
  }
}

writeJson({});
process.exit(0);
