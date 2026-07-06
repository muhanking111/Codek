import { describe, expect, it } from "vitest"
import {
  getLocalizedExtensionIconText,
  localizeExtensionDescription,
  localizeExtensionDisplayName,
  localizeExtensionReadmePreview,
} from "./extensionDisplayName"

describe("extensionDisplayName", () => {
  it("localizes VS Code builtin extension names for user-visible gallery rows", () => {
    expect(localizeExtensionDisplayName({ id: "vscode.bat", displayName: "Windows Bat Language Basics", publisher: "vscode" })).toBe("Windows 批处理 语言基础")
    expect(localizeExtensionDisplayName({ id: "vscode.configuration-editing", displayName: "Configuration Editing", publisher: "vscode" })).toBe("配置文件编辑")
    expect(localizeExtensionDisplayName({ id: "vscode.node-debug-auto-attach", displayName: "Node Debug Auto-attach", publisher: "vscode" })).toBe("Node 调试自动附加")
  })

  it("uses localized text for fallback icon initials without changing extension ids", () => {
    const extension = { id: "vscode.css-language-features", displayName: "CSS Language Features", publisher: "vscode" }
    expect(localizeExtensionDisplayName(extension)).toBe("CSS 语言功能")
    expect(getLocalizedExtensionIconText(extension)).toBe("语言")
  })

  it("uses Chinese category fallbacks for unknown marketplace names", () => {
    expect(localizeExtensionDisplayName({
      id: "publisher.ai-helper",
      displayName: "AI Helper",
      publisher: "publisher",
    })).toBe("智能辅助扩展")
    expect(localizeExtensionDisplayName({
      id: "kingcle.ai",
      displayName: "인공지능 도우미",
      publisher: "kingcle",
      description: "AI coding assistant",
    })).toBe("智能辅助扩展")
    expect(localizeExtensionDisplayName({
      id: "ai-studio.workbench",
      displayName: "AI工作台",
      publisher: "ai-studio",
      description: "AI coding assistant",
    })).toBe("智能辅助扩展")
    expect(localizeExtensionDisplayName({
      id: "publisher.chat-helper",
      displayName: "Chat 助手",
      publisher: "publisher",
      description: "chat coding assistant",
    })).toBe("智能辅助扩展")
  })

  it("does not expose external marketplace descriptions as the primary visible copy", () => {
    const extension = {
      id: "publisher.cody",
      displayName: "Cody: AI Code Assistant",
      publisher: "publisher",
      description: "The most powerful AI coding assistant with autocomplete and chat.",
      categories: ["AI"],
    }

    expect(localizeExtensionDescription(extension)).toBe(
      "来自扩展市场的智能辅助扩展。安装前会展示来源、版本、权限和贡献点，安装后同步启用与激活证据。",
    )
    expect(localizeExtensionDescription(extension)).not.toContain("autocomplete")
  })

  it("summarizes external README text in Chinese for the detail view", () => {
    expect(localizeExtensionReadmePreview({
      id: "publisher.cody",
      displayName: "Cody: AI Code Assistant",
      publisher: "publisher",
      description: "AI coding assistant",
    }, "# Cody\n\nAI coding assistant documentation.")).toBe(
      "说明文档已读取。该条目属于智能辅助扩展，当前摘要保留安装计划、兼容性、贡献点和回滚证据，外部原文不直接显示在中文工作台中。",
    )
  })
})
