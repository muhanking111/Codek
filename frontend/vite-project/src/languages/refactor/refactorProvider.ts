// @ts-nocheck
import type { languages, editor } from "monaco-editor"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { combineDisposables, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

export interface RefactorAction {
  title: string
  kind: string
  isPreferred: boolean
  edit: languages.WorkspaceEdit
}

interface TextChange {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  text: string
}

function getIndentAtLine(model: editor.ITextModel, lineNumber: number): string {
  const line = model.getLineContent(lineNumber)
  const match = line.match(/^(\s*)/)
  return match ? match[1] : ""
}

function findEnclosingScope(
  model: editor.ITextModel,
  startLine: number,
  endLine: number,
): { scopeStart: number; scopeEnd: number } {
  let depth = 0
  let scopeStart = 1
  const lineCount = model.getLineCount()

  for (let i = 1; i <= lineCount; i++) {
    const line = model.getLineContent(i)
    const opens = (line.match(/{/g) || []).length
    const closes = (line.match(/}/g) || []).length

    if (i < startLine) {
      depth += opens - closes
      if (depth <= 0) {
        scopeStart = i + 1
        depth = 0
      }
    } else if (i >= startLine && i <= endLine) {
      depth += opens - closes
    } else {
      break
    }
  }

  let scopeEnd = lineCount
  depth = 0
  for (let i = scopeStart; i <= lineCount; i++) {
    const line = model.getLineContent(i)
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
    if (depth <= 0 && i >= endLine) {
      scopeEnd = i
      break
    }
  }

  return { scopeStart, scopeEnd }
}

function detectLanguageFromModel(model: editor.ITextModel): string {
  const id = model.getLanguageId()
  if (id === "javascript" || id === "typescript" || id === "jsx" || id === "tsx" || id === "vue") {
    return "js-like"
  }
  if (id === "python") return "python"
  if (id === "java" || id === "kotlin" || id === "scala") return "java-like"
  if (id === "go") return "go"
  if (id === "rust") return "rust"
  if (id === "c" || id === "cpp") return "c-like"
  return "unknown"
}

export class RefactorProvider {
  getRefactorActions(
    model: editor.ITextModel,
    range: languages.Range,
    context: languages.CodeActionContext,
  ): RefactorAction[] {
    const actions: RefactorAction[] = []
    const selectedText = model.getValueInRange(range)
    const hasSelection = selectedText.trim().length > 0
    const requestedKind = String(context?.only?.value || context?.only || "")
    const isSourceRequest = requestedKind.startsWith("source")
    const isRefactorRequest = requestedKind.startsWith("refactor")
    const isQuickFixRequest = requestedKind.startsWith("quickfix")

    if (isQuickFixRequest) return []

    if (hasSelection && !isSourceRequest) {
      actions.push(this.createExtractFunctionAction(model, range))
      actions.push(this.createExtractVariableAction(model, range))
    }

    const lang = detectLanguageFromModel(model)
    if (
      isSourceRequest
      && (lang === "js-like" || lang === "java-like" || lang === "go" || lang === "rust" || lang === "c-like")
    ) {
      actions.push(this.createOrganizeImportsAction(model))
    }

    if (hasSelection && !isSourceRequest) {
      const inlineAction = this.createInlineVariableAction(model, range)
      if (inlineAction) actions.push(inlineAction)
    }

    if (!hasSelection && !isSourceRequest && !isRefactorRequest) return []
    return actions
  }

  private createExtractFunctionAction(
    model: editor.ITextModel,
    range: languages.Range,
  ): RefactorAction {
    const extracted = model.getValueInRange(range)
    const indent = getIndentAtLine(model, range.startLineNumber)
    const lang = detectLanguageFromModel(model)

    let functionTemplate: string
    if (lang === "python") {
      functionTemplate = `def extracted_function():\n${indent}    ${extracted.split("\n").join(`\n${indent}    `)}\n\n`
    } else if (lang === "js-like") {
      functionTemplate = `function extractedFunction() {\n${indent}  ${extracted.split("\n").join(`\n${indent}  `)}\n${indent}}\n\n`
    } else if (lang === "go") {
      functionTemplate = `func extractedFunction() {\n${indent}\t${extracted.split("\n").join(`\n${indent}\t`)}\n${indent}}\n\n`
    } else {
      functionTemplate = `void extractedFunction() {\n${indent}  ${extracted.split("\n").join(`\n${indent}  `)}\n${indent}}\n\n`
    }

    const callText = lang === "python" ? "extracted_function()" : "extractedFunction()"

    const { scopeStart } = findEnclosingScope(model, range.startLineNumber, range.endLineNumber)

    const edits: TextChange[] = [
      {
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: 1,
          endLineNumber: range.endLineNumber,
          endColumn: model.getLineContent(range.endLineNumber).length + 1,
        },
        text: `${indent}${callText}`,
      },
      {
        range: {
          startLineNumber: scopeStart,
          startColumn: 1,
          endLineNumber: scopeStart,
          endColumn: 1,
        },
        text: functionTemplate,
      },
    ]

    return {
      title: "Extract Function",
      kind: "refactor.extract.function",
      isPreferred: true,
      edit: { edits },
    }
  }

  private createExtractVariableAction(
    model: editor.ITextModel,
    range: languages.Range,
  ): RefactorAction {
    const extracted = model.getValueInRange(range)
    const indent = getIndentAtLine(model, range.startLineNumber)
    const lang = detectLanguageFromModel(model)

    const varName = "extractedValue"
    let declaration: string
    if (lang === "python") {
      declaration = `${varName} = ${extracted}`
    } else if (lang === "js-like") {
      declaration = `const ${varName} = ${extracted}`
    } else if (lang === "go") {
      declaration = `${varName} := ${extracted}`
    } else if (lang === "rust") {
      declaration = `let ${varName} = ${extracted}`
    } else {
      declaration = `var ${varName} = ${extracted}`
    }

    const edits: TextChange[] = [
      {
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn,
        },
        text: varName,
      },
      {
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: 1,
          endLineNumber: range.startLineNumber,
          endColumn: 1,
        },
        text: `${indent}${declaration}\n`,
      },
    ]

    return {
      title: "Extract Variable",
      kind: "refactor.extract.variable",
      isPreferred: false,
      edit: { edits },
    }
  }

  private createInlineVariableAction(
    model: editor.ITextModel,
    range: languages.Range,
  ): RefactorAction | null {
    const line = model.getLineContent(range.startLineNumber)
    const lang = detectLanguageFromModel(model)

    let varPattern: RegExp
    if (lang === "python") {
      varPattern = /(\w+)\s*=\s*(.+)/
    } else if (lang === "js-like") {
      varPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(.+)/
    } else if (lang === "go") {
      varPattern = /(\w+)\s*:=\s*(.+)/
    } else if (lang === "rust") {
      varPattern = /let\s+(?:mut\s+)?(\w+)\s*=\s*(.+)/
    } else {
      varPattern = /(?:var|final|val)\s+(\w+)\s*=\s*(.+)/
    }

    const match = line.match(varPattern)
    if (!match) return null

    const varName = match[1]
    const varValue = match[2].trim().replace(/;$/, "")

    const edits: TextChange[] = [
      {
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: 1,
          endLineNumber: range.startLineNumber,
          endColumn: line.length + 1,
        },
        text: "",
      },
    ]

    const lineCount = model.getLineCount()
    for (let i = 1; i <= lineCount; i++) {
      if (i === range.startLineNumber) continue
      const currentLine = model.getLineContent(i)
      const regex = new RegExp(`\\b${varName}\\b`, "g")
      if (regex.test(currentLine)) {
        edits.push({
          range: {
            startLineNumber: i,
            startColumn: 1,
            endLineNumber: i,
            endColumn: currentLine.length + 1,
          },
          text: currentLine.replace(new RegExp(`\\b${varName}\\b`, "g"), varValue),
        })
      }
    }

    return {
      title: "Inline Variable",
      kind: "refactor.inline.variable",
      isPreferred: false,
      edit: { edits },
    }
  }

  private createOrganizeImportsAction(model: editor.ITextModel): RefactorAction {
    const lineCount = model.getLineCount()
    const imports: string[] = []
    const nonImports: string[] = []
    let inBlockComment = false

    for (let i = 1; i <= lineCount; i++) {
      const line = model.getLineContent(i)

      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false
        nonImports.push(line)
        continue
      }

      if (line.trimStart().startsWith("/*")) {
        if (!line.includes("*/")) inBlockComment = true
        nonImports.push(line)
        continue
      }

      const trimmed = line.trim()
      if (
        trimmed.startsWith("import ") ||
        trimmed.startsWith("from ") ||
        trimmed.startsWith("using ") ||
        trimmed.startsWith("#include")
      ) {
        imports.push(line)
      } else if (trimmed === "" && imports.length > 0 && nonImports.length === 0) {
        continue
      } else {
        nonImports.push(line)
      }
    }

    const sorted = imports.sort((a, b) => a.localeCompare(b))
    const grouped = groupImports(sorted)
    const newContent = grouped.length > 0
      ? grouped.join("\n") + "\n\n" + nonImports.join("\n")
      : nonImports.join("\n")

    return {
      title: "Organize Imports",
      kind: "source.organizeImports",
      isPreferred: true,
      edit: {
        edits: [{
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: lineCount,
            endColumn: model.getLineContent(lineCount).length + 1,
          },
          text: newContent,
        }],
      },
    }
  }

  renameSymbol(model: editor.ITextModel, position: Position, newName: string): TextChange[] {
    const word = model.getWordAtPosition(position)
    if (!word) return []

    const oldName = word.word
    const edits: TextChange[] = []
    const lineCount = model.getLineCount()

    for (let i = 1; i <= lineCount; i++) {
      const line = model.getLineContent(i)
      const regex = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g")
      let matchResult: RegExpExecArray | null
      while ((matchResult = regex.exec(line)) !== null) {
        edits.push({
          range: {
            startLineNumber: i,
            startColumn: matchResult.index + 1,
            endLineNumber: i,
            endColumn: matchResult.index + 1 + oldName.length,
          },
          text: newName,
        })
      }
    }

    return edits
  }

  extractFunction(model: editor.ITextModel, range: languages.Range): RefactorAction {
    return this.createExtractFunctionAction(model, range)
  }

  extractVariable(model: editor.ITextModel, range: languages.Range): RefactorAction {
    return this.createExtractVariableAction(model, range)
  }

  inlineVariable(model: editor.ITextModel, range: languages.Range): RefactorAction | null {
    return this.createInlineVariableAction(model, range)
  }

  organizeImports(model: editor.ITextModel): RefactorAction {
    return this.createOrganizeImportsAction(model)
  }
}

