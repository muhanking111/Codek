#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

const trialTasks = [
  {
    id: "BD-T01",
    title: "单文件文案修复",
    prompt: "把设置页里不自然的中文提示改得更像正式软件。",
    expectedStrategy: "single-agent",
    requiredResult: "计划、目标文件、文案变更 diff、Accept / Rework / Reject。",
    evidence: "文案变更数量、文件 hash、无源码正文记录。",
    required: true,
  },
  {
    id: "BD-T02",
    title: "单文件 bug 修复",
    prompt: "修复模式下拉框点外部不会自动关闭的问题。",
    expectedStrategy: "single-agent",
    requiredResult: "问题定位、修复 diff、回归检查结果。",
    evidence: "对应组件测试或 smoke 片段。",
    required: true,
  },
  {
    id: "BD-T03",
    title: "多文件 UI 整改",
    prompt: "把 ChatAI 输入区整理成更紧凑的企业级布局，并保证缩小时不重叠。",
    expectedStrategy: "multi-agent",
    requiredResult: "UI 计划、涉及组件、样式 diff、截图或 smoke 结果。",
    evidence: "最小宽度检查、布局状态、失败截图路径。",
    required: true,
  },
  {
    id: "BD-T04",
    title: "工作台行为修复",
    prompt: "打开文件夹后不要自动打开随机文件，只显示文件树。",
    expectedStrategy: "multi-agent",
    requiredResult: "行为说明、入口文件、状态同步、回滚方案。",
    evidence: "Electron smoke 或工作台状态报告。",
    required: true,
  },
  {
    id: "BD-T05",
    title: "质量门失败恢复",
    prompt: "改完后跑 typecheck，如果失败就自动分析并给我恢复建议。",
    expectedStrategy: "single-agent or multi-agent",
    requiredResult: "质量门失败分类、可重试动作、阻断原因。",
    evidence: "failure category、command exit code、recovery action。",
    required: true,
  },
  {
    id: "BD-T06",
    title: "冲突变更处理",
    prompt: "我手动改了同一个文件，你再帮我改并不要覆盖我的改动。",
    expectedStrategy: "multi-agent",
    requiredResult: "冲突提示、保留用户改动、Rework 或 Reject 入口。",
    evidence: "conflict count、protected files、决策记录。",
    required: true,
  },
  {
    id: "BD-T07",
    title: "附件参与任务",
    prompt: "参考我附加的截图和文件，把对应页面问题修一下。",
    expectedStrategy: "multi-agent",
    requiredResult: "附件摘要、引用关系、任务边界、diff。",
    evidence: "attachment hash、mime、size，不保存正文。",
    required: true,
  },
  {
    id: "BD-T08",
    title: "需求不清澄清",
    prompt: "把这里优化一下，看着高级点。",
    expectedStrategy: "single-agent clarify",
    requiredResult: "澄清问题或低风险建议，不直接乱改。",
    evidence: "ask_user recovery action 或 clarification state。",
    required: true,
  },
  {
    id: "BD-T09",
    title: "回滚路径",
    prompt: "接受这次改动后再回滚。",
    expectedStrategy: "single-agent",
    requiredResult: "Accept 后应用，Rollback 后恢复，状态可见。",
    evidence: "applied files、rollback id、恢复结果。",
    required: true,
  },
  {
    id: "BD-T10",
    title: "发布证据接入",
    prompt: "把这次多 Agent 试运行结果纳入发布验收报告。",
    expectedStrategy: "single-agent",
    requiredResult: "BD evidence 摘要、gap / ready 状态。",
    evidence: "release-evidence-latest.json 的 BD 维度。",
    required: true,
  },
]

const startupChecks = [
  ["launch", "启动", "应用打开后无蓝屏、白屏、自动弹出多余控制台。"],
  ["workbench", "工作台", "左侧资源管理器、编辑器、终端、ChatAI 可以正常显示和切换。"],
  ["folder", "项目", "打开文件夹后优先显示文件树，不自动强制打开随机文件。"],
  ["chat", "ChatAI", "输入区可见 Ask / Plan / Agent / Auto 模式和模型选择。"],
  ["evidence", "发布证据", "设置页或报告中能看到 release evidence / readiness / performance 状态。"],
]

