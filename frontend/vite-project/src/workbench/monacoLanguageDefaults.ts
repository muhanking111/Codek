interface TypeScriptDefaultsLike {
  setCompilerOptions: (options: Record<string, unknown>) => void
  setDiagnosticsOptions: (options: Record<string, unknown>) => void
}

interface MonacoTypeScriptLike {
  ScriptTarget: { ESNext: unknown }
  ModuleResolutionKind: { NodeJs: unknown }
  ModuleKind: { ESNext: unknown }
  JsxEmit: { React: unknown }
  typescriptDefaults: TypeScriptDefaultsLike
  javascriptDefaults: TypeScriptDefaultsLike
}

export interface MonacoLanguageDefaultsLike {
  languages: {
    typescript: MonacoTypeScriptLike
  }
}

export function createSharedJsTsCompilerOptions(ts: MonacoTypeScriptLike): Record<string, unknown> {
  return {
    target: ts.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    jsx: ts.JsxEmit.React,
    allowJs: true,
  }
}

export function applyMonacoJsTsLanguageDefaults(monaco: MonacoLanguageDefaultsLike): void {
  const ts = monaco.languages.typescript
  const sharedCompilerOptions = createSharedJsTsCompilerOptions(ts)
  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
  }

  ts.typescriptDefaults.setCompilerOptions({
    ...sharedCompilerOptions,
    strict: true,
  })
  ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  ts.javascriptDefaults.setCompilerOptions(sharedCompilerOptions)
  ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
}