function groupImports(imports: string[]): string[] {
  if (imports.length === 0) return []

  const groups: string[][] = [[]]
  let lastPrefix = ""

  for (const imp of imports) {
    const prefix = imp.trim().startsWith("import java.") ? "java"
      : imp.trim().startsWith("import javax.") ? "javax"
      : imp.trim().startsWith("import org.") ? "org"
      : imp.trim().startsWith("import com.") ? "com"
      : imp.trim().startsWith("import ") ? "other"
      : "local"

    if (lastPrefix && prefix !== lastPrefix) {
      groups.push([])
    }
    groups[groups.length - 1].push(imp)
    lastPrefix = prefix
  }

  return groups.map((g) => g.join("\n"))
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function codeActionKind(monaco: Monaco, key: string, fallback: string): languages.CodeActionKind {
  return (monaco.languages.CodeActionKind?.[key] || { value: fallback }) as languages.CodeActionKind
}

export function registerRefactorProvider(monaco: Monaco): DisposableLike {
  const provider = new RefactorProvider()
  const refactorExtractKind = codeActionKind(monaco, "RefactorExtract", "refactor.extract")
  const refactorInlineKind = codeActionKind(monaco, "RefactorInline", "refactor.inline")
  const sourceOrganizeImportsKind = codeActionKind(monaco, "SourceOrganizeImports", "source.organizeImports")

  const LANGUAGES = [
    "javascript", "typescript", "python", "java", "go", "rust", "cpp", "c",
    "kotlin", "scala", "jsx", "tsx",
  ]

  const disposables: DisposableLike[] = []
  for (const languageId of LANGUAGES) {
    disposables.push(editorLanguageFeatureService.registerCodeActionProvider(languageId, {
      providedCodeActionKinds: [
        refactorExtractKind,
        refactorInlineKind,
        sourceOrganizeImportsKind,
      ],
      provideCodeActions(model, range, context) {
        const actions = provider.getRefactorActions(model, range, context)
        const codeActions: languages.CodeAction[] = actions.map((action) => ({
          title: action.title,
          kind: action.kind as languages.CodeActionKind,
          isPreferred: action.isPreferred,
          edit: {
            edits: (action.edit.edits as TextChange[]).map((edit) => ({
              range: edit.range,
              text: edit.text,
            })),
          },
        }))
        return { actions: codeActions, dispose() {} }
      },
    }, monaco, {
      id: `refactor-actions:${languageId}`,
      source: "refactor",
    }))
  }
  return combineDisposables(...disposables)
}
