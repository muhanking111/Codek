import { describe, expect, it, vi } from "vitest"
import { installEditorCompletionFeatures, installEditorCoreFeatureProviders } from "./editorFeatureInstallLifecycle"

describe("editorFeatureInstallLifecycle", () => {
  it("installs language, navigation and debug providers in order", () => {
    const calls: string[] = []
    const editor = { id: "editor" }
    const monaco = { id: "monaco" }
    const features = {
      registerAllLanguageProviders: vi.fn(() => calls.push("languages")),
      setupNavigationProvider: vi.fn(() => calls.push("navigation")),
      setupDebugBreakpoints: vi.fn(() => calls.push("debug")),
    }

    installEditorCoreFeatureProviders(editor, monaco, features)

    expect(calls).toEqual(["languages", "navigation", "debug"])
    expect(features.registerAllLanguageProviders).toHaveBeenCalledWith(monaco)
    expect(features.setupNavigationProvider).toHaveBeenCalledWith(editor, monaco)
    expect(features.setupDebugBreakpoints).toHaveBeenCalledWith(editor, monaco)
  })

  it("installs tab completion separately after editor is ready", () => {
    const editor = { id: "editor" }
    const monaco = { id: "monaco" }
    const setupTabCompletion = vi.fn()

    installEditorCompletionFeatures(editor, monaco, { setupTabCompletion })

    expect(setupTabCompletion).toHaveBeenCalledWith(editor, monaco)
  })

  it("tolerates missing optional feature installers", () => {
    expect(() => installEditorCoreFeatureProviders({}, {}, {})).not.toThrow()
    expect(() => installEditorCompletionFeatures({}, {}, {})).not.toThrow()
  })
})
