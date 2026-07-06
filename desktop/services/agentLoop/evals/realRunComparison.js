const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const orchestrator = require("../orchestrator")
const planExecutor = require("../planExecutor")
const planTree = require("../planTree")
const artifactStore = require("../artifactStore")
const { summarizeRunMetrics } = require("./metrics")
const { classifyComparisonFailure, summarizeFailureRecommendations } = require("./failureRecommendations")

const STRATEGIES = ["single-agent", "multi-agent"]
const FIXTURE_TYPES = new Set([
  "single-file",
  "multi-file",
  "refactor-flow",
  "ui-component",
  "backend-api",
  "settings-schema",
  "extension-flow",
  "dependency-upgrade",
  "cross-language",
  "extension-conflict",
  "large-refactor",
  "partial-failure",
  "quality-fail",
  "conflict",
])

function normalizeId(value) {
  return String(value || "task").replace(/[^\w.-]+/g, "_").slice(0, 80)
}

function ensureInsideTemp(projectRoot) {
  const root = path.resolve(projectRoot || "")
  const temp = path.resolve(os.tmpdir())
  if (root !== temp && !root.startsWith(temp + path.sep)) {
    throw new Error(`real run fixture must stay inside temp dir: ${root}`)
  }
}

function fixtureType(task = {}) {
  const value = String(task.fixtureType || "").toLowerCase()
  if (FIXTURE_TYPES.has(value)) return value
  const fileCount = Array.isArray(task.files) ? task.files.length : 0
  if (fileCount >= 3) return "multi-file"
  return "single-file"
}

