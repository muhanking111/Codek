/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest"
import { activeTheme, setTheme } from "../theme"
import { getSearchConfig, setSearchConfig } from "../ai/webSearch"
import { rememberPreference, buildMemoryContext } from "../agent/agentMemory"
import { buildIndex } from "../ai/indexer"
import { getCompletionModelOverride, setCompletionModelOverride } from "../ai/completionModelSettings"
import { checkCommand, getPolicyForMode } from "../agent/sandboxPolicy"
import {
  langSettings,
  loadLangSettings,
  loadModelSettings,
  modelSettings,
  setJdkPath,
  setJdkVersion,
  setModelParams,
  setPreferredModel,
  setProvider,
  setPythonPath,
  toggleLanguage,
} from "../ai/models.js"
import {
  isSensitiveFilePath,
  privacyState,
  redactSensitiveText,
  setPrivacyMode,
} from "../workspace/privacyMode"
import { getAllRuleContext, getMatchingRules, loadAllRules, ruleState } from "../workspace/teamRules"
import { settingsStore } from "./settingsStore"
import { applyFileSaveSettings } from "./fileSaveSettings"
import { saveFile, workspace } from "../workspace/manager"
import { workspaceSettings } from "../workspace/workspaceSettings"

describe("settings runtime integrations", () => {
  beforeEach(() => {
    delete window.codek
    localStorage.clear()
    settingsStore.reset()
    workspace.files = {}
    workspace.fileTree = []
    workspace.projectRoot = null
  })

  it("syncs workbench.colorTheme with the theme runtime", () => {
    settingsStore.set("workbench.colorTheme", "light")

    expect(activeTheme.value).toBe("light")
    expect(document.documentElement.classList.contains("theme-light")).toBe(true)

    setTheme("dark")

    expect(settingsStore.get("workbench.colorTheme")).toBe("dark")
    expect(document.documentElement.classList.contains("theme-light")).toBe(false)
    expect(document.documentElement.classList.contains("theme-high-contrast")).toBe(false)
  })

  it("syncs codek.privacy.enabled with privacy mode", () => {
    settingsStore.set("codek.privacy.enabled", true)

    expect(privacyState.enabled).toBe(true)

    setPrivacyMode(false)

    expect(settingsStore.get("codek.privacy.enabled")).toBe(false)
  })

  it("redacts logs and matches sensitive file patterns from privacy settings", () => {
    settingsStore.update({
      "codek.privacy.redactLogs": true,
      "codek.privacy.sensitiveFilePatterns": [".env", "*.pem", "secrets/**"],
    })

    expect(redactSensitiveText("token=abcdefghijklmnopqrstuvwxyz123456")).toContain("[REDACTED_SECRET]")
    expect(isSensitiveFilePath(".env")).toBe(true)
    expect(isSensitiveFilePath("certs/client.pem")).toBe(true)
    expect(isSensitiveFilePath("secrets/prod/config.json")).toBe(true)
    expect(isSensitiveFilePath("src/App.vue")).toBe(false)

    settingsStore.set("codek.privacy.redactLogs", false)
    expect(redactSensitiveText("token=abcdefghijklmnopqrstuvwxyz123456")).toBe(
      "token=abcdefghijklmnopqrstuvwxyz123456",
    )
  })

  it("syncs codek.webSearch settings with the web search runtime", () => {
    settingsStore.update({
      "codek.webSearch.provider": "bing",
      "codek.webSearch.baseUrl": "https://example.test",
      "codek.webSearch.apiKey": "secret",
    })

    expect(getSearchConfig()).toEqual({
      provider: "bing",
      baseUrl: "https://example.test",
      apiKey: "secret",
    })

    setSearchConfig({ provider: "searxng", baseUrl: "http://localhost:9999", apiKey: "" })

    expect(settingsStore.get("codek.webSearch.provider")).toBe("searxng")
    expect(settingsStore.get("codek.webSearch.baseUrl")).toBe("http://localhost:9999")
    expect(settingsStore.get("codek.webSearch.apiKey")).toBe("")
  })

  it("syncs codek.ai basic settings with model runtime", () => {
    settingsStore.update({
      "codek.ai.provider": "codex-shared",
      "codek.ai.model": "gpt-test",
      "codek.ai.baseUrl": "https://api.example.test/v1",
      "codek.ai.temperature": 0.3,
      "codek.ai.topP": 0.6,
      "codek.ai.maxTokens": 2048,
    })

    loadModelSettings()

    expect(modelSettings.provider).toBe("codex-shared")
    expect(modelSettings.preferredModel).toBe("gpt-test")
    expect(modelSettings.openaiBaseURL).toBe("https://api.example.test/v1")
    expect(modelSettings.temperature).toBe(0.3)
    expect(modelSettings.topP).toBe(0.6)
    expect(modelSettings.maxTokens).toBe(2048)

    setProvider("ollama")
    setPreferredModel("qwen-test")
    setModelParams({ temperature: 0.4, topP: 0.7, maxTokens: 1024 })

    expect(settingsStore.get("codek.ai.provider")).toBe("ollama")
    expect(settingsStore.get("codek.ai.model")).toBe("qwen-test")
    expect(settingsStore.get("codek.ai.temperature")).toBe(0.4)
    expect(settingsStore.get("codek.ai.topP")).toBe(0.7)
    expect(settingsStore.get("codek.ai.maxTokens")).toBe(1024)
  })

  it("syncs codek.languages settings with language runtime", () => {
    settingsStore.update({
      "codek.languages.jdkVersion": "21",
      "codek.languages.jdkPath": "D:/Java/jdk-21",
      "codek.languages.pythonPath": "D:/Python/python.exe",
      "codek.languages.enabled": ["java", "python"],
    })

    loadLangSettings()

    expect(langSettings.jdkVersion).toBe("21")
    expect(langSettings.jdkPath).toBe("D:/Java/jdk-21")
    expect(langSettings.pythonPath).toBe("D:/Python/python.exe")
    expect(langSettings.enabledLanguages).toEqual(["java", "python"])

    setJdkVersion("17")
    setJdkPath("D:/Java/jdk-17")
    setPythonPath("D:/Python311/python.exe")
    toggleLanguage("typescript")

    expect(settingsStore.get("codek.languages.jdkVersion")).toBe("17")
    expect(settingsStore.get("codek.languages.jdkPath")).toBe("D:/Java/jdk-17")
    expect(settingsStore.get("codek.languages.pythonPath")).toBe("D:/Python311/python.exe")
    expect(settingsStore.get("codek.languages.enabled")).toEqual(["java", "python", "typescript"])
  })

  it("disables rules, memory and indexing from the unified settings store", async () => {
    ruleState.rules = [
      {
        path: ".codek/rules.md",
        title: "项目规则",
        glob: null,
        content: "始终使用中文回复",
        priority: 100,
      },
    ]
    rememberPreference("喜欢紧凑的解释")

    expect(getAllRuleContext()).toContain("始终使用中文回复")
    expect(getMatchingRules("src/App.vue")).toEqual(["始终使用中文回复"])
    expect(buildMemoryContext("解释")).toContain("喜欢紧凑的解释")

    settingsStore.update({
      "codek.rules.enabled": false,
      "codek.memory.enabled": false,
      "codek.indexing.enabled": false,
    })

    expect(getAllRuleContext()).toBe("")
    expect(getMatchingRules("src/App.vue")).toEqual([])
    expect(buildMemoryContext("解释")).toBe("")
    await expect(buildIndex()).resolves.toEqual([])
  })

  it("skips sensitive files while building the code index", async () => {
    settingsStore.update({
      "codek.indexing.enabled": true,
      "codek.privacy.sensitiveFilePatterns": [".env", "*.pem"],
    })
    workspace.fileTree = [
      { name: "App.vue", path: "src/App.vue", isDir: false },
      { name: ".env", path: ".env", isDir: false },
      { name: "private.pem", path: "certs/private.pem", isDir: false },
    ]
    workspace.files = {
      "src/App.vue": "export const answer = 42",
      ".env": "OPENAI_API_KEY=secret",
      "certs/private.pem": "REDACTION_TEST_PRIVATE_KEY_MARKER",
    }

    const index = await buildIndex({ useBackend: false })

    expect(index.map((entry) => entry.path)).toEqual(["src/App.vue"])
    expect(index[0].content).toContain("answer")
  })

  it("hydrates workspace settings from .codek/settings.json when loading a project", async () => {
    window.codek = {
      readFile: async (path: string) => {
        if (path.endsWith("/.codek/settings.json")) {
          return JSON.stringify({ "editor.fontSize": 21, "git.autoStage": true })
        }
        return null
      },
      createDir: async () => true,
      writeFile: async () => true,
    } as unknown as typeof window.codek

    workspaceSettings.load("D:/Workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(settingsStore.get("editor.fontSize")).toBe(21)
    expect(workspaceSettings.get("editor").fontSize).toBe(21)
    expect(workspaceSettings.get("git").autoStage).toBe(true)
  })

  it("applies file save settings before content is persisted", () => {
    settingsStore.update({
      "files.trimTrailingWhitespace": true,
      "files.insertFinalNewline": true,
    })

    expect(applyFileSaveSettings("const x = 1   \nconst y = 2\t")).toBe("const x = 1\nconst y = 2\n")

    settingsStore.update({
      "files.trimTrailingWhitespace": false,
      "files.insertFinalNewline": false,
    })
    expect(applyFileSaveSettings("const x = 1   ")).toBe("const x = 1   ")
  })

  it("applies file save settings through the workspace save flow", async () => {
    const writes = new Map<string, string>()
    settingsStore.update({
      "files.trimTrailingWhitespace": true,
      "files.insertFinalNewline": true,
    })
    workspace.projectRoot = "D:/Workspace"
    window.codek = {
      readFile: async (path: string) => writes.get(path) ?? null,
      fileExists: async (path: string) => ({
        exists: writes.has(path),
        isFile: true,
        size: writes.get(path)?.length ?? 0,
        mtime: Date.now(),
        ctime: Date.now(),
      }),
      writeFile: async (path: string, content: string) => {
        writes.set(path, content)
        return true
      },
    } as unknown as typeof window.codek

    await expect(saveFile("src/App.vue", "const x = 1   ")).resolves.toBe(true)

    expect(workspace.files["src/App.vue"]).toBe("const x = 1\n")
    expect(writes.get("D:/Workspace/src/App.vue")).toBe("const x = 1\n")
  })

  it("syncs codek.ai.completionModel with inline completion override", () => {
    settingsStore.set("codek.ai.completionModel", "qwen2.5-coder:1.5b")

    expect(getCompletionModelOverride()).toBe("qwen2.5-coder:1.5b")

    setCompletionModelOverride("qwen2.5-coder:3b")

    expect(settingsStore.get("codek.ai.completionModel")).toBe("qwen2.5-coder:3b")
    expect(localStorage.getItem("codek-completion-model")).toBe("qwen2.5-coder:3b")
  })

  it("migrates legacy inline completion model storage into unified settings", () => {
    localStorage.setItem("codek-completion-model", "legacy-completion-model")

    expect(getCompletionModelOverride()).toBe("legacy-completion-model")
    expect(settingsStore.get("codek.ai.completionModel")).toBe("legacy-completion-model")
  })

  it("loads Cursor-compatible rules when enabled", async () => {
    window.codek = {
      listDir: async (path: string) => {
        if (path.endsWith("/.codek/rules") || path.endsWith("/.cursor/rules")) {
          return [{ name: "typescript.md" }]
        }
        return []
      },
      readFile: async (path: string) => {
        if (path.endsWith("/.codek/rules.md")) return "# Codek\n始终先跑测试"
        if (path.endsWith("/.codek/rules/typescript.md")) return "# TS\nglob:*.ts\n---\n使用 TypeScript"
        if (path.endsWith("/.cursor/rules.md")) return "# Cursor\n保持 Cursor 规则兼容"
        if (path.endsWith("/.cursor/rules/typescript.md")) return "# Cursor TS\nglob:*.ts\n---\n兼容 Cursor TS 规则"
        throw new Error("missing")
      },
    } as unknown as typeof window.codek

    settingsStore.set("codek.rules.cursorCompat", true)
    loadAllRules("D:/Workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getAllRuleContext()).toContain("始终先跑测试")
    expect(getAllRuleContext()).toContain("保持 Cursor 规则兼容")
    expect(getMatchingRules("src/main.ts")).toContain("兼容 Cursor TS 规则")
  })

  it("loads recursive Codek and Cursor rules with directory inheritance", async () => {
    window.codek = {
      listDir: async (path: string) => {
        const normalized = path.replace(/\\/g, "/")
        if (normalized.endsWith("/.codek/rules")) {
          return [{ name: "typescript.md" }, { name: "src", isDirectory: true }]
        }
        if (normalized.endsWith("/.codek/rules/src")) {
          return [{ name: "backend", isDirectory: true }]
        }
        if (normalized.endsWith("/.codek/rules/src/backend")) {
          return [{ name: "security.md" }]
        }
        if (normalized.endsWith("/.cursor/rules")) {
          return [{ name: "typescript.md" }, { name: "src", isDirectory: true }]
        }
        if (normalized.endsWith("/.cursor/rules/src")) {
          return [{ name: "backend", isDirectory: true }]
        }
        if (normalized.endsWith("/.cursor/rules/src/backend")) {
          return [{ name: "security.md" }]
        }
        return []
      },
      readFile: async (path: string) => {
        const normalized = path.replace(/\\/g, "/")
        if (normalized.endsWith("/.codek/rules.md")) return "# Codek\nAlways run focused tests"
        if (normalized.endsWith("/.codek/rules/typescript.md")) return "# TS\nglob:*.ts\n---\nUse TypeScript strictly"
        if (normalized.endsWith("/.codek/rules/src/backend/security.md")) return "# Codek Backend Security\nValidate backend inputs"
        if (normalized.endsWith("/.cursor/rules.md")) return "# Cursor\nKeep Cursor-compatible behavior"
        if (normalized.endsWith("/.cursor/rules/typescript.md")) return "# Cursor TS\nglob:*.ts\n---\nRespect Cursor TS rules"
        if (normalized.endsWith("/.cursor/rules/src/backend/security.md")) return "# Cursor Backend Security\nCursor backend rule"
        throw new Error("missing")
      },
    } as unknown as typeof window.codek

    settingsStore.set("codek.rules.cursorCompat", true)
    loadAllRules("D:/Workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getAllRuleContext()).toContain("Always run focused tests")
    expect(getAllRuleContext()).toContain("Keep Cursor-compatible behavior")
    const backendRules = getMatchingRules("src/backend/user.ts")
    expect(backendRules).toContain("Validate backend inputs")
    expect(backendRules).toContain("Cursor backend rule")
    expect(backendRules.indexOf("Validate backend inputs")).toBeLessThan(backendRules.indexOf("Cursor backend rule"))
    expect(backendRules.indexOf("Validate backend inputs")).toBeLessThan(backendRules.indexOf("Always run focused tests"))
    expect(getMatchingRules("src/frontend/app.ts")).not.toContain("Validate backend inputs")
    expect(getMatchingRules("src/main.ts")).toContain("Respect Cursor TS rules")
  })

  it("applies Agent policy settings to sandbox command checks", () => {
    settingsStore.update({
      "codek.agent.approvalMode": "ask",
      "codek.agent.terminalPolicy": "disabled",
    })

    const disabled = checkCommand("npm test", getPolicyForMode("agent"))

    expect(disabled.allowed).toBe(false)
    expect(disabled.reason).toContain("does not allow command execution")

    settingsStore.update({
      "codek.agent.approvalMode": "workspace-auto",
      "codek.agent.terminalPolicy": "safe-only",
    })

    const safe = checkCommand("npm test", getPolicyForMode("agent"))

    expect(safe.allowed).toBe(true)
    expect(safe.requireApproval).toBe(false)
  })

  it("uses codek.memory.maxEntriesPerType to trim Agent memory", () => {
    settingsStore.set("codek.memory.maxEntriesPerType", 1)

    rememberPreference("第一条偏好")
    rememberPreference("第二条偏好")

    const context = buildMemoryContext("偏好")
    expect(context).toContain("第二条偏好")
    expect(context).not.toContain("第一条偏好")
  })
})
