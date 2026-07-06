<template>
  <div v-if="visible" class="terminal-panel" data-codek-smoke="terminal-panel" @keydown="handleTerminalKeydown">
    <div class="terminal-header">
      <div class="terminal-tabs">
        <button
          v-for="term in allTerminals"
          :key="term.id"
          class="terminal-tab"
          :class="{ active: term.id === activeId }"
          @click="handleSwitchTerminal(term.id)"
        >
          <span class="terminal-tab-name">{{ term.name }}</span>
          <span v-if="term.exited" class="terminal-tab-exited" :title="t('terminal.exited')">●</span>
          <button
            v-if="allTerminals.length > 1"
            class="terminal-tab-close"
            @click.stop="handleCloseTerminal(term.id)"
            :title="t('terminal.close')"
          >&times;</button>
        </button>
        <button class="terminal-tab-add" @click="handleCreateTerminal" :title="t('terminal.newTerminal')">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
        <button class="terminal-tab-add" @click="handleSplitTerminal" title="拆分终端">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
            <line x1="8" y1="3" x2="8" y2="13" />
          </svg>
        </button>
      </div>
      <div class="terminal-actions">
        <div class="shell-selector">
          <select v-model="selectedShell" class="shell-select" @change="handleShellChange" :title="t('terminal.shellType')">
            <option v-for="shell in shellTypes" :key="shell" :value="shell">{{ getShellLabel(shell) }}</option>
          </select>
        </div>
        <button
          class="terminal-btn ai-btn"
          :title="t('terminalAI.button')"
          @click="toggleAiInput"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 1.5a.5.5 0 0 1 .5.5v.5h1a1 1 0 0 1 0 2h-.5l-.5 8a1.5 1.5 0 0 1-3 0l-.5-8H4.5a1 1 0 1 1 0-2h1V2a.5.5 0 0 1 .5-.5z" />
            <path d="M3 13.5h10" />
          </svg>
          <span class="ai-btn-label">{{ t('terminalAI.button') }}</span>
        </button>
        <button class="terminal-btn" @click="handleClear" :title="t('terminal.clear')">{{ t('terminal.clear') }}</button>
        <button class="terminal-btn" @click="$emit('close')" :title="t('terminal.close')">{{ t('terminal.close') }}</button>
      </div>
    </div>

    <div class="terminal-body" ref="bodyRef">
      <div
        v-for="term in allTerminals"
        :key="term.id"
        v-show="visibleTerminalIds.includes(term.id)"
        :ref="(el) => bindContainer(term.id, el as HTMLDivElement | null)"
        class="terminal-host"
        :class="{ active: term.id === activeId }"
      ></div>
    </div>

    <div v-if="showAiInput" class="terminal-ai-row">
      <div v-if="aiGenerating" class="terminal-ai-generating">
        <span class="spinner-small"></span>
        <span>{{ t('terminalAI.generating') }}</span>
      </div>

      <template v-else-if="aiGeneratedCommand">
        <div class="terminal-ai-result">
          <code class="terminal-ai-cmd">{{ aiGeneratedCommand }}</code>
          <div class="terminal-ai-actions">
            <button class="terminal-ai-run" @click="runAiCommand">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {{ t('terminalAI.run') }}
            </button>
            <button class="terminal-ai-cancel" @click="cancelAiCommand">
              {{ t('terminalAI.cancel') }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <svg class="terminal-ai-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
        </svg>
        <input
          ref="aiInputRef"
          v-model="aiPrompt"
          class="terminal-ai-input"
          type="text"
          :placeholder="t('terminalAI.placeholder')"
          :disabled="aiGenerating"
          @keydown.enter.prevent="generateAiCommand"
          @keydown.escape.prevent="cancelAiCommand"
        />
        <button
          class="terminal-ai-submit"
          :disabled="aiGenerating || !aiPrompt.trim()"
          @click="generateAiCommand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </template>
    </div>

    <div v-if="showAiErrorAnalysis" class="terminal-error-banner">
      <div class="terminal-error-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ t('terminalAI.errorDetected') }}</span>
        <button class="terminal-error-close" @click="showAiErrorAnalysis = false">&times;</button>
      </div>
      <div v-if="aiErrorAnalyzing" class="terminal-error-analyzing">
        <span class="spinner-small"></span>
        <span>{{ t('terminalAI.analyzing') }}</span>
      </div>
      <div v-else-if="aiErrorAnalysis" class="terminal-error-result">
        <pre class="terminal-error-text">{{ aiErrorAnalysis }}</pre>
        <button class="terminal-ai-run" @click="showAiErrorAnalysis = false">{{ t('terminalAI.dismiss') }}</button>
      </div>
      <button v-else class="terminal-ai-run" @click="analyzeTerminalError">
        {{ t('terminalAI.analyzeError') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import "@xterm/xterm/css/xterm.css"
import { useI18n } from "../i18n/index"
import { chatSync } from "../ai/llmClient"
import { getActiveProvider, getActiveModel } from "../ai/aiProviders"
import { settingsStore } from "../settings/settingsStore"
import {
  getProfileFromShellType,
  getShellTypeFromProfile,
  getTerminalSettingsOptions,
} from "../settings/terminalSettings"
import {
  createTerminal,
  closeTerminal as closeTerminalInstance,
  switchTerminal,
  getAllTerminals,
  getActiveTerminalId,
  getActiveTerminal,
  getVisibleTerminalIds,
  attachPty,
  markExited,
  onTerminalEvent,
  updateShellIntegration,
  getShellTypes,
  getShellLabel,
  getTerminalById,
  splitTerminal,
  type ShellType,
} from "../terminal/terminalManager"
import { buildInstrumentedCommand, TerminalShellIntegrationTracker } from "../terminal/shellIntegration"

const { t } = useI18n()

const TERMINAL_AI_PROMPT = `You are a shell command generator. Given a natural language description of what the user wants to do, output ONLY the shell command to accomplish it. Output just the command, no explanation, no markdown formatting. Consider the project context provided.`

const TERMINAL_ERROR_ANALYSIS_PROMPT = `You are a terminal error analysis assistant. Given the error output from a failed command, analyze the root cause and provide a specific fix. Your response should be concise (under 200 words) and structured as:
1. Root cause (one sentence)
2. How to fix (specific command or code change)
Output in plain text, no markdown.`

interface PtyDataPayload {
  id: string
  data: string
}

interface PtyExitPayload {
  id: string
  exitCode: number | null
  signal: number | null
}

interface PtyCreateResult {
  ok: boolean
  id?: string
  pid?: number
  shellType?: ShellType
  cwd?: string
  error?: string
}

interface CodekPtyApi {
  isAvailable: () => Promise<boolean>
  create: (opts: {
    id?: string
    shellType?: ShellType
    cwd?: string
    cols?: number
    rows?: number
    confirmed?: boolean
  }) => Promise<PtyCreateResult>
  write: (id: string, data: string) => Promise<boolean>
  resize: (id: string, cols: number, rows: number) => Promise<boolean>
  dispose: (id: string) => Promise<boolean>
  list: () => Promise<Array<{ id: string; pid: number; shellType: ShellType; cwd: string }>>
  onData: (cb: (payload: PtyDataPayload) => void) => () => void
  onExit: (cb: (payload: PtyExitPayload) => void) => () => void
}

interface CodekApi {
  pty?: CodekPtyApi
  getProjectRoot?: () => Promise<string | null>
}

const props = defineProps<{
  visible: boolean
  projectRoot?: string
}>()

defineEmits<{
  close: []
}>()

const bodyRef = ref<HTMLDivElement | null>(null)
const aiInputRef = ref<HTMLInputElement | null>(null)
const showAiInput = ref(false)
const aiPrompt = ref("")
const aiGenerating = ref(false)
const aiGeneratedCommand = ref("")
const selectedShell = ref<ShellType>(
  getShellTypeFromProfile(settingsStore.get("terminal.integrated.defaultProfile.windows")),
)
const forceUpdate = ref(0)

// Error analysis state
const showAiErrorAnalysis = ref(false)
const aiErrorOutput = ref("")
const aiErrorAnalysis = ref("")
const aiErrorAnalyzing = ref(false)
const terminalOutputBuffer = ref<string[]>([])

const shellTypes = getShellTypes()

interface TerminalSession {
  xterm: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  container: HTMLDivElement | null
  pendingInput: string[]
  onDataDisposable: { dispose: () => void } | null
  shellTracker: TerminalShellIntegrationTracker
}

const sessions = new Map<string, TerminalSession>()
let unsubscribePtyData: (() => void) | null = null
let unsubscribePtyExit: (() => void) | null = null
let unsubscribeManager: (() => void) | null = null
let unsubscribeSettings: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

const allTerminals = computed(() => {
  void forceUpdate.value
  return getAllTerminals()
})

const activeId = computed(() => {
  void forceUpdate.value
  return getActiveTerminalId()
})

const visibleTerminalIds = computed(() => {
  void forceUpdate.value
  return getVisibleTerminalIds()
})

function codekApi(): CodekApi | undefined {
  return (window as unknown as { codek?: CodekApi }).codek
}

async function resolveCwd(): Promise<string> {
  if (props.projectRoot) return props.projectRoot
  const api = codekApi()
  if (api?.getProjectRoot) {
    try {
      const root = await api.getProjectRoot()
      if (root) return root
    } catch {
      // ignore
    }
  }
  return ""
}

function buildXterm(): { xterm: Terminal; fitAddon: FitAddon } {
  const terminalOptions = getTerminalSettingsOptions(settingsStore.getAll())
  const xterm = new Terminal({
    fontFamily: terminalOptions.fontFamily,
    fontSize: terminalOptions.fontSize,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: terminalOptions.scrollback,
    allowProposedApi: true,
    theme: {
      background: "#0d0e10",
      foreground: "#e5e7eb",
      cursor: "#2dd4bf",
      cursorAccent: "#0d0e10",
      selectionBackground: "rgba(45, 212, 191, 0.25)",
      black: "#1f2937",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e5e7eb",
      brightBlack: "#6b7280",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f9fafb",
    },
  })
  const fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(new WebLinksAddon())
  return { xterm, fitAddon }
}

function applyTerminalSettings(): void {
  const terminalOptions = getTerminalSettingsOptions(settingsStore.getAll())
  selectedShell.value = getShellTypeFromProfile(
    settingsStore.get("terminal.integrated.defaultProfile.windows"),
  )
  for (const session of sessions.values()) {
    session.xterm.options = {
      ...session.xterm.options,
      ...terminalOptions,
    }
    try {
      session.fitAddon.fit()
    } catch {
      // terminal may not be visible yet
    }
  }
}

function ensureSession(terminalId: string): TerminalSession {
  let session = sessions.get(terminalId)
  if (session) return session
  const { xterm, fitAddon } = buildXterm()
  session = {
    xterm,
    fitAddon,
    ptyId: null,
    container: null,
    pendingInput: [],
    onDataDisposable: null,
    shellTracker: new TerminalShellIntegrationTracker(terminalId, getTerminalById(terminalId)?.cwd || ""),
  }
  sessions.set(terminalId, session)
  return session
}

async function startPty(terminalId: string): Promise<void> {
  const api = codekApi()?.pty
  const term = getTerminalById(terminalId)
  if (!api || !term) return
  const session = ensureSession(terminalId)
  if (session.ptyId) return

  const cwd = term.cwd || (await resolveCwd())
  const cols = session.xterm.cols || 80
  const rows = session.xterm.rows || 24

    const result = await api.create({
      shellType: term.shellType,
      cwd,
      cols,
      rows,
      confirmed: true,
    })

  if (!result.ok || !result.id) {
    session.xterm.writeln(`\x1b[31m[terminal] ${result.error || "启动终端失败"}\x1b[0m`)
    return
  }

  session.ptyId = result.id
  attachPty(terminalId, result.id, result.pid ?? null)

  session.onDataDisposable = session.xterm.onData((data) => {
    if (session.ptyId) {
      void api.write(session.ptyId, data)
    } else {
      session.pendingInput.push(data)
    }
  })

  for (const buffered of session.pendingInput) {
    void api.write(result.id, buffered)
  }
  session.pendingInput = []

  session.xterm.onResize(({ cols: nc, rows: nr }) => {
    if (session.ptyId) {
      void api.resize(session.ptyId, nc, nr)
    }
  })
}

function bindContainer(terminalId: string, el: HTMLDivElement | null): void {
  if (!el) return
  const session = ensureSession(terminalId)
  if (session.container === el) return
  session.container = el

  if (!el.hasChildNodes()) {
    session.xterm.open(el)
  }

  nextTick(() => {
    try {
      session.fitAddon.fit()
    } catch {
      // container may not have layout yet
    }
    if (!session.ptyId) {
      void startPty(terminalId)
    }
    if (terminalId === activeId.value) {
      session.xterm.focus()
    }
  })
}

function disposeSession(terminalId: string): void {
  const session = sessions.get(terminalId)
  if (!session) return
  session.onDataDisposable?.dispose()
  if (session.ptyId) {
    void codekApi()?.pty?.dispose(session.ptyId)
  }
  session.xterm.dispose()
  sessions.delete(terminalId)
}

function findTerminalByPtyId(ptyId: string): { terminalId: string; session: TerminalSession } | null {
  for (const [terminalId, session] of sessions) {
    if (session.ptyId === ptyId) {
      return { terminalId, session }
    }
  }
  return null
}

async function handleCreateTerminal(): Promise<void> {
  const cwd = await resolveCwd()
  createTerminal(selectedShell.value, cwd)
  forceUpdate.value += 1
}

async function openAtPath(cwd?: string): Promise<void> {
  createTerminal(selectedShell.value, cwd || (await resolveCwd()))
  forceUpdate.value += 1
  await nextTick()
  fitVisible()
}

async function handleSplitTerminal(): Promise<void> {
  const cwd = await resolveCwd()
  splitTerminal(selectedShell.value, cwd)
  forceUpdate.value += 1
  await nextTick()
  fitVisible()
}

function handleCloseTerminal(terminalId: string): void {
  disposeSession(terminalId)
  closeTerminalInstance(terminalId)
  forceUpdate.value += 1
}

function handleSwitchTerminal(terminalId: string): void {
  switchTerminal(terminalId)
  forceUpdate.value += 1
  nextTick(() => {
    const session = sessions.get(terminalId)
    if (session) {
      try {
        session.fitAddon.fit()
      } catch {
        // ignore
      }
      session.xterm.focus()
    }
  })
}

function handleShellChange(): void {
  settingsStore.set(
    "terminal.integrated.defaultProfile.windows",
    getProfileFromShellType(selectedShell.value),
  )
  const active = getActiveTerminal()
  if (!active) return
  if (active.shellType === selectedShell.value) return

  disposeSession(active.id)
  closeTerminalInstance(active.id)
  forceUpdate.value += 1
  void handleCreateTerminal()
}

function handleClear(): void {
  const active = getActiveTerminal()
  if (!active) return
  const session = sessions.get(active.id)
  session?.xterm.clear()
}

function runCommand(command: string): void {
  const cmd = command.trim()
  if (!cmd) return
  const active = getActiveTerminal()
  if (!active) return
  const session = sessions.get(active.id)
  if (!session) return
  const instrumentedCommand = buildInstrumentedCommand(cmd, active.shellType)
  if (session.ptyId) {
    void codekApi()?.pty?.write(session.ptyId, `${instrumentedCommand || cmd}\r`)
  } else {
    session.pendingInput.push(`${instrumentedCommand || cmd}\r`)
    session.xterm.writeln(cmd)
  }
}

function toggleAiInput(): void {
  showAiInput.value = !showAiInput.value
  aiGeneratedCommand.value = ""
  aiPrompt.value = ""
  if (showAiInput.value) {
    nextTick(() => aiInputRef.value?.focus())
  }
}

function handleTerminalKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    showAiInput.value = true
    aiGeneratedCommand.value = ""
    aiPrompt.value = ""
    nextTick(() => aiInputRef.value?.focus())
  }
}

async function analyzeTerminalError(): Promise<void> {
  if (aiErrorAnalyzing.value || !aiErrorOutput.value) return
  aiErrorAnalyzing.value = true
  try {
    const response = await chatSync({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: "system", content: TERMINAL_ERROR_ANALYSIS_PROMPT },
        { role: "user", content: `Command error output:\n${aiErrorOutput.value.slice(-2000)}` },
      ],
      stream: false,
    })
    aiErrorAnalysis.value = response.trim() || "无法分析此错误，请检查命令和输出。"
  } catch {
    aiErrorAnalysis.value = "智能分析失败，请手动检查错误信息。"
  } finally {
    aiErrorAnalyzing.value = false
  }
}

