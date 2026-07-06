#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function relativePath(filePath) {
  return path.relative(root, filePath)
}

function check(id, title, passed, detail, nextAction = "", extra = {}) {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    passed: Boolean(passed),
    detail,
    nextAction: passed ? "" : nextAction,
    ...extra,
  }
}

function fileCheck(id, title, filePath, requiredText = []) {
  const content = readText(filePath)
  const exists = content.trim().length > 0
  const missing = requiredText.filter((text) => !content.includes(text))
  return check(
    id,
    title,
    exists && missing.length === 0,
    exists ? `${relativePath(filePath)}; missing=${missing.join(",") || "none"}` : `${relativePath(filePath)} missing`,
    exists ? `Add required public release section: ${missing.join(", ")}.` : `Create ${relativePath(filePath)}.`,
    { path: relativePath(filePath), missing },
  )
}

function scanForSensitivePatterns(files) {
  const patterns = [
    { id: "openai_key", pattern: /sk-[A-Za-z0-9_-]{16,}/ },
    { id: "bearer_token", pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{12,}/i },
    { id: "private_key", pattern: /BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY/ },
    { id: "prompt_response_dump", pattern: /\b(prompt|response)\s*:\s*["'`][\s\S]{120,}/i },
  ]
  const hits = []
  for (const filePath of files) {
    const content = readText(filePath)
    for (const item of patterns) {
      if (item.pattern.test(content)) {
        hits.push({ file: relativePath(filePath), id: item.id })
      }
    }
  }
  return hits
}

function packageScripts() {
  const pkg = readJson(path.join(root, "package.json")) || {}
  return pkg.scripts || {}
}

function buildOpenSourceReadiness(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const publicFiles = [
    path.join(root, "README.md"),
    path.join(root, "LICENSE"),
    path.join(root, "THIRD_PARTY_NOTICES.md"),
    path.join(root, "SECURITY.md"),
    path.join(root, "PRIVACY.md"),
    path.join(root, "docs", "RELEASE_RUNBOOK.md"),
    path.join(root, "docs", "BETA_TRIAL.md"),
  ]
  const checks = [
    fileCheck("readme", "README public entrypoint", publicFiles[0], ["快速开始", "多 Agent", "沙箱", "公开发布状态"]),
    fileCheck("license", "LICENSE exists", publicFiles[1], ["MIT License"]),
    fileCheck("third_party_notices", "Third-party notices exist", publicFiles[2], ["Electron", "Monaco", "VS Code", "OpenVSX"]),
    fileCheck("security", "SECURITY policy exists", publicFiles[3], ["漏洞", "安全边界", "不要提交"]),
    fileCheck("privacy", "PRIVACY policy exists", publicFiles[4], ["本地", "API key", "遥测"]),
    fileCheck("release_runbook", "Release runbook exists", publicFiles[5], ["回滚", "签名", "校验值"]),
    fileCheck("beta_trial", "Beta trial exists", publicFiles[6], ["30 分钟", "Accept", "Rollback"]),
  ]

  const scripts = packageScripts()
  for (const script of ["doctor", "release:ci:check", "release:gate", "pack:win"]) {
    checks.push(check(
      `script_${script.replace(/[^a-z0-9]+/gi, "_")}`,
      `npm script ${script}`,
      Boolean(scripts[script]),
      scripts[script] ? `npm run ${script}` : `missing ${script}`,
      `Add ${script} to package.json scripts.`,
    ))
  }

  const workflowFiles = [
    path.join(root, ".github", "workflows", "release-gate.yml"),
    path.join(root, ".github", "workflows", "open-source-candidate.yml"),
  ]
  checks.push(check(
    "github_workflows",
    "GitHub Actions workflows exist",
    workflowFiles.every((filePath) => fs.existsSync(filePath)),
    workflowFiles.map((filePath) => `${relativePath(filePath)}=${fs.existsSync(filePath)}`).join("; "),
    "Add release-gate and open-source-candidate workflows.",
  ))

  const gitignore = readText(path.join(root, ".gitignore"))
  const protectedPatterns = [".env", "*.pem", "*.key", "*.p12", "*.pfx"]
  const missingIgnore = protectedPatterns.filter((pattern) => !gitignore.includes(pattern))
  checks.push(check(
    "secret_file_ignores",
    ".gitignore protects secret and signing files",
    missingIgnore.length === 0,
    missingIgnore.length === 0 ? protectedPatterns.join(",") : `missing ${missingIgnore.join(",")}`,
    "Add .env, certificate, private-key, and signing-file patterns to .gitignore.",
    { missing: missingIgnore },
  ))

  const sensitiveHits = scanForSensitivePatterns(publicFiles.filter((filePath) => fs.existsSync(filePath)))
  checks.push(check(
    "public_docs_secret_scan",
    "Public docs contain no obvious secrets or prompt dumps",
    sensitiveHits.length === 0,
    sensitiveHits.length === 0 ? "no sensitive pattern hits" : JSON.stringify(sensitiveHits),
    "Remove secrets, prompt/response bodies, private keys, or bearer tokens from public docs.",
    { hits: sensitiveHits },
  ))

  const failed = checks.filter((item) => !item.passed)
  const summary = {
    total: checks.length,
    passed: checks.length - failed.length,
    warning: 0,
    failed: failed.length,
  }
  return {
    reportKind: "open-source-readiness",
    createdAt,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "Open-source readiness passed" : "Open-source readiness blocked",
    summary,
    checks,
    nextActions: failed.map((item) => ({ id: item.id, title: item.title, action: item.nextAction })),
    scope: {
      publishes: false,
      pushes: false,
      storesSecrets: false,
      note: "Checks local public release files and scripts only. It does not push, publish, upload installers, or call GitHub.",
    },
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "open-source-readiness-latest.json"),
    latestMarkdownPath: path.join(resolved, "open-source-readiness-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.nextAction || "-")} |`,
  )
  return [
    "# Open Source Readiness",
    "",
    `- Status: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, failed=${report.summary.failed}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Boundaries",
    "",
    "- Does not push, publish, upload installers, or call GitHub.",
    "- Public docs are scanned for obvious secrets and large prompt/response dumps.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `open-source-readiness-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `open-source-readiness-${stamp}.md`)
  const md = toMarkdown(report)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${md}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${md}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: md }
}

function readLatest(options = {}) {
  const p = paths(options.reportDir)
  if (!fs.existsSync(p.latestJsonPath)) return { report: null, markdown: "", ...p }
  return {
    report: readJson(p.latestJsonPath),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildOpenSourceReadiness()
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildOpenSourceReadiness,
  defaultReportDir,
  readLatest,
  save,
  toMarkdown,
}
