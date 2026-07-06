import { describe, expect, it } from "vitest"
import { ContextKeyService, evaluateWhenClause, getContextKeyServiceOwnerEvidence, globalContextKeyService, IContextKeyService, RawContextKey } from "./contextKeys"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"

describe("VS Code compatible context key expressions", () => {
  it("evaluates boolean keys, negation and precedence", () => {
    expect(evaluateWhenClause("editorTextFocus && !inputFocus", {
      editorTextFocus: true,
      inputFocus: false,
    })).toBe(true)
    expect(evaluateWhenClause("editorTextFocus && !inputFocus", {
      editorTextFocus: true,
      inputFocus: true,
    })).toBe(false)
    expect(evaluateWhenClause("a || b && c", { a: false, b: true, c: false })).toBe(false)
    expect(evaluateWhenClause("(a || b) && c", { a: false, b: true, c: true })).toBe(true)
  })

  it("evaluates equality, inequality and regex matches", () => {
    expect(evaluateWhenClause("resourceLangId == typescript", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId === typescript", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId != markdown", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId !== markdown", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourcePath =~ /api/", { resourcePath: "src/api/client.ts" })).toBe(true)
    expect(evaluateWhenClause("resourceFilename =~ /\\.test\\.ts$/", { resourceFilename: "keybindings.test.ts" })).toBe(true)
    expect(evaluateWhenClause("resourceFilename !~ /\\.md$/", { resourceFilename: "App.vue" })).toBe(true)
  })

  it("evaluates VS Code comparison and membership operators", () => {
    expect(evaluateWhenClause("workspaceFolderCount >= 2", { workspaceFolderCount: 3 })).toBe(true)
    expect(evaluateWhenClause("workspaceFolderCount < 2", { workspaceFolderCount: 3 })).toBe(false)
    expect(evaluateWhenClause("resourceExtname in supportedExtnames", {
      resourceExtname: ".ts",
      supportedExtnames: [".ts", ".vue"],
    })).toBe(true)
    expect(evaluateWhenClause("resourceExtname not in disabledExtnames", {
      resourceExtname: ".ts",
      disabledExtnames: { ".json": true },
    })).toBe(true)
  })

  it("fails closed for invalid expressions", () => {
    expect(evaluateWhenClause("editorTextFocus && && inputFocus", { editorTextFocus: true })).toBe(false)
  })

  it("supports VS Code-style RawContextKey bindTo createKey set reset and rule matching", () => {
    const service = new ContextKeyService({ resourceLangId: "typescript" })
    const inQuickInput = new RawContextKey<boolean>("inQuickInput", false).bindTo(service)
    const quickInputType = new RawContextKey<string | undefined>("quickInputType", undefined).bindTo(service)
    const changed: boolean[] = []
    service.onDidChangeContext((event) => {
      changed.push(event.affectsSome(new Set(["inQuickInput", "quickInputType"])))
    })

    expect(inQuickInput.get()).toBe(false)
    expect(service.contextMatchesRules("!inQuickInput && resourceLangId == typescript")).toBe(true)

    inQuickInput.set(true)
    quickInputType.set("quickPick")

    expect(service.getContextKeyValue("inQuickInput")).toBe(true)
    expect(service.contextMatchesRules("inQuickInput && quickInputType == quickPick")).toBe(true)
    expect(changed).toEqual([true, true])

    quickInputType.reset()
    inQuickInput.reset()

    expect(service.getContextKeyValue("quickInputType")).toBeUndefined()
    expect(service.contextMatchesRules("!inQuickInput")).toBe(true)
  })

  it("resets to defaults when a RawContextKey binds to an existing key like VS Code", () => {
    const service = new ContextKeyService({ inQuickInput: true })

    new RawContextKey<boolean>("inQuickInput", false).bindTo(service)

    expect(service.getContextKeyValue("inQuickInput")).toBe(false)
  })

  it("buffers context change events with VS Code-style affectsSome and allKeysContainedIn checks", () => {
    const service = new ContextKeyService()
    const events: {
      affectsQuickInput: boolean
      allInChangedSet: boolean
      allInPartialSet: boolean
    }[] = []
    service.onDidChangeContext((event) => {
      events.push({
        affectsQuickInput: event.affectsSome(new Set(["inQuickInput"])),
        allInChangedSet: event.allKeysContainedIn(new Set(["inQuickInput", "currentQuickInput"])),
        allInPartialSet: event.allKeysContainedIn(new Set(["inQuickInput"])),
      })
    })

    service.bufferChangeEvents(() => {
      service.updateContext({
        inQuickInput: true,
        currentQuickInput: "quick-pick-1",
      })
    })

    expect(events).toEqual([{
      affectsQuickInput: true,
      allInChangedSet: true,
      allInPartialSet: false,
    }])
  })

  it("creates scoped context services that inherit global keys and keep local overrides isolated", () => {
    const global = new ContextKeyService({ resourceLangId: "typescript", inQuickInput: false })
    const scoped = global.createScoped()
    const scopedQuickInput = new RawContextKey<boolean>("inQuickInput", false).bindTo(scoped)
    const scopedType = new RawContextKey<string | undefined>("quickInputType", undefined).bindTo(scoped)

    scopedQuickInput.set(true)
    scopedType.set("quickPick")

    expect(scoped.getContextKeyValue("resourceLangId")).toBe("typescript")
    expect(scoped.contextMatchesRules("resourceLangId == typescript && inQuickInput && quickInputType == quickPick")).toBe(true)
    expect(global.getContextKeyValue("inQuickInput")).toBe(false)
    expect(global.getContextKeyValue("quickInputType")).toBeUndefined()

    global.updateContext({ resourceLangId: "vue" })

    expect(scoped.getContextKeyValue("resourceLangId")).toBe("vue")
    scoped.dispose()
    expect(scoped.getContext()).toEqual({})
  })

  it("registers the global context key service through VS Code-style DI", () => {
    const collection = new ServiceCollection([IContextKeyService, globalContextKeyService])
    const resolved = collection.get(IContextKeyService)

    expect(resolved).toBe(globalContextKeyService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IContextKeyService && instance === globalContextKeyService)).toBe(true)
  })

  it("projects context key owner evidence from the single ContextKeyService state source", () => {
    const service = new ContextKeyService({ editorTextFocus: true, resourceLangId: "typescript" })
    const evidence = getContextKeyServiceOwnerEvidence(service)

    expect(evidence).toEqual({
      owner: "IContextKeyService/ContextKeyService",
      stateSource: "ContextKeyService.context",
      activeContextSource: "IContextKeyService.getContext()",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      contextKeyCount: 2,
      contextKeys: ["editorTextFocus", "resourceLangId"],
    })
    expect(service.contextMatchesRules("editorTextFocus && resourceLangId == typescript")).toBe(true)
  })
})