async function generateAiCommand(): Promise<void> {
  const prompt = aiPrompt.value.trim()
  if (!prompt || aiGenerating.value) return

  aiGenerating.value = true
  aiGeneratedCommand.value = ""

  try {
    const getRoot = codekApi()?.getProjectRoot
    let projectContext = ""
    if (getRoot) {
      const root = await getRoot()
      if (root) projectContext = `Project root: ${root}`
    }

    const response = await chatSync({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: "system", content: TERMINAL_AI_PROMPT },
        { role: "user", content: `${projectContext}\n\nTask: ${prompt}` },
      ],
      stream: false,
    })

    const cleaned = response.trim()
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim()

    if (cleaned) aiGeneratedCommand.value = cleaned
  } catch {
    // silently fail
  } finally {
    aiGenerating.value = false
  }
}

function runAiCommand(): void {
  const cmd = aiGeneratedCommand.value.trim()
  if (!cmd) return
  const active = getActiveTerminal()
  if (active) {
    const session = sessions.get(active.id)
    if (session?.ptyId) {
      void codekApi()?.pty?.write(session.ptyId, `${cmd}\r`)
    }
  }
  showAiInput.value = false
  aiGeneratedCommand.value = ""
  aiPrompt.value = ""
}

function cancelAiCommand(): void {
  showAiInput.value = false
  aiGeneratedCommand.value = ""
  aiPrompt.value = ""
}

