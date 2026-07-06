#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath))
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

function check(name, passed, detail = "") {
  return { name, passed: !!passed, detail }
}

function includesAll(content, patterns) {
  return patterns.every((pattern) => content.includes(pattern))
}

function main() {
  const main = exists("desktop/main.js") ? read("desktop/main.js") : ""
  const preload = exists("desktop/preload.js") ? read("desktop/preload.js") : ""
  const services = exists("desktop/services/index.js") ? read("desktop/services/index.js") : ""
  const routes = exists("desktop/services/agentLoop/orchestratorRoutes.js")
    ? read("desktop/services/agentLoop/orchestratorRoutes.js")
    : ""
  const panel = exists("frontend/vite-project/src/components/AgentOrchestratorPanel.vue")
    ? read("frontend/vite-project/src/components/AgentOrchestratorPanel.vue")
    : ""

  const checks = [
    check("桌面主入口存在", !!main, "desktop/main.js"),
    check("预加载桥存在", !!preload, "desktop/preload.js"),
    check("前端构建产物存在", exists("frontend/vite-project/dist/index.html"), "先运行 npm run build 或 npm run build:frontend"),
    check("BrowserWindow 使用安全预加载", includesAll(main, ["preload: path.join(__dirname, \"preload.js\")", "contextIsolation: true"]), "preload + contextIsolation"),
    check("主进程注册 in-process services", includesAll(main, ["registerServices()", "setupIPC()"]), "registerServices + setupIPC"),
    check("preload 暴露统一 API 桥", includesAll(preload, ["api: (method, path, body, headers)", "agentLoop:", "openEvalReport"]), "api / agentLoop / openEvalReport"),
    check("Orchestrator routes 已注册", includesAll(services, ["./agentLoop/orchestratorRoutes"]), "desktop/services/index.js"),
    check("Orchestrator 核心 API 完整", includesAll(routes, [
      "POST\", \"/api/orchestrator/runs\"",
      "GET\", \"/api/orchestrator/runs/:id/events\"",
      "GET\", \"/api/orchestrator/evals/latest\"",
      "POST\", \"/api/orchestrator/evals/run\"",
      "recovery-actions/:actionId/execute",
    ]), "runs / events / evals / recovery"),
    check("评测报告本地打开受限", includesAll(main, ["app:openEvalReport", ".codek\", \"evals", "CODEK_DATA, \"evals", "path.extname(resolved).toLowerCase() !== \".md\""]), "只允许 eval 目录下的 md 报告"),
    check("Orchestrator 面板接入评测与恢复", includesAll(panel, ["AgentEvalSummary", "AgentRecoveryActions", "AgentDiffViewer"]), "eval / recovery / diff"),
  ]

  const failed = checks.filter((item) => !item.passed)
  for (const item of checks) {
    const mark = item.passed ? "PASS" : "FAIL"
    process.stdout.write(`${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ""}\n`)
  }

  process.stdout.write("\n真实 Electron 窗口验收步骤:\n")
  process.stdout.write("1. 运行 npm run dev:frontend，然后运行 npm run start。\n")
  process.stdout.write("2. 打开 ChatAI，确认只显示 Ask / Plan / Agent / Auto 四种模式，Agent 内部展示自动策略原因。\n")
  process.stdout.write("3. 打开 Orchestrator 面板，运行评测，确认摘要、任务明细、历史趋势可刷新。\n")
  process.stdout.write("4. 点击 latest 和历史记录的打开报告，确认系统打开 .codek/evals 下的 Markdown 报告。\n")
  process.stdout.write("5. 创建一个失败 run，确认 retry / ask_user / abort 等恢复动作可见且可执行。\n")
  process.stdout.write("6. 创建一个有 patch 的 run，确认 diff 查看、Accept、质量门失败回滚路径符合预期。\n")

  if (failed.length) {
    process.stderr.write(`\nElectron smoke precheck failed: ${failed.length} item(s).\n`)
    process.exit(1)
  }

  process.stdout.write("\nElectron smoke precheck passed.\n")
}

main()
