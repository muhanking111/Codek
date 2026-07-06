<template>
  <Transition name="palette">
    <div v-if="visible" class="palette-overlay" @click.self="close">
      <div class="palette-panel" role="dialog" :aria-label="t('app.cmdCommandPalette')" aria-modal="true" @click.stop>
        <div class="palette-search-wrap">
          <svg
            class="palette-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 21l-5.2-5.2" />
            <circle cx="11" cy="11" r="8" />
          </svg>
          <input
            ref="inputRef"
            v-model="query"
            class="palette-search-input"
            type="text"
            autofocus
            :placeholder="placeholderText"
            @keydown="handleKeydown"
            @input="handleInput"
          />
        </div>

        <div class="palette-results">
          <template v-if="paletteMode === 'goto'">
            <div class="palette-section">
              <div class="palette-section-header">跳转到行号</div>
              <div class="palette-mode-hint">输入行号后按 Enter 跳转</div>
            </div>
          </template>

          <template v-else-if="paletteMode === 'symbol'">
            <div class="palette-section">
              <div class="palette-section-header">搜索符号</div>
              <div class="palette-mode-hint">输入符号名后按 Enter 搜索</div>
            </div>
          </template>

          <template v-else-if="paletteMode === 'files'">
            <div v-if="fileResults.length" class="palette-section">
              <div class="palette-section-header">打开文件</div>
              <div
                v-for="(item, index) in fileResults"
                :key="item.file.path"
                class="palette-item"
                :class="{ active: index === activeIndex }"
                @click="close(); emit('openFile', item.file.path)"
                @mouseenter="activeIndex = index"
              >
                <span class="palette-item-icon">📄</span>
                <span class="palette-item-label" v-html="highlightMatch(item.file.path, item.indices)"></span>
              </div>
            </div>
            <div v-else class="palette-empty">没有匹配文件</div>
          </template>

          <template v-else-if="paletteMode === 'quickAccess'">
            <div v-if="quickAccessResults.length" class="palette-section">
              <div class="palette-section-header">{{ quickAccessSectionLabel }}</div>
              <div
                v-for="(item, index) in quickAccessResults"
                :key="item.id"
                class="palette-item"
                :class="{ active: index === activeIndex }"
                @click="acceptQuickAccessItem(item)"
                @mouseenter="activeIndex = index"
              >
                <span class="palette-item-icon quick-access-icon">›</span>
                <span class="palette-item-label">{{ item.label }}</span>
                <span v-if="item.description" class="palette-item-category">{{ item.description }}</span>
                <button
                  v-for="button in item.buttons || []"
                  :key="button.id"
                  class="palette-item-button"
                  type="button"
                  :title="button.tooltip || button.label || button.id"
                  @click.stop="acceptQuickAccessButton(item, button.id)"
                >
                  {{ button.label || button.id }}
                </button>
              </div>
            </div>
            <div v-else class="palette-empty">没有匹配的快速访问结果</div>
          </template>

          <template v-else-if="!query.trim()">
            <div v-if="pinnedCommands.length > 0" class="palette-section">
              <div class="palette-section-header">常用命令</div>
              <div
                v-for="(cmd, idx) in pinnedCommands"
                :key="'pin-' + cmd.id"
                class="palette-item"
                :class="{ active: activeIndex === idx }"
                @click="execute(cmd)"
                @mouseenter="activeIndex = idx"
              >
                <span class="palette-item-icon pinned-icon">★</span>
                <span class="palette-item-label">{{ cmd.label }}</span>
                <span class="palette-item-category" :class="'cat-' + cmd.category.toLowerCase()">{{ formatCategoryLabel(cmd.category) }}</span>
                <span v-if="cmd.shortcut" class="palette-item-shortcut">{{ cmd.shortcut }}</span>
              </div>
            </div>

            <div v-if="recentCommands.length > 0" class="palette-section">
              <div class="palette-section-header">最近使用</div>
              <div
                v-for="(cmd, idx) in recentCommands"
                :key="'recent-' + cmd.id"
                class="palette-item"
                :class="{ active: activeIndex === pinnedCommands.length + idx }"
                @click="execute(cmd)"
                @mouseenter="activeIndex = pinnedCommands.length + idx"
              >
                <span class="palette-item-icon recent-icon">↻</span>
                <span class="palette-item-label">{{ cmd.label }}</span>
                <span class="palette-item-category" :class="'cat-' + cmd.category.toLowerCase()">{{ formatCategoryLabel(cmd.category) }}</span>
                <span v-if="cmd.shortcut" class="palette-item-shortcut">{{ cmd.shortcut }}</span>
              </div>
            </div>

            <div v-if="commandPaletteCommands.length > 0 && pinnedCommands.length === 0 && recentCommands.length === 0" class="palette-section">
              <div class="palette-section-header">所有命令</div>
              <div
                v-for="(cmd, idx) in commandPaletteCommands"
                :key="'all-' + cmd.id"
                class="palette-item"
                :class="{ active: activeIndex === idx }"
                @click="execute(cmd)"
                @mouseenter="activeIndex = idx"
              >
                <span class="palette-item-icon"></span>
                <span class="palette-item-label">{{ cmd.label }}</span>
                <span class="palette-item-category" :class="'cat-' + cmd.category.toLowerCase()">{{ cmd.category }}</span>
                <span v-if="cmd.shortcut" class="palette-item-shortcut">{{ cmd.shortcut }}</span>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-if="filteredResults.length" class="palette-section">
              <div class="palette-section-header">
                {{ categoryFilter ? `分类: ${formatCategoryLabel(categoryFilter)}` : '匹配结果' }}
              </div>
              <div
                v-for="(item, index) in filteredResults"
                :key="item.cmd.id"
                class="palette-item"
                :class="{ active: index === activeIndex }"
                @click="execute(item.cmd)"
                @mouseenter="activeIndex = index"
              >
                <span class="palette-item-icon"></span>
                <span class="palette-item-label" v-html="highlightMatch(item.cmd.label, item.matchIndices)"></span>
                <span class="palette-item-category" :class="'cat-' + item.cmd.category.toLowerCase()">{{ formatCategoryLabel(item.cmd.category) }}</span>
                <span v-if="item.cmd.shortcut" class="palette-item-shortcut">{{ item.cmd.shortcut }}</span>
              </div>
            </div>

            <div v-if="!filteredResults.length" class="palette-empty">
              找不到匹配的命令
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import { scoreCommandPaletteMatchWithHighlights } from '../vscode-adapter/platform/commands/common/commandScoring'
import { MenuId, MenuRegistry } from '../vscode-adapter/platform/actions/common/menuRegistry'
import { matchQuickAccessProvider, quickAccessController, type QuickAccessItem, type QuickAccessProviderDescriptor } from '../vscode-adapter/platform/quickinput/common/quickAccess'
import { filterFileQuickAccess } from '../vscode-adapter/workbench/browser/quickaccess/fileQuickAccessScoring'
import { discoverWorkspaceFiles, knownWorkspaceFiles } from '../workspace/fileDiscovery'
import { executeCommand as executeWorkbenchCommand, getCommands } from '../workbench/commandRegistry'
import { hasSymbolNavigationCommandHandoff } from '../workbench/symbolNavigationService'