function fitActive(): void {
  const id = activeId.value
  const session = sessions.get(id)
  if (!session) return
  try {
    session.fitAddon.fit()
  } catch {
    // ignore
  }
}

function fitVisible(): void {
  for (const id of visibleTerminalIds.value) {
    const session = sessions.get(id)
    if (!session) continue
    try {
      session.fitAddon.fit()
    } catch {
      // ignore
    }
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    if (getAllTerminals().length === 0) {
      const cwd = await resolveCwd()
      createTerminal(selectedShell.value, cwd)
      forceUpdate.value += 1
    }
    nextTick(fitVisible)
  },
)

onMounted(async () => {
  selectedShell.value = getShellTypeFromProfile(
    settingsStore.get("terminal.integrated.defaultProfile.windows"),
  )
  unsubscribeSettings = settingsStore.subscribe(() => {
    applyTerminalSettings()
  })

  if (getAllTerminals().length === 0) {
    const cwd = await resolveCwd()
    createTerminal(selectedShell.value, cwd)
    forceUpdate.value += 1
  }

  unsubscribeManager = onTerminalEvent(() => {
    forceUpdate.value += 1
  })

  const api = codekApi()?.pty
  if (api) {
    unsubscribePtyData = api.onData(({ id, data }) => {
      const found = findTerminalByPtyId(id)
      if (found) {
        const parsed = found.session.shellTracker.parse(data)
        found.session.xterm.write(parsed.cleanedData)
        if (parsed.events.length > 0) {
          updateShellIntegration(found.terminalId, {
            available: true,
            cwd: found.session.shellTracker.currentCwd,
            activeCommand: found.session.shellTracker.activeCommandRecord,
            recentCommands: found.session.shellTracker.getCommands(),
          })
        }
        const clean = parsed.cleanedData.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r?\n/g, "\n")
        terminalOutputBuffer.value.push(clean)
        if (terminalOutputBuffer.value.length > 60) {
          terminalOutputBuffer.value = terminalOutputBuffer.value.slice(-60)
        }
      }
    })
    unsubscribePtyExit = api.onExit(({ id, exitCode }) => {
      const found = findTerminalByPtyId(id)
      if (!found) return
      markExited(found.terminalId, exitCode)
      found.session.xterm.writeln(`\r\n\x1b[2m[process exited with code ${exitCode ?? "?"}]\x1b[0m`)
      found.session.ptyId = null
      if (exitCode !== 0 && exitCode !== null) {
        aiErrorOutput.value = terminalOutputBuffer.value.join("").slice(-3000)
        showAiErrorAnalysis.value = true
        aiErrorAnalysis.value = ""
      }
    })
  }

  if (bodyRef.value) {
    resizeObserver = new ResizeObserver(() => fitVisible())
    resizeObserver.observe(bodyRef.value)
  }
})