const screenshotChecklist = [
  "首次启动后的工作台全图。",
  "打开项目后的文件树和编辑器状态。",
  "ChatAI 输入区模式与模型选择。",
  "Agent / Auto 任务运行中的任务卡片。",
  "计划、阶段、质量门和恢复动作。",
  "Diff / Accept / Rollback / Rework 决策界面。",
  "设置页或发布验收页中的 BD evidence 摘要。",
  "任意失败或卡顿状态。",
]

function buildMarkdown(report) {
  return [
    "# Codek 真实用户 Beta 试运行指南",
    "",
    "> 适用阶段：BD 真实用户多 Agent 试运行闭环产品化。",
    "> 目标：用 30-45 分钟验证普通用户是否能在 Codek 中从自然语言需求出发，完成真实的 `Agent` / `Auto` 多 Agent 协作任务闭环。",
    "> 公开候选补充：每轮公开候选 Beta trial 至少安排 30 分钟真实用户试运行，并保留 Accept / Rollback 证据。",
    "",
    "## 1. 试运行边界",
    "",
    "- 默认使用 `proposal-only`：任务确认前不写入主工作区。",
    "- 不要求测试人员理解单 Agent / 多 Agent 的区别；只需要在 ChatAI 选择 `Ask / Plan / Agent / Auto`。",
    "- 不采集用户 prompt 正文、附件正文、源代码正文、命令输出正文或密钥。",
    "- 试运行报告只允许记录结构化元数据：任务类型、文件数量、hash、长度、状态、错误类别、质量门结果和截图引用。",
    "- 任何需要写入真实项目的动作必须经过明确 `Accept`。",
    "",
    "## 2. 试运行前检查",
    "",
    "| 项目 | 通过标准 |",
    "| --- | --- |",
    ...startupChecks.map(([, title, expected]) => `| ${title} | ${expected} |`),
    "",
    "## 3. 标准试运行任务集",
    "",
    "| ID | 用户输入示例 | 预期内部策略 | 必须展示给用户的结果 | 质量门 / 证据 |",
    "| --- | --- | --- | --- | --- |",
    ...trialTasks.map((task) =>
      `| ${task.id} ${task.title} | "${task.prompt}" | ${task.expectedStrategy} | ${task.requiredResult} | ${task.evidence} |`,
    ),
    "",
    "## 4. 测试人员执行步骤",
    "",
    "1. 启动 Codek，打开一个可实验项目文件夹。",
    "2. 在 ChatAI 选择 `Agent` 或 `Auto`。",
    "3. 依次执行至少 5 个标准任务，必须包含：单文件修复、多文件整改、质量门失败恢复、回滚路径、附件参与任务。",
    "4. 每个任务都观察是否出现：run id、执行策略、计划、阶段状态、diff / artifact、质量门、决策按钮、恢复动作。",
    "5. 对低风险任务执行 `Accept`，再执行一次 `Rollback`。",
    "6. 记录失败任务是否能分类并恢复，不能恢复时记录错误类别和截图。",
    "7. 导出或查看最新 release evidence，确认 BD 维度是否进入报告。",
    "",
    "## 5. 截图清单",
    "",
    ...screenshotChecklist.map((item) => `- ${item}`),
    "",
    "## 6. 反馈模板",
    "",
    "```text",
    "系统：",
    "安装方式：installer / portable / source clone",
    "项目类型：",
    "Codek 版本或 commit：",
    "",
    "完成的任务 ID：",
    "未完成的任务 ID：",
    "",
    "最严重阻断：",
    "是否污染主工作区：否 / 是，请说明：",
    "是否看懂系统为什么选择单 Agent / 多 Agent：是 / 否",
    "是否看懂当前运行状态和下一步：是 / 否",
    "Accept / Rollback 是否可用：是 / 否",
    "质量门失败时是否知道怎么处理：是 / 否",
    "",
    "截图路径：",
    "报告路径：",
    "建议优先修复的问题：",
    "```",
    "",
    "## 7. 通过标准",
    "",
    "- 至少 5 类真实任务能从 ChatAI 发起并形成完整 run。",
    "- 用户无需打开 JSON，也能看懂任务阶段、风险、diff、质量门和下一步。",
    "- 默认不写主工作区；写入前必须有明确确认。",
    "- Accept、Rollback、Rework、Reject 至少各有一个可验证路径。",
    "- 失败能归类为权限等待、质量门失败、冲突、需求不清、超时或中断恢复。",
    "- 试运行结果进入 release evidence；未 ready 时 gap 必须说明缺少哪类用户闭环。",
    "",
    "## 8. 自动报告摘要",
    "",
    `- Report Kind: ${report.reportKind}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Required Tasks: ${report.summary.requiredTasks}`,
    `- Startup Checks: ${report.summary.startupChecks}`,
  ].join("\n")
}

