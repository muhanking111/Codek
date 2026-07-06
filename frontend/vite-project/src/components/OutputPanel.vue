<template>
  <div
    v-if="visible"
    class="output-panel"
    data-codek-smoke="output-panel"
    :data-output-owner="ownerEvidence.owner"
    :data-output-renderer-owner="ownerEvidence.rendererOwner"
    :data-output-main-thread-owner="ownerEvidence.mainThreadOwner"
    :data-output-state-source="ownerEvidence.stateSource"
    :data-output-ui-owner-state="ownerEvidence.uiOwnerState"
    :data-output-evidence-state="ownerEvidence.evidenceState"
    :data-output-remaining-gap="ownerEvidence.remainingGap"
    :data-output-channel-count="ownerEvidence.channelCount"
  >
    <div class="output-toolbar">
      <div class="channel-tabs">
        <button
          v-for="name in channelNames"
          :key="name"
          class="channel-tab"
          :class="{ active: activeChannel === name }"
          @click="activeChannel = name"
        >
          {{ name }}
        </button>
      </div>
      <div class="toolbar-actions">
        <button class="toolbar-btn" :title="t('output.clear')" @click="handleClear">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
        <button class="toolbar-btn" :title="t('output.copy')" @click="handleCopy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button class="toolbar-btn" :title="t('output.close')" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div
      ref="scrollContainer"
      class="output-content"
      data-codek-smoke="output-content"
      :data-output-service-source="'outputLogTelemetryService'"
      :data-output-active-channel="activeChannel"
      :data-output-entry-count="entries.length"
      :data-output-preview="outputPreview"
      @scroll="handleScroll"
    >
      <div v-if="entries.length === 0" class="output-empty">{{ t('output.empty') }}</div>
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="output-line"
        :class="entry.level"
      >
        <span class="line-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="line-text">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../i18n/index'
import { getOutputChannel, getAllChannelNames, getChannel, type LogEntry } from '../utils/outputChannel'
import { globalOutputLogTelemetryService } from '../workbench/outputLogTelemetryService'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const DEFAULT_CHANNELS = ['LSP', 'Extensions', 'Diagnostics']

for (const name of DEFAULT_CHANNELS) {
  getOutputChannel(name)
}

const activeChannel = ref('LSP')
const entries = ref<LogEntry[]>([])
const scrollContainer = ref<HTMLElement | null>(null)
let autoScroll = true
let unsubscribeService: (() => void) | null = null

const channelNames = computed<string[]>(() => {
  const names = getAllChannelNames()
  return names.length > 0 ? names : DEFAULT_CHANNELS
})

const outputPreview = computed(() => entries.value.map((entry) => entry.message).join('').slice(0, 2000))
const ownerEvidence = computed(() => globalOutputLogTelemetryService.getOwnerEvidence(activeChannel.value))

let unsubscribe: (() => void) | null = null

function subscribeToChannel(name: string): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }

  const channel = getChannel(name)
  if (!channel) {
    entries.value = []
    return
  }

  unsubscribe = channel.subscribe((items: LogEntry[]) => {
    entries.value = items
    if (autoScroll) {
      void nextTick(scrollToBottom)
    }
  })
}

watch(activeChannel, (name) => {
  subscribeToChannel(name)
}, { immediate: true })

watch(channelNames, (names) => {
  if (names.length > 0 && !names.includes(activeChannel.value)) {
    activeChannel.value = globalOutputLogTelemetryService.getActiveChannelName()
  }
})

function syncActiveChannelFromService(): void {
  const serviceActiveChannel = globalOutputLogTelemetryService.getActiveChannelName()
  if (serviceActiveChannel && serviceActiveChannel !== activeChannel.value) {
    activeChannel.value = serviceActiveChannel
  } else {
    subscribeToChannel(activeChannel.value)
  }
}

unsubscribeService = globalOutputLogTelemetryService.onDidChange(syncActiveChannelFromService)

function scrollToBottom(): void {
  const el = scrollContainer.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function handleScroll(): void {
  const el = scrollContainer.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  autoScroll = distanceFromBottom < 40
}

function handleClear(): void {
  const channel = getChannel(activeChannel.value)
  channel?.clear()
}

function handleCopy(): void {
  const text = entries.value.map((e) => e.message).join('')
  navigator.clipboard.writeText(text).catch(() => {})
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
  if (unsubscribeService) unsubscribeService()
})
</script>

<style scoped>
.output-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  font-family: var(--font-sans);
}

.output-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  height: 32px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.channel-tabs {
  display: flex;
  gap: 1px;
  overflow-x: auto;
}

.channel-tabs::-webkit-scrollbar {
  height: 0;
}

.channel-tab {
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
  font-family: var(--font-sans);
}

.channel-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.channel-tab.active {
  color: var(--accent);
  background: var(--accent-dim);
}

.toolbar-actions {
  display: flex;
  gap: 2px;
}

.toolbar-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.output-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.output-empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  font-family: var(--font-sans);
}

.output-line {
  display: flex;
  padding: 0 10px;
  gap: 8px;
}

.output-line:hover {
  background: var(--bg-hover);
}

.line-time {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
  opacity: 0.6;
  user-select: none;
  padding-top: 1px;
}

.line-text {
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.output-line.warn .line-text {
  color: var(--orange);
}

.output-line.error .line-text {
  color: var(--red);
}
</style>
