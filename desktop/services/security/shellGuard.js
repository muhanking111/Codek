/**
 * Shell command validation. The guard's job is to prevent command-string injection
 * by enforcing argv-mode execution (never `shell: true` from agent-sourced calls)
 * and by classifying commands for the sandbox dispatcher.
 *
 * Policy:
 *   - source: 'user'  → no command restriction here; caller is responsible.
 *   - source: 'agent' → command must be a known binary; argv is validated for
 *                       obvious metacharacters; the dispatcher decides sandbox flavor.
 *
 * We intentionally do NOT maintain a hard allowlist of binaries — that's the job
 * of the sandbox backend (Seatbelt / Landlock / WSL / degraded). This module only
 * blocks shell-string smuggling and the most obvious injection vectors.
 */

const SHELL_METACHARS = /[;&|`$<>\n\r]/
const SUBSHELL_RE = /\$\(|<\(|>\(/
const BACKTICK_RE = /`/

/**
 * @param {string} command          Executable name or absolute path. Must not be a shell line.
 * @param {string[]} args           Argv. Each entry passed verbatim to spawn (no shell parsing).
 * @param {Object} [opts]
 * @param {import('./types').IpcSource} [opts.source='agent']
 * @returns {import('./types').GuardResult & { command?: string, args?: string[] }}
 */
function validateCommand(command, args, opts = {}) {
  const source = opts.source || "agent"
  if (typeof command !== "string" || command.length === 0) {
    return { ok: false, code: "EMPTY", message: "command is empty" }
  }
  if (!Array.isArray(args)) {
    return { ok: false, code: "BLOCKED", message: "args must be an array" }
  }

  // The command itself must be a single token, not a shell line.
  if (SHELL_METACHARS.test(command) || SUBSHELL_RE.test(command) || BACKTICK_RE.test(command)) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "command contains shell metacharacters; use argv form instead",
    }
  }

  if (source === "user") {
    return { ok: true, resolved: command, command, args }
  }

  // Agent-sourced: scan argv for command-substitution patterns. Plain redirection chars
  // are allowed inside argv strings (they are literal — no shell interprets them),
  // but $( ) and backticks indicate the caller is assembling a shell line.
  for (const a of args) {
    if (typeof a !== "string") {
      return { ok: false, code: "BLOCKED", message: "argv entries must be strings" }
    }
    if (SUBSHELL_RE.test(a) || BACKTICK_RE.test(a)) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "argv contains command-substitution syntax",
      }
    }
  }

  return { ok: true, resolved: command, command, args }
}

/**
 * Split a single command string into argv WITHOUT invoking a shell.
 * Supports single/double quotes; rejects shell metacharacters that we can't safely tokenize.
 * Use for legacy IPC call sites that still hand us "git commit -m ..." strings.
 *
 * @param {string} line
 * @returns {{ ok: true, command: string, args: string[] } | { ok: false, message: string }}
 */
function splitCommandLine(line) {
  if (typeof line !== "string" || line.trim().length === 0) {
    return { ok: false, message: "command line is empty" }
  }
  if (SHELL_METACHARS.test(line) || SUBSHELL_RE.test(line) || BACKTICK_RE.test(line)) {
    return { ok: false, message: "command line contains shell metacharacters" }
  }
  const tokens = []
  let buf = ""
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) { quote = null; continue }
      buf += c
      continue
    }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === " " || c === "\t") {
      if (buf.length > 0) { tokens.push(buf); buf = "" }
      continue
    }
    buf += c
  }
  if (quote) return { ok: false, message: "unterminated quote" }
  if (buf.length > 0) tokens.push(buf)
  if (tokens.length === 0) return { ok: false, message: "no tokens" }
  return { ok: true, command: tokens[0], args: tokens.slice(1) }
}

module.exports = { validateCommand, splitCommandLine, SHELL_METACHARS }
