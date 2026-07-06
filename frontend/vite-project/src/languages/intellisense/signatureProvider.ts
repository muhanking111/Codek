import type { languages, editor, Position } from "monaco-editor"
import type { PluginEngineMethod, PluginManifest } from "../../plugins/types"
import { getActiveManifests } from "./engine"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { combineDisposables, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

export interface ParameterInfo {
  label: string
  documentation: string
}

export interface SignatureInfo {
  label: string
  documentation: string
  parameters: ParameterInfo[]
  activeParameter: number
}

function parseMethodSignature(method: PluginEngineMethod): SignatureInfo | null {
  const paramsStr = method.params
  if (!paramsStr || paramsStr === "()") {
    return {
      label: `${method.name}()`,
      documentation: method.detail,
      parameters: [],
      activeParameter: 0,
    }
  }

  const inner = paramsStr.slice(1, -1)
  const params = splitParameters(inner)
  const parameters: ParameterInfo[] = params.map((p) => {
    const trimmed = p.trim()
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      return {
        label: trimmed,
        documentation: parts[0],
      }
    }
    return {
      label: trimmed,
      documentation: "",
    }
  })

  const label = `${method.name}(${params.join(", ")})`

  return {
    label,
    documentation: method.detail,
    parameters,
    activeParameter: 0,
  }
}

function splitParameters(paramsStr: string): string[] {
  const result: string[] = []
  let depth = 0
  let current = ""

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i]
    if (ch === "<" || ch === "(" || ch === "[") {
      depth++
      current += ch
    } else if (ch === ">" || ch === ")" || ch === "]") {
      depth--
      current += ch
    } else if (ch === "," && depth === 0) {
      result.push(current)
      current = ""
    } else {
      current += ch
    }
  }

  if (current.trim()) result.push(current)
  return result
}

function findActiveParameter(lineUntilCursor: string): number {
  const openParen = lineUntilCursor.lastIndexOf("(")
  if (openParen < 0) return 0

  const afterParen = lineUntilCursor.slice(openParen + 1)
  let depth = 0
  let paramIndex = 0

  for (let i = 0; i < afterParen.length; i++) {
    const ch = afterParen[i]
    if (ch === "(" || ch === "<" || ch === "[") {
      depth++
    } else if (ch === ")" || ch === ">" || ch === "]") {
      depth--
    } else if (ch === "," && depth === 0) {
      paramIndex++
    }
  }

  return paramIndex
}

function findMethodName(lineUntilCursor: string): string | null {
  const match = lineUntilCursor.match(/(\w+)\s*\(\s*[^)]*$/)
  if (match) return match[1]

  const dotMatch = lineUntilCursor.match(/\.(\w+)\s*\(\s*[^)]*$/)
  if (dotMatch) return dotMatch[1]

  return null
}

function findSignaturesFromManifests(
  methodName: string,
  manifests: PluginManifest[],
): SignatureInfo[] {
  const signatures: SignatureInfo[] = []

  for (const manifest of manifests) {
    const cfg = manifest.engineConfig
    if (!cfg?.classes) continue

    for (const cls of Object.values(cfg.classes)) {
      if (!cls.methods) continue
      for (const method of cls.methods) {
        if (method.name === methodName) {
          const sig = parseMethodSignature(method)
          if (sig) signatures.push(sig)
        }
      }
    }
  }

  return signatures
}

export class SignatureProvider {
  getSignatures(model: editor.ITextModel, position: Position): SignatureInfo[] {
    const lineUntilCursor = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    const methodName = findMethodName(lineUntilCursor)
    if (!methodName) return []

    const manifests = getActiveManifests()
    const signatures = findSignaturesFromManifests(methodName, manifests)

    const activeParam = findActiveParameter(lineUntilCursor)
    for (const sig of signatures) {
      sig.activeParameter = Math.min(activeParam, sig.parameters.length - 1)
    }

    return signatures
  }
}

export function registerSignatureProvider(monaco: Monaco): DisposableLike {
  const provider = new SignatureProvider()

  const LANGUAGES = [
    "java", "python", "go", "cpp", "c", "rust",
    "javascript", "typescript", "kotlin", "scala",
  ]

  const disposables: DisposableLike[] = []
  for (const languageId of LANGUAGES) {
    disposables.push(editorLanguageFeatureService.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [",", ")"],
      provideSignatureHelp(model, position) {
        const signatures = provider.getSignatures(model, position)
        if (signatures.length === 0) return null

        const monacoSignatures: languages.SignatureInformation[] = signatures.map((sig) => ({
          label: sig.label,
          documentation: sig.documentation,
          parameters: sig.parameters.map((p) => ({
            label: p.label,
            documentation: p.documentation,
          })),
        }))

        return {
          value: {
            signatures: monacoSignatures,
            activeSignature: 0,
            activeParameter: signatures[0]?.activeParameter ?? 0,
          },
          dispose() {},
        }
      },
    }, monaco, {
      id: `manifest-signature:${languageId}`,
      source: "intellisense",
    }))
  }
  return combineDisposables(...disposables)
}
