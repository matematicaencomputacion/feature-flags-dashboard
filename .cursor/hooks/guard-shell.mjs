#!/usr/bin/env node
/**
 * beforeShellExecution guard: deny dangerous shell commands.
 *
 * Blocks:
 * 1. Deleting any *.db (rm / Remove-Item / del / erase / unlink)
 * 2. Aggressive recursive deletes outside node_modules|dist|.next
 * 3. drizzle-kit push (always)
 * 4. git push --force / -f / --force-with-lease, and push to main|master
 */
import { readFileSync } from "node:fs";

const ALLOWED_RM_TARGETS = new Set(["node_modules", "dist", ".next"]);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function deny(user_message, agent_message) {
  process.stdout.write(
    JSON.stringify({ permission: "deny", user_message, agent_message }) + "\n",
  );
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
  process.exit(0);
}

/** Strip simple quotes from a shell token. */
function unquote(tok) {
  if (
    (tok.startsWith('"') && tok.endsWith('"')) ||
    (tok.startsWith("'") && tok.endsWith("'"))
  ) {
    return tok.slice(1, -1);
  }
  return tok;
}

/**
 * Lightweight tokenizer: splits on whitespace but keeps quoted segments.
 */
function tokenize(command) {
  const tokens = [];
  const re = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    tokens.push(unquote(m[0]));
  }
  return tokens;
}

function basenamePath(p) {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = norm.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : norm;
}

function isAllowlistedRmTarget(pathTok) {
  const base = basenamePath(pathTok);
  if (ALLOWED_RM_TARGETS.has(base)) return true;
  // Also allow trailing segments like ./apps/web/.next or packages/foo/dist
  const norm = pathTok.replace(/\\/g, "/");
  return [...ALLOWED_RM_TARGETS].some(
    (name) =>
      norm === name ||
      norm.endsWith(`/${name}`) ||
      norm.endsWith(`/${name}/`) ||
      norm.endsWith(`\\${name}`),
  );
}

function looksLikeDbPath(tok) {
  const t = tok.replace(/\\/g, "/");
  return /(?:^|[\/\\])[^\/\\]*\.db$/i.test(t) || /\*\.db\b/i.test(t) || t === "*.db";
}

/**
 * True if command deletes (or may delete) a *.db file.
 */
function isDbDeletion(cmd) {
  if (!/\.db\b/i.test(cmd)) return false;

  // bash/unix style
  if (/\brm\b/i.test(cmd) && /\.db\b/i.test(cmd)) return true;
  if (/\bunlink\b/i.test(cmd) && /\.db\b/i.test(cmd)) return true;

  // PowerShell / cmd
  if (/\bRemove-Item\b/i.test(cmd) && /\.db\b/i.test(cmd)) return true;
  if (/(^|[\s|;&])ri(\s|$)/i.test(cmd) && /\.db\b/i.test(cmd)) return true;
  if (/\bdel\b/i.test(cmd) && /\.db\b/i.test(cmd)) return true;
  if (/\berase\b/i.test(cmd) && /\.db\b/i.test(cmd)) return true;

  // Extra safety: any delete-ish verb + a token that looks like a db path
  const tokens = tokenize(cmd);
  const deleteVerb = tokens.some((t) =>
    /^(rm|unlink|del|erase|Remove-Item|ri)$/i.test(t),
  );
  if (deleteVerb && tokens.some(looksLikeDbPath)) return true;

  return false;
}

/**
 * Detect bash `rm` with recursive+force flags (-rf, -fr, -R -f, etc.).
 */
function isBashAggressiveRm(cmd, tokens) {
  const rmIdx = tokens.findIndex((t) => /^rm$/i.test(t));
  if (rmIdx === -1) return false;

  const flagToks = [];
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) flagToks.push(t);
    else break; // stop at first path (simple heuristic)
  }
  // Also scan all leading clustered flags after rm
  const allFlags = tokens
    .slice(rmIdx + 1)
    .filter((t) => t.startsWith("-"))
    .join(" ");

  const hasR =
    /(^|[\s])-([a-zA-Z]*r[a-zA-Z]*|--recursive)([\s]|$)/i.test(` ${allFlags} `) ||
    flagToks.some((f) => /r/i.test(f) && !/^--/.test(f)) ||
    flagToks.some((f) => /^--recursive$/i.test(f));
  const hasF =
    /(^|[\s])-([a-zA-Z]*f[a-zA-Z]*|--force)([\s]|$)/i.test(` ${allFlags} `) ||
    flagToks.some((f) => /f/i.test(f) && !/^--/.test(f)) ||
    flagToks.some((f) => /^--force$/i.test(f));

  // Compact forms: -rf, -fr, -Rf, etc.
  const compact = flagToks.some((f) => /^-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*$/i.test(f) || /^-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*$/i.test(f));

  void cmd;
  return compact || (hasR && hasF);
}

/**
 * Detect PowerShell Remove-Item -Recurse [-Force].
 */
function isPowerShellAggressiveRm(cmd, tokens) {
  const hasRemove =
    /\bRemove-Item\b/i.test(cmd) ||
    tokens.some((t, i) => /^ri$/i.test(t) && i === 0) ||
    /(^|[\s|;&])ri(\s+)/i.test(cmd);

  if (!hasRemove) return false;
  const hasRecurse = /-(Recurse|r)\b/i.test(cmd);
  // Treat -Recurse alone as aggressive enough for this guard
  return hasRecurse;
}