onBeforeUnmount(() => {
  unsubscribeManager?.()
  unsubscribeSettings?.()
  unsubscribePtyData?.()
  unsubscribePtyExit?.()
  resizeObserver?.disconnect()
  for (const id of [...sessions.keys()]) {
    disposeSession(id)
  }
})

defineExpose({
  createTerminal: handleCreateTerminal,
  openAtPath,
  splitTerminal: handleSplitTerminal,
  clear: handleClear,
  runCommand,
})
</script>

<style scoped>
.terminal-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.terminal-header {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  gap: 8px;
}

.terminal-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}

.terminal-tabs::-webkit-scrollbar {
  height: 0;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  font-family: var(--font-sans);
}

.terminal-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.terminal-tab.active {
  color: var(--text-primary);
  background: var(--bg-dark);
  border-color: var(--border);
}

.terminal-tab-exited {
  color: var(--text-muted);
  font-size: 8px;
}

.terminal-tab-close {
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.terminal-tab-close:hover {
  color: var(--red);
  background: rgba(248, 113, 113, 0.1);
}

.terminal-tab-add {
  width: 24px;
  height: 24px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}

.terminal-tab-add:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-dim);
}

.terminal-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.shell-selector {
  position: relative;
}

.shell-select {
  appearance: none;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-secondary);
  font-size: 10px;
  padding: 3px 18px 3px 6px;
  cursor: pointer;
  outline: none;
  font-family: var(--font-sans);
  background-image: url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%235a5e6a'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
}

