import { getActiveModel, getActiveType } from '../ai/aiProviders'
import type { editor } from 'monaco-editor'
import { globalCompletionCache } from './completionCache'
import { getCompletionModelOverride } from './completionModelSettings'
import { chatStream, readUnifiedStream } from './llmClient'

const AI_TIMEOUT_MS = 500
const LSP_TIMEOUT_MS = 200

function withTimeout<T>(promise: Promise<T>, ms: number, sentinel: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(sentinel), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(sentinel) },
    )
  })
}

async function lspCompletion(context: PredictionContext): Promise<string> {
  try {
    const monaco = await import('monaco-editor')
    const models = monaco.editor.getModels()
    const model = models.find((m) => m.uri.path.endsWith(context.filename)) || models[0]
    if (!model) return ''
    const lines = context.prefix.split('\n')
    const lineNumber = lines.length
    const column = (lines[lines.length - 1] || '').length + 1
    const position = new monaco.Position(lineNumber, column)
    const providers = monaco.languages.getLanguages()
    if (!providers.length) return ''
    const word = model.getWordUntilPosition(position)
    const wordText = word.word || ''
    if (!wordText) return ''
    return wordText
  } catch {
    return ''
  }
}

export type PredictionContext = {
  prefix: string
  suffix: string
  language: string
  filename: string
  fileContent: string
  imports: string
}

const MAX_PREDICTION_LINES = 10
const IMPORT_KEYWORDS = new Set([
  'import', 'export', 'from', 'require',
  'use', 'mod', 'extern',
  '#include',
  'package',
])

export let lastPrediction = ''
export let lastContext: PredictionContext | null = null

function extractImports(fileContent: string): string {
  const lines = fileContent.split('\n')
  const importLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const firstToken = trimmed.split(/\s+/)[0]
    if (IMPORT_KEYWORDS.has(firstToken)) {
      importLines.push(line)
      continue
    }

    if (
      trimmed.includes(' from ') &&
      (trimmed.startsWith('import ') || trimmed.startsWith('export '))
    ) {
      importLines.push(line)
    }
  }

  return importLines.join('\n')
}

export function getCodePredictionContext(
  editorInstance: editor.IStandaloneCodeEditor,
): PredictionContext {
  const model = editorInstance.getModel()
  const position = editorInstance.getPosition()

  const fileContent = model?.getValue() ?? ''
  const filename = model?.uri?.path?.split('/').pop() ?? 'untitled'
  const language = model?.getLanguageId() ?? 'plaintext'
  const imports = extractImports(fileContent)

  let prefix = ''
  let suffix = ''

  if (position && model) {
    const offset = model.getOffsetAt(position)
    prefix = fileContent.slice(0, offset)
    suffix = fileContent.slice(offset)
  } else {
    prefix = fileContent
  }

  return { prefix, suffix, language, filename, fileContent, imports }
}

function trimPrediction(text: string): string {
  const lines = text.split('\n')
  if (lines.length > MAX_PREDICTION_LINES) {
    return lines.slice(0, MAX_PREDICTION_LINES).join('\n')
  }
  return text
}

async function callAiModel(context: PredictionContext): Promise<string> {
  const type = getActiveType()
  const override = getCompletionModelOverride()
  const model = override || getActiveModel()

  if (!model) return ''

  const prompt = buildPredictionPrompt(context)

  try {
    const response = await chatStream({
      type,
      model,
      messages: [
        { role: 'system', content: 'You are a code completion assistant.' },
        { role: 'user', content: prompt },
      ],
      stream: true,
      maxTokens: 512,
    })

    if (!response.ok || !response.body) return ''

    let result = ''
    await readUnifiedStream(response.body, (content) => {
      result = content
    })

    return trimPrediction(result)
  } catch {
    return ''
  }
}

export async function predictCode(context: PredictionContext): Promise<string> {
  const lines = context.prefix.split('\n')
  const lineNumber = lines.length
  const currentLine = lines[lines.length - 1] || ''

  const aiResult = await withTimeout(callAiModel(context), AI_TIMEOUT_MS, '')
  if (aiResult) {
    globalCompletionCache.set(context.filename, lineNumber, currentLine, aiResult)
    lastPrediction = aiResult
    lastContext = context
    return aiResult
  }

  const lspResult = await withTimeout(lspCompletion(context), LSP_TIMEOUT_MS, '')
  if (lspResult) {
    lastPrediction = lspResult
    lastContext = context
    return lspResult
  }

  const cached = globalCompletionCache.lookupByPrefix(context.filename, lineNumber, currentLine)
  if (cached) {
    lastPrediction = cached
    lastContext = context
    return cached
  }

  return ''
}

function buildPredictionPrompt(context: PredictionContext): string {
  const { prefix, language } = context

  return `Complete the following ${language} code. Only output the code that should follow, no explanations:

${prefix}`
}

export function clearPrediction(): void {
  lastPrediction = ''
  lastContext = null
}
