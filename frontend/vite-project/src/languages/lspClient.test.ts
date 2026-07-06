import { beforeEach, describe, expect, it, vi } from "vitest"

type MockClient = {
  requestCompletion: ReturnType<typeof vi.fn>
  requestHover: ReturnType<typeof vi.fn>
  requestDefinition: ReturnType<typeof vi.fn>
}

type ManagerMock = ReturnType<typeof createManagerMock>

function createManagerMock() {
  const statuses = new Map<string, string>()
  const clients = new Map<string, MockClient>()
  let diagnosticsHandler: ((serverId: string, params: any) => void) | null = null

  return {
    statuses,
    clients,
    setRootUri: vi.fn(),
    stopAll: vi.fn(async () => {
      statuses.clear()
    }),
    getServerStatus: vi.fn((serverId: string) => statuses.get(serverId) ?? "stopped"),
    startServer: vi.fn(async (config: { id: string }) => {
      statuses.set(config.id, "running")
      if (!clients.has(config.id)) {
        clients.set(config.id, {
          requestCompletion: vi.fn(async () => []),
          requestHover: vi.fn(async () => null),
          requestDefinition: vi.fn(async () => []),
        })
      }
    }),
    getClient: vi.fn((serverId: string) => clients.get(serverId) ?? null),
    didOpen: vi.fn(),
    didChange: vi.fn(),
    didClose: vi.fn(),
    fullChange: vi.fn((text: string) => ({ text })),
    onDiagnostics: vi.fn((handler: (serverId: string, params: any) => void) => {
      diagnosticsHandler = handler
      return {
        dispose: vi.fn(() => {
          if (diagnosticsHandler === handler) diagnosticsHandler = null
        }),
      }
    }),
    emitDiagnostics(serverId: string, params: any) {
      diagnosticsHandler?.(serverId, params)
    },
  }
}

function createModel(modelUri: string, languageId: string, initialValue: string) {
  let value = initialValue
  const listeners = new Set<() => void>()
  return {
    uri: {
      toString: () => modelUri,
    },
    getValue: () => value,
    setValue(next: string) {
      value = next
    },
    getLanguageId: () => languageId,
    onDidChangeContent(listener: () => void) {
      listeners.add(listener)
      return {
        dispose() {
          listeners.delete(listener)
        },
      }
    },
    fireContentChange() {
      for (const listener of [...listeners]) listener()
    },
  }
}

function createEditor(initialModel: ReturnType<typeof createModel> | null) {
  let currentModel = initialModel
  const listeners = new Set<(event: { oldModelUrl: { toString(): string } | null }) => void>()
  return {
    getModel: () => currentModel,
    onDidChangeModel(listener: (event: { oldModelUrl: { toString(): string } | null }) => void) {
      listeners.add(listener)
      return {
        dispose() {
          listeners.delete(listener)
        },
      }
    },
    switchModel(nextModel: ReturnType<typeof createModel> | null) {
      const previousModel = currentModel
      currentModel = nextModel
      for (const listener of [...listeners]) {
        listener({ oldModelUrl: previousModel?.uri ?? null })
      }
    },
  }
}

