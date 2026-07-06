const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { toMarkdown } = require("./report")

function defaultReportDir() {
  if (process.env.CODEK_EVAL_REPORT_DIR) return process.env.CODEK_EVAL_REPORT_DIR
  if (process.env.CODEK_DATA) return path.join(process.env.CODEK_DATA, "evals")
  return path.resolve(process.cwd(), ".codek", "evals")
}

function getReportPaths(reportDir = defaultReportDir()) {
  return {
    dir: reportDir,
    historyDir: path.join(reportDir, "history"),
    jsonPath: path.join(reportDir, "multi-agent-latest.json"),
    markdownPath: path.join(reportDir, "multi-agent-latest.md"),
  }
}

function reportStamp(report) {
  const date = new Date(report?.createdAt || Date.now())
  return date.toISOString().replace(/[:.]/g, "-")
}

function saveLatestReport(report, options = {}) {
  const paths = getReportPaths(options.reportDir)
  fs.mkdirSync(paths.dir, { recursive: true })
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = reportStamp(report)
  const historyJsonPath = path.join(paths.historyDir, `multi-agent-${stamp}.json`)
  const historyMarkdownPath = path.join(paths.historyDir, `multi-agent-${stamp}.md`)
  fs.writeFileSync(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.markdownPath, `${toMarkdown(report)}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${toMarkdown(report)}\n`, "utf8")
  return {
    ...paths,
    historyJsonPath,
    historyMarkdownPath,
    report,
  }
}

function readLatestReport(options = {}) {
  const paths = getReportPaths(options.reportDir)
  if (!fs.existsSync(paths.jsonPath)) {
    return {
      ...paths,
      report: null,
      markdown: "",
    }
  }
  const report = JSON.parse(fs.readFileSync(paths.jsonPath, "utf8"))
  const markdown = fs.existsSync(paths.markdownPath)
    ? fs.readFileSync(paths.markdownPath, "utf8")
    : toMarkdown(report)
  return {
    ...paths,
    report,
    markdown,
  }
}

function listReports(options = {}) {
  const paths = getReportPaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  const limit = Number(options.limit || 20)
  const entries = fs.readdirSync(paths.historyDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const jsonPath = path.join(paths.historyDir, file)
      try {
        const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
        const markdownPath = jsonPath.replace(/\.json$/, ".md")
        return {
          id: path.basename(file, ".json"),
          createdAt: report.createdAt || 0,
          total: report.total || 0,
          passed: report.passed || 0,
          failed: report.failed || 0,
          successRate: report.total ? Math.round(((report.passed || 0) / report.total) * 100) : 0,
          strategyComparison: report.strategyComparison || null,
          realRunComparison: report.realRunComparison || null,
          routerCalibration: report.routerCalibration || null,
          routerShadowEval: report.routerShadowEval || null,
          jsonPath,
          markdownPath,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
  return limit > 0 ? entries.slice(0, limit) : entries
}

module.exports = {
  defaultReportDir,
  getReportPaths,
  saveLatestReport,
  readLatestReport,
  listReports,
}
