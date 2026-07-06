const { spawnSync } = require("node:child_process")

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 12_000

function truncate(value, limit = MAX_OUTPUT_CHARS) {
  const text = String(value || "")
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]` : text
}

function runCommand(command, projectRoot, timeoutMs) {
  const startedAt = Date.now()
  const result = spawnSync(command, {
    cwd: projectRoot,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  })
  const exitCode = typeof result.status === "number" ? result.status : result.error ? -1 : 0
  return {
    command,
    exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr || result.error?.message || ""),
    durationMs: Date.now() - startedAt,
    timedOut: result.error?.code === "ETIMEDOUT",
  }
}

function runQualityGate({ projectRoot, commands = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!projectRoot) throw new Error("projectRoot required")
  const list = (commands || []).map((command) => String(command || "").trim()).filter(Boolean)
  const startedAt = Date.now()
  if (!list.length) {
    return {
      status: "skipped",
      commandResults: [],
      durationMs: 0,
      summary: "未配置质量门命令，已跳过",
    }
  }

  const commandResults = []
  for (const command of list) {
    const result = runCommand(command, projectRoot, timeoutMs)
    commandResults.push(result)
    if (result.exitCode !== 0 || result.timedOut) break
  }

  const passed = commandResults.length === list.length && commandResults.every((item) => item.exitCode === 0 && !item.timedOut)
  return {
    status: passed ? "passed" : "failed",
    commandResults,
    durationMs: Date.now() - startedAt,
    summary: `${passed ? "通过" : "失败"}: ${commandResults.filter((item) => item.exitCode === 0 && !item.timedOut).length}/${list.length} 条质量门命令`,
  }
}

module.exports = {
  runQualityGate,
}