export interface CommandPaletteCommand {
  id: string
  label: string
  category: CommandCategory
  shortcut?: string
  action?: () => void
}

type CommandCategory = 'File' | 'Edit' | 'Selection' | 'View' | 'Navigation' | 'Run' | 'AI' | 'Git' | 'Help'

interface ScoredCommand {
  cmd: CommandPaletteCommand
  score: number
  matchIndices: number[]
}

const RECENT_KEY = 'codek-recent-commands'
const MAX_RECENT = 20

const PINNED_IDS: string[] = [
  'save',
  'formatDocument',
  'globalSearch',
  'goToDefinition',
  'commandPalette',
]

const CATEGORY_ORDER: Record<string, number> = {
  File: 0,
  Edit: 1,
  Selection: 2,
  View: 3,
  Navigation: 4,
  Run: 5,
  AI: 6,
  Git: 7,
  Help: 8,
}

const CATEGORY_ALIASES: Record<string, CommandCategory> = {
  file: 'File',
  文件: 'File',
  edit: 'Edit',
  编辑: 'Edit',
  selection: 'Selection',
  select: 'Selection',
  选择: 'Selection',
  view: 'View',
  视图: 'View',
  navigation: 'Navigation',
  nav: 'Navigation',
  导航: 'Navigation',
  run: 'Run',
  运行: 'Run',
  ai: 'AI',
  智能: 'AI',
  git: 'Git',
  help: 'Help',
  帮助: 'Help',
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  File: '文件',
  Edit: '编辑',
  Selection: '选择',
  View: '视图',
  Navigation: '导航',
  Run: '运行',
  AI: '智能',
  Git: 'Git',
  Help: '帮助',
}