function buildBetaTrialPlan(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const checks = [
    { id: "bd_task_count", passed: trialTasks.length >= 10, detail: `${trialTasks.length} BD tasks` },
    {
      id: "single_agent_tasks",
      passed: trialTasks.some((task) => task.expectedStrategy.includes("single-agent")),
      detail: "single-agent covered",
    },
    {
      id: "multi_agent_tasks",
      passed: trialTasks.some((task) => task.expectedStrategy.includes("multi-agent")),
      detail: "multi-agent covered",
    },
    {
      id: "attachment_task",
      passed: trialTasks.some((task) => /附件/.test(`${task.title} ${task.prompt}`)),
      detail: "attachment task present",
    },
    {
      id: "accept_rollback_task",
      passed: trialTasks.some((task) => /回滚|Rollback/i.test(`${task.title} ${task.requiredResult}`)),
      detail: "accept/rollback path present",
    },
    {
      id: "quality_gate_failure_task",
      passed: trialTasks.some((task) => /质量门/.test(`${task.title} ${task.requiredResult}`)),
      detail: "quality gate failure recovery present",
    },
    {
      id: "privacy_boundary",
      passed: true,
      detail: "prompt/source/attachment/command payloads are excluded by policy",
    },
  ].map((item) => ({
    ...item,
    status: item.passed ? "passed" : "failed",
    nextAction: item.passed ? "" : "补齐 BD 真实用户试运行任务集。",
  }))
  const failed = checks.filter((item) => !item.passed)
  const report = {
    reportKind: "bd-user-trial-plan",
    createdAt,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "BD 真实用户试运行计划已就绪" : "BD 真实用户试运行计划需补齐",
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      warning: 0,
      failed: failed.length,
      requiredTasks: trialTasks.filter((task) => task.required).length,
      startupChecks: startupChecks.length,
      screenshotItems: screenshotChecklist.length,
    },
    checks,
    tasks: trialTasks.map((task) => ({ ...task })),
    startupChecks: startupChecks.map(([id, title, expected]) => ({ id, title, expected })),
    screenshotChecklist: screenshotChecklist.slice(),
    privacyPolicy: {
      allow: ["run id", "task id", "strategy", "stage status", "file count", "hash", "byte length", "exit code", "failure category", "decision status"],
      deny: ["prompt text", "attachment body", "source code body", "full diff body", "full command output", "secret values"],
    },
    nextActions: failed.map((item) => ({ id: item.id, action: item.nextAction })),
  }
  report.markdown = buildMarkdown(report)
  return report
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "beta-trial-plan-latest.json"),
    latestMarkdownPath: path.join(resolved, "beta-trial-plan-latest.md"),
    docsMarkdownPath: path.join(root, "docs", "BETA_TRIAL.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  fs.mkdirSync(path.dirname(p.docsMarkdownPath), { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `beta-trial-plan-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `beta-trial-plan-${stamp}.md`)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(p.docsMarkdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${report.markdown}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: report.markdown }
}

function readLatest(options = {}) {
  const p = paths(options.reportDir)
  if (!fs.existsSync(p.latestJsonPath)) return { report: null, markdown: "", ...p }
  const markdown = fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : ""
  return {
    report: JSON.parse(fs.readFileSync(p.latestJsonPath, "utf8")),
    markdown,
    jsonPath: p.latestJsonPath,
    markdownPath: markdown ? p.latestMarkdownPath : "",
    ...p,
  }
}

function listBetaTrialPlans(options = {}) {
  const p = paths(options.reportDir)
  if (!fs.existsSync(p.historyDir)) return []
  return fs.readdirSync(p.historyDir)
    .filter((name) => /^beta-trial-plan-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(p.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        createdAt: Number(report.createdAt || 0),
        ready: report.ready === true,
        status: report.status || "",
        summary: report.summary || {},
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildBetaTrialPlan()
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
  buildBetaTrialPlan,
  readLatest,
  save,
  listBetaTrialPlans,
  steps: trialTasks,
  trialTasks,
  startupChecks,
}
