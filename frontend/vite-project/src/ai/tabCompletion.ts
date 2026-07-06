import type { editor, IDisposable } from 'monaco-editor'
import { predictCode, getCodePredictionContext, clearPrediction } from './inlinePrediction'

type MonacoRuntime = Pick<typeof import('monaco-editor'), 'KeyCode' | 'Range'>

const DEBOUNCE_MS = 300
const COMPLETION_MODE_KEY = 'codek-completion-mode'

type CompletionMode = 'basic' | 'ai'

function loadCompletionMode(): CompletionMode {
  try {
    const raw = localStorage.getItem(COMPLETION_MODE_KEY)
    if (raw === 'ai') return 'ai'
  } catch {
    // storage unavailable
  }
  return 'basic'
}

let completionMode: CompletionMode = loadCompletionMode()

export function getCompletionMode(): CompletionMode {
  return completionMode
}

export function setCompletionMode(mode: CompletionMode): void {
  completionMode = mode
  try {
    localStorage.setItem(COMPLETION_MODE_KEY, mode)
  } catch {
    // storage unavailable
  }
}

let ghostDecorations: string[] = []
let ghostText = ''
let predictionId = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let disposables: IDisposable[] = []
let stylesInjected = false

function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true

  const style = document.createElement('style')
  style.textContent = `
    .ghost-text-decoration {
      opacity: 0.4;
      font-style: italic;
      color: var(--text-muted, #5a5e6a);
    }
  `
  document.head.appendChild(style)
}

function dismissGhostText(editorInstance: editor.IStandaloneCodeEditor): void {
  if (ghostDecorations.length === 0) return

  ghostDecorations = editorInstance.deltaDecorations(ghostDecorations, [])
  ghostText = ''
}

function showGhostText(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: MonacoRuntime,
  text: string,
): void {
  if (!text) {
    dismissGhostText(editorInstance)
    return
  }

  const position = editorInstance.getPosition()
  if (!position) return

  const range = new monaco.Range(
    position.lineNumber,
    position.column,
    position.lineNumber,
    position.column,
  )

  ghostText = text
  ghostDecorations = editorInstance.deltaDecorations(ghostDecorations, [
    {
      range,
      options: {
        after: {
          content: text,
          inlineClassName: 'ghost-text-decoration',
        },
      },
    },
  ])
}

function acceptFullPrediction(editorInstance: editor.IStandaloneCodeEditor, monaco: MonacoRuntime): void {
  if (!ghostText) return

  const position = editorInstance.getPosition()
  if (!position) return

  const textToInsert = ghostText
  dismissGhostText(editorInstance)

  if (!textToInsert) return
  editorInstance.executeEdits('tab-completion', [
    {
      range: new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      ),
      text: textToInsert,
    },
  ])

  const lines = textToInsert.split('\n')
  const lastLine = lines[lines.length - 1]
  const newLine = position.lineNumber + lines.length - 1
  const newColumn =
    lines.length === 1
      ? position.column + lastLine.length
      : lastLine.length + 1

  editorInstance.setPosition({ lineNumber: newLine, column: newColumn })
  editorInstance.focus()
}

function acceptOneWord(editorInstance: editor.IStandaloneCodeEditor, monaco: MonacoRuntime): void {
  if (!ghostText) return

  const fullGhost = ghostText
  const words = fullGhost.match(/^[^\s]+/)
  const firstWord = words ? words[0] : fullGhost.slice(0, 1)

  const position = editorInstance.getPosition()
  if (!position) return

  dismissGhostText(editorInstance)

  if (!firstWord) return
  editorInstance.executeEdits('tab-completion-word', [
    {
      range: new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      ),
      text: firstWord,
    },
  ])

  const remaining = fullGhost.slice(firstWord.length)
  if (remaining.trim()) {
    const newPosition = editorInstance.getPosition()
    if (newPosition) {
      showGhostText(editorInstance, monaco, remaining)
    }
  }

  editorInstance.focus()
}

function schedulePrediction(editorInstance: editor.IStandaloneCodeEditor): void {
  if (completionMode === 'basic') return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    void runPrediction(editorInstance)
  }, DEBOUNCE_MS)
}

async function runPrediction(
  editorInstance: editor.IStandaloneCodeEditor,
): Promise<void> {
  const id = ++predictionId
  const context = getCodePredictionContext(editorInstance)

  if (!context.prefix.trim()) return

  const prediction = await predictCode(context)

  if (id !== predictionId) return
  if (!prediction) return
  if (ghostDecorations.length > 0) {
    ghostDecorations = editorInstance.deltaDecorations(ghostDecorations, [])
  }

  showGhostText(editorInstance, getMonacoRuntime(), prediction)
}

let activeMonaco: MonacoRuntime | null = null

function getMonacoRuntime(): MonacoRuntime {
  if (!activeMonaco) throw new Error('Monaco runtime is not initialized for tab completion')
  return activeMonaco
}

export function setupTabCompletion(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: MonacoRuntime,
): void {
  activeMonaco = monaco
  injectStyles()

  disposables.forEach((d) => d.dispose())
  disposables = []

  disposables.push(
    editorInstance.onDidChangeCursorPosition(() => {
      dismissGhostText(editorInstance)
      clearPrediction()
      schedulePrediction(editorInstance)
    }),
  )

  disposables.push(
    editorInstance.onDidChangeModelContent(() => {
      dismissGhostText(editorInstance)
      clearPrediction()
    }),
  )

  disposables.push(
    editorInstance.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.Escape) {
        if (ghostDecorations.length > 0) {
          dismissGhostText(editorInstance)
          clearPrediction()
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (event.keyCode === monaco.KeyCode.Tab && !event.shiftKey) {
        if (ghostDecorations.length > 0) {
          acceptFullPrediction(editorInstance, monaco)
          clearPrediction()
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (
        event.keyCode === monaco.KeyCode.RightArrow &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        if (ghostDecorations.length > 0) {
          acceptOneWord(editorInstance, monaco)
          event.preventDefault()
          event.stopPropagation()
        }
      }
    }),
  )
}

export { dismissGhostText }