const visible = ref(false)
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const recentIds = ref<string[]>(loadRecent())
const registeredCommands = ref<CommandPaletteCommand[]>([])
const placeholderIndex = ref(0)

interface FileEntry {
  name: string
  path: string
}

const emit = defineEmits<{
  close: []
  execute: [id: string]
  gotoLine: [line: number]
  symbolSearch: [query: string]
  openFile: [path: string]
}>()

const forcedMode = ref<'files' | null>(null)
const discoveredFiles = ref<FileEntry[]>([])
const quickAccessResults = ref<QuickAccessItem[]>([])
const activeQuickAccessProvider = ref<QuickAccessProviderDescriptor | null>(null)
const { t } = useI18n()

function formatCategoryLabel(category: CommandCategory | ''): string {
  if (!category) return ''
  return CATEGORY_LABELS[category] || category
}

function toFileEntry(pathValue: string): FileEntry {
  const normalized = String(pathValue || '').replace(/\\/g, '/')
  return {
    name: normalized.split('/').filter(Boolean).pop() || normalized,
    path: normalized,
  }
}

async function refreshFileCandidates(term = query.value.trim()): Promise<void> {
  const paths = term
    ? await discoverWorkspaceFiles({ query: term, limit: 500 })
    : knownWorkspaceFiles(500)
  discoveredFiles.value = paths.map(toFileEntry)
}

let quickAccessRequestId = 0

async function refreshQuickAccessCandidates(term = query.value.trim()): Promise<void> {
  const requestId = ++quickAccessRequestId
  const result = await quickAccessController.provide(term)
  if (requestId !== quickAccessRequestId) return
  activeQuickAccessProvider.value = result.descriptor || null
  quickAccessResults.value = result.items
}

const flatFiles = computed<FileEntry[]>(() => discoveredFiles.value)

const placeholders = [
  '键入搜索命令 · :行号 · #符号 · >分类',
  '输入 :42 跳转到第 42 行',
  '输入 #name 搜索符号',
  '输入 >navigation 过滤命令类别',
]

const placeholderText = computed(() => placeholders[placeholderIndex.value])
const quickAccessSectionLabel = computed(() => activeQuickAccessProvider.value?.helpEntries?.[0]?.description || '快速访问')
const commandPaletteCommands = computed<CommandPaletteCommand[]>(() => {
  const contributed = new Map<string, CommandPaletteCommand>()
  for (const command of getCommands()) {
    contributed.set(command.id, {
      id: command.id,
      label: command.title,
      category: normalizeCategory(command.category),
      action: command.handler ? () => { void executeWorkbenchCommand(command.id) } : undefined,
    })
  }
  for (const entry of MenuRegistry.getMenuEntries(MenuId.CommandPalette)) {
    if (entry.type !== 'item') continue
    const command = contributed.get(entry.commandId)
    contributed.set(entry.commandId, {
      id: entry.commandId,
      label: entry.label,
      category: normalizeCategory(entry.category || command?.category),
      action: () => { void executeWorkbenchCommand(entry.commandId) },
    })
  }
  for (const command of registeredCommands.value) {
    contributed.set(command.id, command)
  }
  return [...contributed.values()]
})
const commandRegistry = commandPaletteCommands