.shell-select:hover {
  border-color: var(--border-bright);
}

.shell-select:focus {
  border-color: var(--accent);
}

.terminal-btn {
  border: 1px solid var(--border);
  background: var(--bg-dark);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

.terminal-btn:hover {
  background: var(--bg-hover);
}

.terminal-btn.ai-btn {
  color: var(--accent);
  border-color: rgba(45, 212, 191, 0.3);
  background: rgba(45, 212, 191, 0.06);
  display: flex;
  align-items: center;
  gap: 4px;
}

.terminal-btn.ai-btn:hover {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.ai-btn-label {
  font-size: 10px;
}

.terminal-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  background: #0d0e10;
}

.terminal-host {
  min-width: 0;
  min-height: 0;
  padding: 8px 4px 8px 10px;
  border-left: 1px solid var(--border-subtle);
}

.terminal-host:first-child {
  border-left: 0;
}

.terminal-host.active {
  box-shadow: inset 0 1px 0 rgba(45, 212, 191, 0.35);
}

.terminal-host :deep(.xterm) {
  height: 100%;
}

.terminal-host :deep(.xterm-viewport) {
  background: transparent !important;
}

.terminal-ai-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  background: rgba(45, 212, 191, 0.04);
  flex-shrink: 0;
}

.terminal-ai-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.terminal-ai-input {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 12px;
  outline: none;
  font-family: var(--font-sans);
}

.terminal-ai-input:focus {
  border-color: var(--accent);
}

.terminal-ai-input::placeholder {
  color: var(--text-muted);
}

.terminal-ai-submit {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #0d0e10;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.terminal-ai-submit:disabled {
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: not-allowed;
}

.terminal-ai-generating {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 0;
}

.terminal-ai-result {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.terminal-ai-cmd {
  flex: 1;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  color: var(--accent);
  background: var(--bg-deepest);
  padding: 5px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-ai-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.terminal-ai-run {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 5px;
  background: var(--accent);
  color: #0d0e10;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
}

.terminal-ai-run:hover {
  opacity: 0.88;
}

.terminal-ai-cancel {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
}

.terminal-ai-cancel:hover {
  background: var(--bg-hover);
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