function collectRmPaths(tokens, startVerbIdx) {
  const paths = [];
  for (let i = startVerbIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) continue; // skip flags
    // skip PowerShell common param values that aren't paths
    if (/^(True|False)$/i.test(t)) continue;
    paths.push(t);
  }
  return paths;
}

function isAggressiveRm(cmd) {
  const tokens = tokenize(cmd);
  return isBashAggressiveRm(cmd, tokens) || isPowerShellAggressiveRm(cmd, tokens);
}

function allTargetsAllowlisted(cmd) {
  const tokens = tokenize(cmd);
  let verbIdx = tokens.findIndex((t) => /^rm$/i.test(t));
  if (verbIdx === -1) {
    verbIdx = tokens.findIndex((t) => /^(Remove-Item|ri)$/i.test(t));
  }
  if (verbIdx === -1) return false;

  const paths = collectRmPaths(tokens, verbIdx);
  if (paths.length === 0) return false; // no explicit path → deny (too risky)
  return paths.every(isAllowlistedRmTarget);
}

function isDrizzleKitPush(cmd) {
  return /\bdrizzle-kit\b[\s\S]*\bpush\b/i.test(cmd);
}

function isGitPushForce(cmd) {
  if (!/\bgit\s+push\b/i.test(cmd)) return false;
  // --force, --force-with-lease[=...], -f as its own flag token
  if (/\s--force-with-lease(?:\s|=|$)/i.test(cmd)) return true;
  if (/\s--force(?:\s|=|$)/i.test(cmd)) return true;
  // -f as a short flag (alone or clustered carefully)
  const tokens = tokenize(cmd);
  const pushIdx = tokens.findIndex(
    (t, i) => /^push$/i.test(t) && i > 0 && /^git$/i.test(tokens[i - 1]),
  );
  if (pushIdx === -1) {
    // git.exe push / multi-line: fallback regex
    return /(^|\s)-f(\s|$)/.test(cmd);
  }
  return tokens.slice(pushIdx + 1).some((t) => {
    if (t === "-f") return true;
    if (/^--force/.test(t)) return true;
    // clustered short flags containing f but not part of a path
    if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(t) && !t.includes("=")) return true;
    return false;
  });
}

/**
 * Deny push whose destination ref is main or master.
 * Avoids false positives on branch names like feature/main-fix when used as source only;
 * we inspect destination-looking tokens after `git push`.
 */
function targetsMainOrMaster(cmd) {
  if (!/\bgit\s+push\b/i.test(cmd)) return false;

  const tokens = tokenize(cmd);
  // Find `git` then `push`
  let pushIdx = -1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/^git$/i.test(tokens[i]) && /^push$/i.test(tokens[i + 1])) {
      pushIdx = i + 1;
      break;
    }
  }
  if (pushIdx === -1) return false;

  const after = tokens.slice(pushIdx + 1).filter((t) => !t.startsWith("-"));
  // Patterns:
  //   git push origin main
  //   git push origin HEAD:main
  //   git push origin refs/heads/main
  //   git push main
  //   git push origin +main
  for (const tok of after) {
    // skip remote-looking first args if followed by an explicit ref — still check every tok
    const ref = tok.replace(/^\+/, "");
    if (/^(main|master)$/i.test(ref)) return true;
    if (/^(HEAD:)?(refs\/heads\/)?(main|master)$/i.test(ref)) return true;
    // remote:ref form origin:main is rare; HEAD:main / :main
    const colon = ref.lastIndexOf(":");
    if (colon !== -1) {
      const dest = ref.slice(colon + 1).replace(/^refs\/heads\//i, "");
      if (/^(main|master)$/i.test(dest)) return true;
    }
  }
  return false;
}

// --- main ---
const { command = "" } = readStdin();
const cmd = String(command).trim();

if (!cmd) {
  allow();
}

// 3) drizzle-kit push — always
if (isDrizzleKitPush(cmd)) {
  deny(
    "Bloqueado: drizzle-kit push.",
    "Este repo usa migraciones versionadas (generate + migrate). Usá `pnpm db:generate` y `pnpm db:migrate`. No ejecutes `drizzle-kit push`.",
  );
}

// 4) git push force / main|master
if (/\bgit\s+push\b/i.test(cmd)) {
  if (isGitPushForce(cmd)) {
    deny(
      "Bloqueado: git push --force / --force-with-lease / -f.",
      "Hook denegó force-push (incluye --force-with-lease). No uses --force, -f ni --force-with-lease.",
    );
  }
  if (targetsMainOrMaster(cmd)) {
    deny(
      "Bloqueado: push directo a main/master.",
      "No hagas `git push` a main/master. Pusheá la feature branch y abrí PR con `gh pr create`.",
    );
  }
}

// 1) delete *.db
if (isDbDeletion(cmd)) {
  deny(
    "Bloqueado: borrado de archivos *.db.",
    "No borres bases SQLite (*.db). La DB local es data/feature-flags.db; usá migrate/seed, no la elimines.",
  );
}

// 2) aggressive rm outside allowlist
if (isAggressiveRm(cmd) && !allTargetsAllowlisted(cmd)) {
  deny(
    "Bloqueado: borrado recursivo fuera de allowlist.",
    "Solo se permite rm -rf / Remove-Item -Recurse sobre node_modules, dist o .next. Reformulá el comando.",
  );
}

allow();
