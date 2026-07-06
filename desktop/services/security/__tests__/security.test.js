const test = require("node:test")
const assert = require("node:assert")
const path = require("node:path")
const os = require("node:os")
const fs = require("node:fs")

const { validatePath, safeRelative } = require("../pathGuard")
const { validateCommand, splitCommandLine } = require("../shellGuard")

const ROOT = fs.realpathSync(os.tmpdir())

test("pathGuard: rejects empty input", () => {
  const r = validatePath(ROOT, "")
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, "EMPTY")
})

test("pathGuard: rejects '..' traversal", () => {
  const r = validatePath(ROOT, "foo/../../etc/passwd")
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, "TRAVERSAL")
})

test("pathGuard: rejects absolute path when not allowed", () => {
  const r = validatePath(ROOT, "/etc/passwd")
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, "ABSOLUTE")
})

test("pathGuard: rejects absolute path outside root when allowed", () => {
  const outside = process.platform === "win32" ? "C:\\Windows\\system32" : "/etc/passwd"
  const r = validatePath(ROOT, outside, { allowAbsolute: true })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, "OUT_OF_ROOT")
})

test("pathGuard: accepts relative file inside root", () => {
  const r = validatePath(ROOT, "subdir/file.txt")
  assert.strictEqual(r.ok, true)
  assert.ok(r.resolved.startsWith(ROOT))
})

test("pathGuard: accepts absolute file inside root when allowed", () => {
  const target = path.join(ROOT, "child.txt")
  const r = validatePath(ROOT, target, { allowAbsolute: true })
  assert.strictEqual(r.ok, true)
})

test("safeRelative: strips absolute prefix and rejects ..", () => {
  assert.strictEqual(safeRelative("/foo/bar"), "foo/bar")
  assert.strictEqual(safeRelative("foo/../bar"), null)
  assert.strictEqual(safeRelative(""), null)
})

test("shellGuard: rejects shell metacharacters in command", () => {
  const r = validateCommand("rm; cat", [], { source: "agent" })
  assert.strictEqual(r.ok, false)
})

test("shellGuard: rejects $() in argv for agent", () => {
  const r = validateCommand("echo", ["$(whoami)"], { source: "agent" })
  assert.strictEqual(r.ok, false)
})

test("shellGuard: allows clean argv for agent", () => {
  const r = validateCommand("git", ["status", "--short"], { source: "agent" })
  assert.strictEqual(r.ok, true)
})

test("shellGuard: user source is allowed even with backticks in argv", () => {
  // user source skips argv-metachar scan; user has full authority.
  const r = validateCommand("echo", ["`uname`"], { source: "user" })
  assert.strictEqual(r.ok, true)
})

test("splitCommandLine: tokenizes quoted strings", () => {
  const r = splitCommandLine('git commit -m "hello world"')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.command, "git")
  assert.deepStrictEqual(r.args, ["commit", "-m", "hello world"])
})

test("splitCommandLine: rejects shell metachars", () => {
  const r = splitCommandLine("ls; rm -rf /")
  assert.strictEqual(r.ok, false)
})

test("splitCommandLine: rejects unterminated quote", () => {
  const r = splitCommandLine('echo "broken')
  assert.strictEqual(r.ok, false)
})
