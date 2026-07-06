import { describe, expect, it } from "vitest"
import { SnippetManager } from "./snippetManager"

describe("SnippetManager", () => {
  it("imports VS Code snippets into a single registry with scope and prefix aliases", () => {
    const manager = new SnippetManager()

    const count = manager.importFromVSCode({
      "Vue setup": {
        prefix: ["vsetup", "vue-setup"],
        body: ["<script setup lang=\"ts\">", "${1}", "</script>"],
        description: "Vue setup block",
        scope: "vue, typescript",
      },
      "Global note": {
        body: "NOTE: ${TM_FILENAME_BASE}",
      },
    })

    expect(count).toBe(2)
    expect(manager.getSnippetsForLanguage("vue").map((snippet) => snippet.prefixes)).toEqual([
      ["vsetup", "vue-setup"],
      ["Global note"],
    ])
    expect(manager.getSnippet("Vue setup")?.source).toBe("vscode")
  })

  it("resolves VS Code session variables and placeholders without dropping unknown placeholders", () => {
    const manager = new SnippetManager()
    manager.registerSnippet({
      name: "Log selection",
      prefix: "logsel",
      body: "console.log(${TM_SELECTED_TEXT:${1:value}}, ${CLIPBOARD}, ${UNKNOWN:kept}, ${WORKSPACE_NAME})",
      description: "",
      scope: ["typescript"],
    })

    const resolved = manager.resolveSnippet(manager.getSnippet("Log selection")!, {
      fileName: "D:/Workspace/src/main.ts",
      selectedText: "answer",
      clipboard: "clip",
      workspaceName: "Codek",
    })

    expect(resolved).toBe("console.log(answer, clip, kept, Codek)")
  })

  it("projects a serializable registry contract for providers and tests", () => {
    const manager = new SnippetManager()
    manager.importFromVSCode({
      "TS function": {
        prefix: "tfn",
        body: "function ${1:name}() {\n\t$0\n}",
        scope: "typescript",
      },
    })

    expect(manager.getRegistrySnapshot()).toEqual({
      source: "snippetManager",
      serviceId: "snippetService",
      vscodeServiceIds: ["ISnippetsService", "ILanguageFeaturesService"],
      total: 1,
      languages: ["typescript"],
      snippets: [{
        name: "TS function",
        prefixes: ["tfn"],
        scope: ["typescript"],
        source: "vscode",
      }],
      constraints: {
        singleRegistry: true,
        providerUsesRegistry: true,
        vscodeSnippetShape: true,
      },
    })
  })
})