let placeholderTimer: ReturnType<typeof setInterval> | null = null

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function saveRecent(): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds.value))
  } catch {
    // storage unavailable
  }
}

function pushRecent(id: string): void {
  recentIds.value = [id, ...recentIds.value.filter((i) => i !== id)].slice(0, MAX_RECENT)
  saveRecent()
}

const categoryFilter = computed<CommandCategory | ''>(() => {
  const q = query.value.trim()
  if (!q.startsWith('>')) return ''
  const filterText = q.slice(1).trim().toLowerCase()
  if (!filterText) return ''
  return CATEGORY_ALIASES[filterText] || ''
})

const searchTerms = computed<string[]>(() => {
  const q = query.value.trim()
  if (!q) return []
  if (q.startsWith('>')) {
    const afterPrefix = q.slice(1).trim()
    if (!afterPrefix) return []
    const alias = CATEGORY_ALIASES[afterPrefix.toLowerCase()]
    if (alias) return []
    return afterPrefix.split(/\s+/).filter(Boolean)
  }
  return q.split(/\s+/).filter(Boolean)
})

const filteredResults = computed<ScoredCommand[]>(() => {
  const terms = searchTerms.value
  const catFilter = categoryFilter.value
  if (!terms.length && !catFilter) return []

  let candidates = commandPaletteCommands.value
  if (catFilter) {
    candidates = candidates.filter((cmd) => cmd.category === catFilter)
  }

  if (!terms.length) {
    return candidates.map((cmd) => ({ cmd, score: 100, matchIndices: [] }))
  }

  const recentSet = new Set(recentIds.value)
  const scored = candidates
    .map((cmd) => {
      let score = 0
      let allIndices: number[] = []
      for (const term of terms) {
        const result = scoreCommandPaletteMatchWithHighlights({ id: cmd.id, title: cmd.label, category: cmd.category }, term)
        score += result.score
        allIndices = allIndices.concat(result.titleIndices)
      }
      if (recentSet.has(cmd.id)) score += 50
      return { cmd, score, matchIndices: [...new Set(allIndices)].sort((a, b) => a - b) }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored
})

const pinnedCommands = computed<CommandPaletteCommand[]>(() => {
  const map = new Map(commandPaletteCommands.value.map((c) => [c.id, c]))
  return PINNED_IDS.map((id) => map.get(id)).filter((c): c is CommandPaletteCommand => Boolean(c))
})

const recentCommands = computed<CommandPaletteCommand[]>(() => {
  if (!recentIds.value.length) return []
  const map = new Map(commandPaletteCommands.value.map((c) => [c.id, c]))
  return recentIds.value.map((id) => map.get(id)).filter((c): c is CommandPaletteCommand => Boolean(c))
})

const displayList = computed<CommandPaletteCommand[]>(() => {
  if (!query.value.trim()) {
    return [...pinnedCommands.value, ...recentCommands.value]
  }
  return filteredResults.value.map((item) => item.cmd)
})

function highlightMatch(label: string, indices: number[]): string {
  if (!indices.length) return escapeHtml(label)
  const set = new Set(indices)
  let result = ''
  for (let i = 0; i < label.length; i += 1) {
    const char = escapeHtml(label[i])
    result += set.has(i) ? `<span class="fuzzy-highlight">${char}</span>` : char
  }
  return result
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function open(mode?: 'files' | string): void {
  forcedMode.value = mode === 'files' ? 'files' : null
  visible.value = true
  query.value = mode && mode !== 'files' ? String(mode) : ''
  activeIndex.value = 0
  if (mode === 'files') void refreshFileCandidates()
  if (mode && mode !== 'files') void refreshQuickAccessCandidates(String(mode))
  nextTick(() => {
    inputRef.value?.focus()
  })
}

function close(): void {
  visible.value = false
  emit('close')
}

function execute(cmd: CommandPaletteCommand): void {
  pushRecent(cmd.id)
  close()
  cmd.action?.()
  emit('execute', cmd.id)
}

function normalizeCategory(category: string | undefined): CommandCategory {
  const normalized = category ? CATEGORY_ALIASES[category.toLowerCase()] : undefined
  if (normalized) return normalized
  if (category && Object.prototype.hasOwnProperty.call(CATEGORY_ORDER, category)) return category as CommandCategory
  return 'View'
}

async function acceptQuickAccessItem(item: QuickAccessItem): Promise<void> {
  if (!item.acceptInBackground) close()
  if (item.accept) {
    await item.accept()
    if (item.acceptInBackground) {
      activeIndex.value = 0
      await refreshQuickAccessCandidates()
    }
    return
  }
  if (item.commandId) {
    await executeWorkbenchCommand(item.commandId, item.args || [])
    if (item.acceptInBackground) {
      activeIndex.value = 0
      await refreshQuickAccessCandidates()
    }
  }
}

async function acceptQuickAccessButton(item: QuickAccessItem, buttonId: string): Promise<void> {
  const button = item.buttons?.find((candidate) => candidate.id === buttonId)
  if (!button?.accept) return
  if (!button.acceptInBackground) close()
  await button.accept()
}

function handleInput(): void {
  activeIndex.value = 0
  if (paletteMode.value === 'files') void refreshFileCandidates()
  if (paletteMode.value === 'quickAccess') void refreshQuickAccessCandidates()
}

const paletteMode = computed<'command' | 'goto' | 'symbol' | 'files' | 'quickAccess'>(() => {
  const q = query.value.trim()
  if (q.startsWith(':')) return 'goto'
  if (forcedMode.value === 'files') return 'files'
  if (q.startsWith('#') && !hasSymbolNavigationCommandHandoff()) return 'symbol'
  if (matchQuickAccessProvider(q)) return 'quickAccess'
  if (q.startsWith('#')) return 'symbol'
  return 'command'
})

const fileResults = computed<Array<{ file: FileEntry; score: number; indices: number[] }>>(() => {
  if (paletteMode.value !== 'files') return []
  const term = query.value.trim()
  if (!term) {
    return flatFiles.value.slice(0, 50).map((f) => ({ file: f, score: 0, indices: [] }))
  }
  return filterFileQuickAccess(flatFiles.value, term, 100)
})

function handleKeydown(e: KeyboardEvent): void {
  const max = paletteMode.value === 'files'
    ? fileResults.value.length
    : paletteMode.value === 'quickAccess'
      ? quickAccessResults.value.length
      : displayList.value.length

  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (max === 0) return
    activeIndex.value = (activeIndex.value + 1) % max
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (max === 0) return
    activeIndex.value = (activeIndex.value - 1 + max) % max
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    if (paletteMode.value === 'quickAccess') {
      const hit = quickAccessResults.value[activeIndex.value]
      if (hit) void acceptQuickAccessItem(hit)
      return
    }
    if (paletteMode.value === 'goto') {
      const lineNum = parseInt(query.value.slice(1).trim(), 10)
      if (lineNum > 0) {
        close()
        emit('gotoLine', lineNum)
      }
      return
    }
    if (paletteMode.value === 'symbol') {
      const symbolQuery = query.value.slice(1).trim()
      if (symbolQuery) {
        close()
        emit('symbolSearch', symbolQuery)
      }
      return
    }
    if (paletteMode.value === 'files') {
      const hit = fileResults.value[activeIndex.value]
      if (hit) {
        close()
        emit('openFile', hit.file.path)
      }
      return
    }
    const cmd = displayList.value[activeIndex.value]
    if (cmd) {
      execute(cmd)
    }
  }
}

function registerCommands(commands: CommandPaletteCommand[]): void {
  for (const cmd of commands) {
    const existingIndex = registeredCommands.value.findIndex((c) => c.id === cmd.id)
    if (existingIndex >= 0) {
      registeredCommands.value[existingIndex] = cmd
    } else {
      registeredCommands.value.push(cmd)
    }
  }
}

function executeCommand(id: string): void {
  const cmd = commandPaletteCommands.value.find((c) => c.id === id)
  if (cmd) {
    execute(cmd)
  }
}

onMounted(() => {
  placeholderTimer = setInterval(() => {
    placeholderIndex.value = (placeholderIndex.value + 1) % placeholders.length
  }, 3000)
})

onBeforeUnmount(() => {
  if (placeholderTimer) {
    clearInterval(placeholderTimer)
    placeholderTimer = null
  }
})

defineExpose({ open, close, visible, registerCommands, executeCommand, commandRegistry })
</script>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  justify-content: center;
  background: rgba(0, 0, 0, 0.52);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.palette-panel {
  position: absolute;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 600px);
  max-height: 420px;
  background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
  border: 1px solid var(--border-bright);
  border-radius: 14px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
}

.palette-search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.palette-search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.palette-search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 15px;
  font-family: var(--font-sans);
  outline: none;
  caret-color: var(--accent);
  transition: box-shadow 0.2s;
}