function createFixtureProject(task = {}, strategy = "single-agent") {
  const type = fixtureType(task)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `codek-real-run-${normalizeId(task.id)}-${type}-${strategy}-`))
  fs.writeFileSync(path.join(root, "demo.js"), [
    "export const value = 1",
    "export function label() {",
    `  return "${normalizeId(task.id)}"`,
    "}",
    "",
  ].join("\n"), "utf8")
  if (type === "multi-file") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "app.js"), "import { state } from './state.js'\nexport const app = state.name\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "state.js"), "export const state = { name: 'codek', ready: false }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "view.js"), "export function render(value) { return String(value) }\n", "utf8")
  }
  if (type === "refactor-flow") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "model.js"), "export const model = { name: 'codek', version: 1 }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "service.js"), "import { model } from './model.js'\nexport function getName() { return model.name }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "app.js"), "import { getName } from './service.js'\nexport const app = getName()\n", "utf8")
  }
  if (type === "ui-component") {
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "components", "Panel.js"), "export function panelTitle() { return 'Codek' }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "components", "Panel.css"), ".panel { color: #fff; }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "app.js"), "import { panelTitle } from './components/Panel.js'\nexport const title = panelTitle()\n", "utf8")
  }
  if (type === "backend-api") {
    fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "routes", "health.js"), "export function health() { return { ok: true } }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "api.js"), "import { health } from './routes/health.js'\nexport const routes = { health }\n", "utf8")
  }
  if (type === "settings-schema") {
    fs.mkdirSync(path.join(root, "src", "settings"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "settings", "schema.js"), "export const schema = { theme: 'dark' }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "settings", "runtime.js"), "import { schema } from './schema.js'\nexport function readSetting(key) { return schema[key] }\n", "utf8")
  }
  if (type === "extension-flow") {
    fs.mkdirSync(path.join(root, "src", "extensions"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "extensions", "registry.js"), "export const extensions = []\nexport function register(item) { extensions.push(item) }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "extensions", "marketplace.js"), "import { register } from './registry.js'\nexport function install(id) { register({ id }) }\n", "utf8")
  }
  if (type === "dependency-upgrade") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "deps.js"), "export const runtime = { vite: '5.0.0', electron: '28.0.0' }\nexport function supported(name) { return Boolean(runtime[name]) }\n", "utf8")
  }
  if (type === "cross-language") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.mkdirSync(path.join(root, "python"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "bridge.js"), "export function callPython(payload) { return JSON.stringify(payload) }\n", "utf8")
    fs.writeFileSync(path.join(root, "python", "worker.py"), "def transform(value):\n    return str(value)\n", "utf8")
    fs.writeFileSync(path.join(root, "README.md"), "# Cross language fixture\n", "utf8")
  }
  if (type === "extension-conflict") {
    fs.mkdirSync(path.join(root, "src", "extensions"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "extensions", "manifest.js"), "export const extensionPolicy = { id: 'codek.agent', version: '1.0.0', enabled: true }\n", "utf8")
  }
  if (type === "large-refactor") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "domain.js"), "export const domain = { name: 'codek' }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "store.js"), "export const store = { ready: false }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "service.js"), "import { store } from './store.js'\nexport function isReady() { return store.ready }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "view.js"), "export function view(value) { return String(value) }\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "app.js"), "import { isReady } from './service.js'\nexport const app = isReady()\n", "utf8")
  }
  if (type === "partial-failure") {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "safe.js"), "export const safe = false\n", "utf8")
    fs.writeFileSync(path.join(root, "src", "risky.js"), "export const risky = false\n", "utf8")
  }
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: `codek-real-run-${normalizeId(task.id)}`,
    private: true,
    type: "module",
  }, null, 2)}\n`, "utf8")
  return root
}

function implementFilesForTask(task = {}) {
  const type = fixtureType(task)
  const requestedFiles = Array.isArray(task.files) ? task.files.filter(Boolean) : []
  if (requestedFiles.length) return requestedFiles
  if (type === "refactor-flow") return ["src/model.js", "src/service.js", "src/app.js"]
  if (type === "ui-component") return ["src/components/Panel.js", "src/components/Panel.css", "src/app.js"]
  if (type === "backend-api") return ["src/routes/health.js", "src/api.js"]
  if (type === "settings-schema") return ["src/settings/schema.js", "src/settings/runtime.js"]
  if (type === "extension-flow") return ["src/extensions/registry.js", "src/extensions/marketplace.js"]
  if (type === "dependency-upgrade") return ["package.json", "src/deps.js"]
  if (type === "cross-language") return ["src/bridge.js", "python/worker.py", "README.md"]
  if (type === "extension-conflict") return ["src/extensions/manifest.js"]
  if (type === "large-refactor") return ["src/domain.js", "src/store.js", "src/service.js", "src/view.js", "src/app.js"]
  if (type === "partial-failure") return ["src/safe.js", "src/risky.js"]
  if (type === "multi-file") return ["src/app.js", "src/state.js", "src/view.js"]
  return ["demo.js"]
}

function createGenericMultiFilePlan(goal, files, label = "多文件 fixture") {
  const phases = [
    {
      id: "phase_plan",
      name: `规划${label}`,
      agent: "planner",
      tasks: [{ description: `分析${label}边界`, files }],
    },
  ]
  files.forEach((file, index) => {
    phases.push({
      id: `phase_file_${index + 1}`,
      name: `更新 ${file}`,
      agent: "implementer",
      dependsOn: ["phase_plan"],
      tasks: [{ description: `修改 ${file}`, files: [file] }],
    })
  })
  phases.push({
    id: "phase_verify",
    name: `验证${label}`,
    agent: "verifier",
    dependsOn: files.map((_, index) => `phase_file_${index + 1}`),
    tasks: [{ description: "运行 node --check 入口文件", files }],
  })
  return planTree.createPlan(goal, phases)
}

function createPlanForTask(task = {}, strategy = "single-agent") {
  const goal = task.goal || task.prompt || task.name || task.id || "real run fixture"
  const type = fixtureType(task)
  const files = implementFilesForTask(task)
  if (strategy === "multi-agent") {
    if (type === "multi-file") {
      return planTree.createPlan(goal, [
        {
          id: "phase_plan",
          name: "规划多文件 fixture 改动",
          agent: "planner",
          tasks: [{ description: "分析 src/app.js、src/state.js 和 src/view.js 的联动" }],
        },
        {
          id: "phase_state",
          name: "更新状态模块",
          agent: "implementer",
          dependsOn: ["phase_plan"],
          tasks: [{ description: "修改 src/state.js", files: ["src/state.js"] }],
        },
        {
          id: "phase_view",
          name: "更新视图模块",
          agent: "implementer",
          dependsOn: ["phase_plan"],
          tasks: [{ description: "修改 src/view.js", files: ["src/view.js"] }],
        },
        {
          id: "phase_app",
          name: "串联入口模块",
          agent: "integrator",
          dependsOn: ["phase_state", "phase_view"],
          tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }],
        },
        {
          id: "phase_verify",
          name: "验证多文件 fixture 语法",
          agent: "verifier",
          dependsOn: ["phase_app"],
          tasks: [{ description: "运行 node --check src/app.js", files }],
        },
      ])
    }
    if (type === "refactor-flow") {
      return planTree.createPlan(goal, [
        {
          id: "phase_plan",
          name: "规划分层重构 fixture",
          agent: "planner",
          tasks: [{ description: "分析 src/model.js、src/service.js 和 src/app.js 的重构边界" }],
        },
        {
          id: "phase_model",
          name: "更新模型层",
          agent: "implementer",
          dependsOn: ["phase_plan"],
          tasks: [{ description: "修改 src/model.js", files: ["src/model.js"] }],
        },
        {
          id: "phase_service",
          name: "更新服务层",
          agent: "implementer",
          dependsOn: ["phase_model"],
          tasks: [{ description: "修改 src/service.js", files: ["src/service.js"] }],
        },
        {
          id: "phase_app",
          name: "串联入口层",
          agent: "integrator",
          dependsOn: ["phase_service"],
          tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }],
        },
        {
          id: "phase_verify",
          name: "验证分层重构 fixture 语法",
          agent: "verifier",
          dependsOn: ["phase_app"],
          tasks: [{ description: "运行 node --check src/app.js", files }],
        },
      ])
    }
    if (type === "conflict" || type === "extension-conflict") {
      const conflictFile = type === "extension-conflict" ? "src/extensions/manifest.js" : "demo.js"
      return planTree.createPlan(goal, [
        {
          id: "phase_alpha",
          name: "并行实现 A",
          agent: "implementer",
          tasks: [{ description: "修改 demo.js 的 A 方案", files: ["demo.js"] }],
        },
        {
          id: "phase_beta",
          name: "并行实现 B",
          agent: "implementer",
          tasks: [{ description: "修改 demo.js 的 B 方案", files: ["demo.js"] }],
        },
      ])
    }
    if (type === "partial-failure") {
      return planTree.createPlan(goal, [
        {
          id: "phase_safe",
          name: "保留安全子任务结果",
          agent: "implementer",
          tasks: [{ description: "修改 src/safe.js", files: ["src/safe.js"] }],
        },
        {
          id: "phase_risky",
          name: "模拟失败子任务",
          agent: "implementer",
          tasks: [{ description: "修改 src/risky.js 但触发失败恢复", files: ["src/risky.js"] }],
        },
      ])
    }
    if (["ui-component", "backend-api", "settings-schema", "extension-flow", "dependency-upgrade", "cross-language", "large-refactor"].includes(type)) {
      return createGenericMultiFilePlan(goal, files, type)
    }
    return planTree.createPlan(goal, [
      {
        id: "phase_plan",
        name: "规划安全 fixture 改动",
        agent: "planner",
        tasks: [{ description: "分析 fixture demo.js 的确定性改动" }],
      },
      {
        id: "phase_implement",
        name: "实现 fixture 改动",
        agent: "implementer",
        dependsOn: ["phase_plan"],
        tasks: [{ description: "修改 demo.js 中的 value", files }],
      },
      {
        id: "phase_verify",
        name: "验证 fixture 语法",
        agent: "verifier",
        dependsOn: ["phase_implement"],
        tasks: [{ description: "运行 node --check demo.js", files }],
      },
    ])
  }
  return planTree.createPlan(goal, [
    {
      id: "phase_implement",
      name: "实现并验证 fixture 改动",
      agent: "implementer",
      tasks: [{ description: "修改 fixture 文件并运行安全质量门", files }],
    },
  ])
}

function writeFixturePatch({ task, strategy, workspaceRoot, phaseId }) {
  const type = fixtureType(task)
  if (type === "multi-file") {
    if (phaseId === "phase_state" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "state.js"), "export const state = { name: 'codek', ready: true }\n", "utf8")
    }
    if (phaseId === "phase_view" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "view.js"), "export function render(value) { return `[${String(value)}]` }\n", "utf8")
    }
    if (phaseId === "phase_app" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "app.js"), "import { state } from './state.js'\nimport { render } from './view.js'\nexport const app = render(state.name)\n", "utf8")
    }
    return phaseId === "phase_state" ? ["src/state.js"]
      : phaseId === "phase_view" ? ["src/view.js"]
      : phaseId === "phase_app" ? ["src/app.js"]
      : ["src/app.js", "src/state.js", "src/view.js"]
  }
  if (type === "refactor-flow") {
    if (phaseId === "phase_model" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "model.js"), "export const model = { name: 'codek', version: 2, ready: true }\n", "utf8")
    }
    if (phaseId === "phase_service" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "service.js"), "import { model } from './model.js'\nexport function createViewModel() { return `${model.name}@${model.version}` }\n", "utf8")
    }
    if (phaseId === "phase_app" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "app.js"), "import { createViewModel } from './service.js'\nexport const app = createViewModel()\n", "utf8")
    }
    return phaseId === "phase_model" ? ["src/model.js"]
      : phaseId === "phase_service" ? ["src/service.js"]
      : phaseId === "phase_app" ? ["src/app.js"]
      : ["src/app.js", "src/model.js", "src/service.js"]
  }
  if (type === "ui-component") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "components", "Panel.js"), "export function panelTitle() { return 'Codek Agent' }\nexport function panelState() { return 'ready' }\n", "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "components", "Panel.css"), ".panel { color: #fff; display: grid; gap: 8px; }\n", "utf8")
    }
    if (phaseId === "phase_file_3" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "app.js"), "import { panelTitle, panelState } from './components/Panel.js'\nexport const title = `${panelTitle()}:${panelState()}`\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["src/components/Panel.js"]
      : phaseId === "phase_file_2" ? ["src/components/Panel.css"]
      : phaseId === "phase_file_3" ? ["src/app.js"]
      : ["src/app.js", "src/components/Panel.css", "src/components/Panel.js"]
  }
  if (type === "backend-api") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "routes", "health.js"), "export function health() { return { ok: true, service: 'codek' } }\n", "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "api.js"), "import { health } from './routes/health.js'\nexport const routes = { health, ready: () => health().ok }\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["src/routes/health.js"] : phaseId === "phase_file_2" ? ["src/api.js"] : ["src/api.js", "src/routes/health.js"]
  }
  if (type === "settings-schema") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "settings", "schema.js"), "export const schema = { theme: 'dark', agentApproval: 'ask' }\n", "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "settings", "runtime.js"), "import { schema } from './schema.js'\nexport function readSetting(key) { return schema[key] }\nexport function hasSetting(key) { return key in schema }\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["src/settings/schema.js"] : phaseId === "phase_file_2" ? ["src/settings/runtime.js"] : ["src/settings/runtime.js", "src/settings/schema.js"]
  }
  if (type === "extension-flow") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "extensions", "registry.js"), "export const extensions = []\nexport function register(item) { extensions.push({ ...item, enabled: true }) }\nexport function list() { return extensions }\n", "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "extensions", "marketplace.js"), "import { register, list } from './registry.js'\nexport function install(id) { register({ id }) }\nexport function installed() { return list() }\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["src/extensions/registry.js"] : phaseId === "phase_file_2" ? ["src/extensions/marketplace.js"] : ["src/extensions/marketplace.js", "src/extensions/registry.js"]
  }
  if (type === "dependency-upgrade") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "package.json"), `${JSON.stringify({
        name: `codek-real-run-${normalizeId(task.id)}`,
        private: true,
        type: "module",
        dependencies: {
          "@vitejs/plugin-vue": "^5.2.0",
          electron: "^30.5.1",
          vite: "^5.4.0",
        },
        devDependencies: {
          "vue-tsc": "^2.2.0",
        },
      }, null, 2)}\n`, "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "deps.js"), "export const runtime = { vite: '5.4.0', electron: '30.5.1', vueTsc: '2.2.0' }\nexport function supported(name) { return Boolean(runtime[name]) }\nexport function version(name) { return runtime[name] || null }\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["package.json"] : phaseId === "phase_file_2" ? ["src/deps.js"] : ["package.json", "src/deps.js"]
  }
  if (type === "cross-language") {
    if (phaseId === "phase_file_1" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "bridge.js"), "export function callPython(payload) { return JSON.stringify({ ok: true, payload }) }\nexport const bridgeReady = true\n", "utf8")
    }
    if (phaseId === "phase_file_2" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "python", "worker.py"), "def transform(value):\n    return {\"ok\": True, \"value\": str(value)}\n", "utf8")
    }
    if (phaseId === "phase_file_3" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Cross language fixture\n\n- JS bridge calls Python worker.\n- Verification keeps changes isolated.\n", "utf8")
    }
    return phaseId === "phase_file_1" ? ["src/bridge.js"]
      : phaseId === "phase_file_2" ? ["python/worker.py"]
      : phaseId === "phase_file_3" ? ["README.md"]
      : ["README.md", "python/worker.py", "src/bridge.js"]
  }
  if (type === "extension-conflict") {
    const version = phaseId === "phase_beta" ? "2.0.0-beta" : "2.0.0"
    const source = phaseId === "phase_beta" ? "marketplace-beta" : "openvsx"
    fs.writeFileSync(path.join(workspaceRoot, "src", "extensions", "manifest.js"), `export const extensionPolicy = { id: 'codek.agent', version: '${version}', enabled: true, source: '${source}' }\n`, "utf8")
    return ["src/extensions/manifest.js"]
  }
  if (type === "large-refactor") {
    const map = [
      ["src/domain.js", "export const domain = { name: 'codek', version: 2 }\n"],
      ["src/store.js", "export const store = { ready: true, updatedAt: 1 }\n"],
      ["src/service.js", "import { store } from './store.js'\nexport function isReady() { return store.ready }\nexport function status() { return store.updatedAt }\n"],
      ["src/view.js", "export function view(value) { return `ready:${String(value)}` }\n"],
      ["src/app.js", "import { isReady, status } from './service.js'\nimport { view } from './view.js'\nexport const app = view(`${isReady()}:${status()}`)\n"],
    ]
    map.forEach(([file, content], index) => {
      if (phaseId === `phase_file_${index + 1}` || strategy === "single-agent") {
        fs.writeFileSync(path.join(workspaceRoot, file), content, "utf8")
      }
    })
    const idx = Number(String(phaseId).replace("phase_file_", "")) - 1
    return idx >= 0 && map[idx] ? [map[idx][0]] : map.map(([file]) => file)
  }
  if (type === "partial-failure") {
    if (phaseId === "phase_safe" || strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "safe.js"), "export const safe = true\nexport const preserved = 'safe-agent-result'\n", "utf8")
    }
    if (phaseId === "phase_risky") {
      throw new Error("simulated sub-agent failure after safe patch")
    }
    if (strategy === "single-agent") {
      fs.writeFileSync(path.join(workspaceRoot, "src", "risky.js"), "export const risky = true\n", "utf8")
    }
    return phaseId === "phase_safe" ? ["src/safe.js"] : ["src/safe.js", "src/risky.js"]
  }
  const brokenSyntax = type === "quality-fail"
  const conflictSuffix = phaseId === "phase_beta" ? "conflict-beta" : strategy
  fs.writeFileSync(path.join(workspaceRoot, "demo.js"), brokenSyntax
    ? "export const value = \n"
    : [
      `export const value = ${strategy === "multi-agent" ? 3 : 2}`,
      "export function label() {",
      `  return "${conflictSuffix}"`,
      "}",
      "",
    ].join("\n"), "utf8")
  return ["demo.js"]
}

function makeFixtureExecutor(strategy, task = {}) {
  return async ({ plan, emit }) => {
    emit({ type: "plan", plan })
    for (const phase of plan.phases) {
      emit({ type: "phase_start", phaseId: phase.id, name: phase.name })
      if (phase.id.includes("implement") || phase.id.startsWith("phase_file_") || phase.id === "phase_state" || phase.id === "phase_view" || phase.id === "phase_model" || phase.id === "phase_service" || phase.id === "phase_app" || phase.id === "phase_alpha" || phase.id === "phase_beta" || phase.id === "phase_safe" || phase.id === "phase_risky") {
        const workspaceRoot = phase.workspaceRoot
        if (!workspaceRoot) throw new Error("fixture phase workspaceRoot missing")
        let filesChanged
        try {
          filesChanged = writeFixturePatch({ task, strategy, workspaceRoot, phaseId: phase.id })
        } catch (err) {
          emit({ type: "phase_failed", phaseId: phase.id, error: err instanceof Error ? err.message : String(err) })
          throw err
        }
        emit({ type: "phase_done", phaseId: phase.id, summary: `${strategy} ${fixtureType(task)} fixture patch generated`, filesChanged })
      } else {
        emit({ type: "phase_done", phaseId: phase.id, summary: `${phase.id} completed`, filesChanged: [] })
      }
    }
    plan.status = planTree.STATUS.DONE
    emit({ type: "plan_done", planId: plan.id })
    return { plan, summary: `${strategy} real fixture completed` }
  }
}

function listRecoveryActionsForMetrics(runId) {
  try {
    return orchestrator.listRecoveryActions(runId)
  } catch {
    return []
  }
}

async function runStrategyFixture(task = {}, strategy = "single-agent", options = {}) {
  if (!STRATEGIES.includes(strategy)) throw new Error(`unsupported strategy: ${strategy}`)
  const projectRoot = createFixtureProject(task, strategy)
  ensureInsideTemp(projectRoot)
  const plan = createPlanForTask(task, strategy)
  const originalExecute = planExecutor.execute
  planExecutor.execute = makeFixtureExecutor(strategy, task)
  const type = fixtureType(task)
  const qualityTargets = {
    "multi-file": "src/app.js",
    "refactor-flow": "src/app.js",
    "ui-component": "src/app.js",
    "backend-api": "src/api.js",
    "settings-schema": "src/settings/runtime.js",
    "extension-flow": "src/extensions/marketplace.js",
    "dependency-upgrade": "src/deps.js",
    "cross-language": "src/bridge.js",
    "extension-conflict": "src/extensions/manifest.js",
    "large-refactor": "src/app.js",
  }
  const qualityTarget = qualityTargets[type] || "demo.js"
  try {
    const run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: task.goal || task.prompt || task.name || task.id,
      agentStrategy: strategy,
      files: implementFilesForTask(task),
      risk: task.risk || "safe",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: [`node --check ${qualityTarget}`],
    })
    const shouldAutoAccept = options.autoAccept !== false
    if (shouldAutoAccept && run.status === "waiting_user" && !run.integrationDecision?.conflicts?.length) {
      orchestrator.applyDecision(run.id, "accepted", "F19 隔离实跑自动确认临时 patch")
    }
    const completed = orchestrator.getRun(run.id)
    const artifacts = artifactStore.listArtifacts(run.id)
    const recoveryActions = listRecoveryActionsForMetrics(run.id)
    return {
      strategy,
      fixtureType: type,
      projectRoot,
      runId: completed?.id || null,
      status: completed?.status || null,
      metrics: summarizeRunMetrics({ run: completed, artifacts, recoveryActions }),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        metadata: artifact.metadata,
      })),
    }
  } finally {
    planExecutor.execute = originalExecute
  }
}

function scoreRealRun(result = {}) {
  const metrics = result.metrics || {}
  const qualityGateFailures = metrics.qualityGate?.failedCommandCount || 0
  const statusPenalty = metrics.status === "completed" ? 0 : 40
  const durationPenalty = Math.min(30, Math.round((metrics.durationMs || 0) / 100))
  const conflictPenalty = (metrics.conflictCount || 0) * 12
  const qualityPenalty = qualityGateFailures * 18
  return Math.max(0, 100 - statusPenalty - durationPenalty - conflictPenalty - qualityPenalty)
}

function summarizeRealRunComparison(items = []) {
  const pairs = items.filter(Boolean)
  const byStrategy = Object.fromEntries(pairs.map((item) => [item.strategy, item]))
  const scores = Object.fromEntries(pairs.map((item) => [item.strategy, scoreRealRun(item)]))
  const winner = scores["multi-agent"] > scores["single-agent"] ? "multi-agent" : "single-agent"
  const totalDurationMs = pairs.reduce((sum, item) => sum + Number(item.metrics?.durationMs || 0), 0)
  const summary = {
    totalRuns: pairs.length,
    winner,
    scores,
    completedRuns: pairs.filter((item) => item.metrics?.status === "completed").length,
    totalDurationMs,
    averageDurationMs: pairs.length ? Math.round(totalDurationMs / pairs.length) : 0,
    totalQualityGateFailures: pairs.reduce((sum, item) => sum + Number(item.metrics?.qualityGate?.failedCommandCount || 0), 0),
    totalConflicts: pairs.reduce((sum, item) => sum + Number(item.metrics?.conflictCount || 0), 0),
    fixtureTypes: [...new Set(pairs.map((item) => item.fixtureType).filter(Boolean))],
    singleAgent: byStrategy["single-agent"]?.metrics || null,
    multiAgent: byStrategy["multi-agent"]?.metrics || null,
  }
  summary.failureRecommendation = classifyComparisonFailure({ summary })
  return summary
}

async function runTaskRealComparison(task = {}) {
  const runs = []
  for (const strategy of STRATEGIES) {
    runs.push(await runStrategyFixture(task, strategy))
  }
  return {
    taskId: task.id || null,
    runs,
    summary: summarizeRealRunComparison(runs),
  }
}

function summarizeTaskRealComparisons(comparisons = []) {
  const items = comparisons.filter(Boolean)
  const totalRuns = items.reduce((sum, item) => sum + Number(item.summary?.totalRuns || 0), 0)
  const completedRuns = items.reduce((sum, item) => sum + Number(item.summary?.completedRuns || 0), 0)
  const summary = {
    totalTasks: items.length,
    totalRuns,
    completedRuns,
    singleAgentWins: items.filter((item) => item.summary?.winner === "single-agent").length,
    multiAgentWins: items.filter((item) => item.summary?.winner === "multi-agent").length,
    averageDurationMs: totalRuns
      ? Math.round(items.reduce((sum, item) => sum + Number(item.summary?.totalDurationMs || 0), 0) / totalRuns)
      : 0,
    totalQualityGateFailures: items.reduce((sum, item) => sum + Number(item.summary?.totalQualityGateFailures || 0), 0),
    totalConflicts: items.reduce((sum, item) => sum + Number(item.summary?.totalConflicts || 0), 0),
    byFixtureType: summarizeByFixtureType(items),
  }
  summary.failureRecommendations = summarizeFailureRecommendations(items.map((item) => item.summary))
  return summary
}

function summarizeByFixtureType(items = []) {
  const byType = {}
  for (const item of items) {
    const type = item.summary?.fixtureTypes?.[0] || "unknown"
    const current = byType[type] || {
      totalTasks: 0,
      singleAgentWins: 0,
      multiAgentWins: 0,
      totalQualityGateFailures: 0,
      totalConflicts: 0,
    }
    current.totalTasks += 1
    if (item.summary?.winner === "single-agent") current.singleAgentWins += 1
    if (item.summary?.winner === "multi-agent") current.multiAgentWins += 1
    current.totalQualityGateFailures += Number(item.summary?.totalQualityGateFailures || 0)
    current.totalConflicts += Number(item.summary?.totalConflicts || 0)
    byType[type] = current
  }
  return byType
}

module.exports = {
  createFixtureProject,
  createPlanForTask,
  fixtureType,
  runStrategyFixture,
  runTaskRealComparison,
  summarizeRealRunComparison,
  summarizeTaskRealComparisons,
}
