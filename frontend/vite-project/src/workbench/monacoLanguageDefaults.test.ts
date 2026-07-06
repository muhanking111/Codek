import { describe, expect, it, vi } from "vitest"
import { applyMonacoJsTsLanguageDefaults, createSharedJsTsCompilerOptions } from "./monacoLanguageDefaults"

function createMonacoMock() {
  return {
    languages: {
      typescript: {
        ScriptTarget: { ESNext: "ESNextTarget" },
        ModuleResolutionKind: { NodeJs: "NodeJsResolution" },
        ModuleKind: { ESNext: "ESNextModule" },
        JsxEmit: { React: "ReactJsx" },
        typescriptDefaults: {
          setCompilerOptions: vi.fn(),
          setDiagnosticsOptions: vi.fn(),
        },
        javascriptDefaults: {
          setCompilerOptions: vi.fn(),
          setDiagnosticsOptions: vi.fn(),
        },
      },
    },
  }
}

describe("monacoLanguageDefaults", () => {
  it("creates the shared JavaScript and TypeScript compiler defaults", () => {
    const ts = createMonacoMock().languages.typescript

    expect(createSharedJsTsCompilerOptions(ts)).toEqual({
      target: "ESNextTarget",
      allowNonTsExtensions: true,
      moduleResolution: "NodeJsResolution",
      module: "ESNextModule",
      noEmit: true,
      jsx: "ReactJsx",
      allowJs: true,
    })
  })

  it("applies strict TypeScript defaults and matching JavaScript diagnostics", () => {
    const monaco = createMonacoMock()

    applyMonacoJsTsLanguageDefaults(monaco)

    expect(monaco.languages.typescript.typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "ESNextTarget",
        moduleResolution: "NodeJsResolution",
        module: "ESNextModule",
        jsx: "ReactJsx",
        allowJs: true,
        strict: true,
      }),
    )
    expect(monaco.languages.typescript.javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "ESNextTarget",
        moduleResolution: "NodeJsResolution",
        module: "ESNextModule",
        jsx: "ReactJsx",
        allowJs: true,
      }),
    )
    expect(monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
    expect(monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
  })
})