.palette-search-input::placeholder {
  color: var(--text-muted);
}

.palette-search-input:focus {
  box-shadow: 0 1px 0 var(--accent);
}

.palette-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}

.palette-results::-webkit-scrollbar {
  width: 6px;
}

.palette-results::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.palette-section-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 12px 4px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.08s, box-shadow 0.08s;
  height: 36px;
}

.palette-item:hover {
  background: var(--bg-hover);
}

.palette-item.active {
  background: color-mix(in srgb, var(--bg-hover) 70%, var(--bg-panel));
  box-shadow:
    inset 2px 0 0 #60a5fa,
    inset 0 0 0 1px rgba(96, 165, 250, 0.16);
}

.palette-item.active .palette-item-label {
  color: var(--text-bright);
}

.palette-item-icon {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  flex-shrink: 0;
  opacity: 0.35;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.palette-item-icon::after {
  content: '';
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 5px;
}

.pinned-icon {
  opacity: 1;
  color: var(--orange);
  font-size: 12px;
}

.pinned-icon::after {
  display: none;
}

.recent-icon {
  opacity: 1;
  color: var(--text-muted);
  font-size: 13px;
}

.recent-icon::after {
  display: none;
}

.palette-item-label {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-label :deep(.fuzzy-highlight) {
  color: var(--accent);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-skip-ink: none;
  text-underline-offset: 2px;
}

.palette-item-category {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 7px;
  border-radius: 4px;
  flex-shrink: 0;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.palette-item-button {
  flex-shrink: 0;
  min-width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.palette-item-button:hover {
  border-color: var(--border-bright);
  background: var(--bg-hover);
  color: var(--text-bright);
}

.palette-item-category.cat-file {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.palette-item-category.cat-edit {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
}

.palette-item-category.cat-view {
  background: rgba(45, 212, 191, 0.12);
  color: var(--accent);
}

.palette-item-category.cat-navigation {
  background: rgba(251, 146, 60, 0.12);
  color: var(--orange);
}

.palette-item-category.cat-ai {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.palette-item-category.cat-git {
  background: rgba(248, 113, 113, 0.12);
  color: var(--red);
}

.palette-item-shortcut {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.3px;
  flex-shrink: 0;
  min-width: 60px;
  text-align: right;
}

.palette-empty {
  padding: 20px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.palette-mode-hint {
  padding: 12px 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.palette-enter-active {
  transition: opacity 0.12s ease;
}

.palette-enter-active .palette-panel {
  transition: transform 0.15s ease, opacity 0.12s ease;
}

.palette-leave-active {
  transition: opacity 0.1s ease;
}

.palette-leave-active .palette-panel {
  transition: transform 0.1s ease, opacity 0.1s ease;
}

.palette-enter-from {
  opacity: 0;
}

.palette-enter-from .palette-panel {
  transform: translateX(-50%) scale(0.96);
  opacity: 0;
}

.palette-leave-to {
  opacity: 0;
}

.palette-leave-to .palette-panel {
  transform: translateX(-50%) scale(0.96);
  opacity: 0;
}
</style>