function createMonaco(models: Array<ReturnType<typeof createModel>>) {
  const modelMap = new Map(models.map((model) => [model.uri.toString(), model]))
  return {
    Uri: {
      parse(value: string) {
        return {
          toString: () => value,
        }
      },
    },
    MarkerSeverity: {
      Error: 8,
      Warning: 4,
      Info: 2,
      Hint: 1,
    },
    editor: {
      getModel: vi.fn((uri: { toString(): string } | null) => (uri ? modelMap.get(uri.toString()) ?? null : null)),
      setModelMarkers: vi.fn(),
    },
    registerModel(model: ReturnType<typeof createModel>) {
      modelMap.set(model.uri.toString(), model)
    },
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

async function loadLspClientModule() {
  vi.resetModules()
  const managerMock = createManagerMock()
  const registerLspProviders = vi.fn(() => ({ dispose: vi.fn() }))
  const typescriptConfig = {
    id: "typescript",
    languages: ["typescript", "javascript"],
    command: "typescript-language-server",
    args: ["--stdio"],
  }
  const jsonConfig = {
    id: "json",
    languages: ["json"],
    command: "vscode-json-language-server",
    args: ["--stdio"],
  }

  vi.doMock("./lsp/manager", () => ({
    languageServerManager: managerMock,
  }))
  vi.doMock("./lsp/adapters", () => ({
    registerLspProviders,
  }))
  vi.doMock("./lsp/serverConfigs", () => ({
    getServerConfigForFile: vi.fn((filePath: string) => filePath.endsWith(".json") ? jsonConfig : typescriptConfig),
    getServerConfigForLanguage: vi.fn((languageId: string) => {
      if (languageId === "json") return jsonConfig
      if (languageId === "typescript" || languageId === "javascript") return typescriptConfig
      return undefined
    }),
    toLspServerRuntimeConfig: vi.fn((config: { id: string; languages: string[]; command: string; args: string[] }) => ({
      id: config.id,
      languages: [...config.languages],
      command: config.command,
      args: [...config.args],
    })),
  }))

  const mod = await import("./lspClient")
  const modelBinding = await import("./lsp/modelBinding")
  return { mod, managerMock, registerLspProviders, modelBinding }
}

describe("lspClient bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes the workspace root once before setting the language server rootUri", async () => {
    const { mod, managerMock } = await loadLspClientModule()

    await mod.initLsp("D:\\Workspace\\")
    await mod.initLsp("D:/Workspace")

    expect(managerMock.setRootUri).toHaveBeenCalledTimes(1)
    expect(managerMock.setRootUri).toHaveBeenCalledWith("file:///D:/Workspace")
  })

  it("opens, changes, and closes a document without duplicating didOpen notifications", async () => {
    const { mod, managerMock } = await loadLspClientModule()

    await mod.openFile("src/app.ts", "const value = 1\n", "typescript")
    await mod.openFile("src/app.ts", "const value = 1\n", "typescript")
    await mod.changeFile("src/app.ts", "const value = 2\n", "typescript")
    await mod.closeFile("src/app.ts")

    expect(managerMock.startServer).toHaveBeenCalledTimes(1)
    expect(managerMock.didOpen).toHaveBeenCalledTimes(1)
    expect(managerMock.didOpen).toHaveBeenCalledWith("typescript", {
      uri: "file:///src/app.ts",
      languageId: "typescript",
      version: 1,
      text: "const value = 1\n",
    })
    expect(managerMock.fullChange).toHaveBeenCalledWith("const value = 2\n")
    expect(managerMock.didChange).toHaveBeenCalledWith("typescript", "file:///src/app.ts", [{ text: "const value = 2\n" }])
    expect(managerMock.didClose).toHaveBeenCalledWith("typescript", "file:///src/app.ts")
  })

  it("closes the old server document before reopening the same file on a different language server", async () => {
    const { mod, managerMock } = await loadLspClientModule()

    await mod.openFile("src/app.ts", "const value = 1\n", "typescript")
    await mod.openFile("src/app.ts", "{\n  \"value\": 1\n}\n", "json")

    expect(managerMock.didClose).toHaveBeenCalledWith("typescript", "file:///src/app.ts")
    expect(managerMock.didOpen).toHaveBeenNthCalledWith(2, "json", expect.objectContaining({
      uri: "file:///src/app.ts",
      languageId: "json",
    }))
  })

  it("maps LSP completion items into the legacy completion contract with the correct kind and insert text", async () => {
    const { mod, managerMock } = await loadLspClientModule()
    managerMock.clients.set("typescript", {
      requestCompletion: vi.fn(async () => ({
        isIncomplete: false,
        items: [
          {
            label: "map",
            kind: 2,
            insertText: "map",
            sortText: "1",
          },
          {
            label: "forof",
            kind: 15,
            textEdit: {
              newText: "for (const item of items) {\n\t$0\n}",
              range: {
                start: { line: 2, character: 4 },
                end: { line: 2, character: 9 },
              },
            },
            sortText: "2",
          },
        ],
      })),
      requestHover: vi.fn(async () => null),
      requestDefinition: vi.fn(async () => []),
    })
    managerMock.statuses.set("typescript", "running")

    const completions = await mod.getCompletions("src/app.ts", 3, 5)

    expect(managerMock.clients.get("typescript")?.requestCompletion).toHaveBeenCalledWith({
      textDocument: { uri: "file:///src/app.ts" },
      position: { line: 2, character: 4 },
    })
    expect(completions).toEqual([
      {
        name: "map",
        kind: "method",
        sortText: "1",
        insertText: "map",
      },
      {
        name: "forof",
        kind: "snippet",
        sortText: "2",
        insertText: "for (const item of items) {\n\t$0\n}",
      },
    ])
  })

  it("binds Monaco model lifecycle to LSP open-change-close and writes diagnostics markers to the active bound model", async () => {
    const { mod, managerMock, registerLspProviders, modelBinding } = await loadLspClientModule()
    const firstModel = createModel("inmemory://model/1", "typescript", "const value = 1\n")
    const secondModel = createModel("inmemory://model/2", "typescript", "const next = 2\n")
    const monaco = createMonaco([firstModel, secondModel])
    const editor = createEditor(firstModel)

    modelBinding.bindLspModelDocument(firstModel as never, {
      filePath: "src/app.ts",
      documentUri: "file:///src/app.ts",
    })
    modelBinding.bindLspModelDocument(secondModel as never, {
      filePath: "src/next.ts",
      documentUri: "file:///src/next.ts",
    })

    const dispose = mod.registerMonacoLsp(monaco as never, editor as never)
    await flushPromises()

    expect(registerLspProviders).toHaveBeenCalledWith(monaco)
    expect(managerMock.didOpen).toHaveBeenCalledWith("typescript", expect.objectContaining({
      uri: "file:///src/app.ts",
      text: "const value = 1\n",
    }))

    firstModel.setValue("const value = 2\n")
    firstModel.fireContentChange()
    await flushPromises()

    expect(managerMock.didChange).toHaveBeenCalledWith("typescript", "file:///src/app.ts", [{ text: "const value = 2\n" }])

    monaco.registerModel(secondModel)
    editor.switchModel(secondModel)
    await flushPromises()

    expect(managerMock.didClose).toHaveBeenCalledWith("typescript", "file:///src/app.ts")
    expect(managerMock.didOpen).toHaveBeenLastCalledWith("typescript", expect.objectContaining({
      uri: "file:///src/next.ts",
      text: "const next = 2\n",
    }))

    managerMock.emitDiagnostics("typescript", {
      uri: "file:///src/next.ts",
      diagnostics: [
        {
          severity: 1,
          message: "Unexpected token",
          source: "tsserver",
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 10 },
          },
        },
      ],
    })

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(secondModel, "lsp", [
      {
        severity: 8,
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 11,
        message: "Unexpected token",
        source: "tsserver",
      },
    ])

    dispose()

    expect(monaco.editor.setModelMarkers.mock.calls.some(([model, owner, markers]) => model === secondModel && owner === "lsp" && Array.isArray(markers) && markers.length === 0)).toBe(true)
  })
})
