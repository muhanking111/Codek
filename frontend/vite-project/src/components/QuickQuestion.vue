<template>
  <div
    v-if="visible"
    class="qq-overlay"
    @click.self="dismiss"
    @keydown.esc="dismiss"
  >
    <div class="qq-panel">
      <div class="qq-input-row">
        <input
          ref="qqInputRef"
          v-model="question"
          class="qq-input"
          :placeholder="t('quickQuestion.placeholder')"
          :disabled="loading"
          @keydown.enter.exact="askQuickQuestion"
        />
        <button
          class="qq-send-btn"
          :disabled="loading || !question.trim()"
          @click="askQuickQuestion"
          :title="t('chat.send')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
        <button class="qq-close-btn" @click="dismiss" :title="t('chat.close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div v-if="loading" class="qq-loading">
        <div class="qq-spinner"></div>
        <span>{{ t('quickQuestion.thinking') }}</span>
      </div>

      <div v-if="answer && !loading" class="qq-answer">
        <div class="qq-answer-content" v-html="renderedAnswer"></div>
        <div class="qq-answer-actions">
          <button class="qq-action-btn" @click="copyAnswer" :title="t('chat.copy')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button class="qq-action-btn" @click="openInChat" :title="t('quickQuestion.openInChat')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{{ t('quickQuestion.openInChat') }}</span>
          </button>
          <span v-if="copiedHint" class="qq-copied">{{ t('chat.copied') }}</span>
        </div>
      </div>

      <div v-if="!loading && !answer && history.length > 0" class="qq-history">
        <div
          v-for="(item, idx) in history"
          :key="idx"
          class="qq-history-item"
          @click="recallHistory(item)"
        >
          <div class="qq-history-q">{{ item.question }}</div>
          <div class="qq-history-a">{{ truncateAnswer(item.answer) }}</div>
        </div>
      </div>

      <div v-if="!loading && !answer && history.length === 0" class="qq-hint">
        {{ t('quickQuestion.hint') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useI18n } from "../i18n/index"
import { aiProviderState, getActiveProvider } from "../ai/aiProviders"
import { chatStream, readUnifiedStream } from "../ai/llmClient"

interface QaEntry {
  question: string
  answer: string
}

const { t } = useI18n()

const visible = ref(false)
const question = ref("")
const answer = ref("")
const loading = ref(false)
const copiedHint = ref(false)
const qqInputRef = ref<HTMLInputElement | null>(null)
const history = ref<QaEntry[]>([])

const HISTORY_MAX = 3

const emit = defineEmits<{
  close: []
  openInChat: [question: string, answer: string]
}>()

const renderedAnswer = computed(() => {
  // Escape ALL HTML first, then apply markdown-ish transforms on the escaped
  // string. Previous version only escaped inside fenced code blocks, leaving
  // inline text vulnerable to prompt-injected XSS like `<img onerror=...>`.
  const escaped = escapeHtml(answer.value)
  return escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      // `code` is already HTML-escaped from the outer escapeHtml; lang is constrained
      // to \w which is safe to interpolate into a class name.
      return `<pre><code class="lang-${lang}">${code}</code></pre>`
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>")
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function dismiss(): void {
  visible.value = false
  emit("close")
}

function openInChat(): void {
  emit("openInChat", question.value, answer.value)
  addToHistory(question.value, answer.value)
  resetState()
  visible.value = false
}

function addToHistory(q: string, a: string): void {
  const existing = history.value.filter((item) => item.question !== q)
  history.value = [{ question: q, answer: a }, ...existing].slice(0, HISTORY_MAX)
}

function recallHistory(item: QaEntry): void {
  question.value = item.question
  answer.value = item.answer
}

function truncateAnswer(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

async function copyAnswer(): Promise<void> {
  try {
    await navigator.clipboard.writeText(answer.value)
  } catch {
    // clipboard not available
  }
  copiedHint.value = true
  setTimeout(() => {
    copiedHint.value = false
  }, 1800)
}

function resetState(): void {
  question.value = ""
  answer.value = ""
  loading.value = false
}

async function askQuickQuestion(): Promise<void> {
  const text = question.value.trim()
  if (!text || loading.value) return

  loading.value = true
  answer.value = ""

  const provider = getActiveProvider()
  const model = aiProviderState.activeModel || provider.models[0]

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: "You are a helpful expert coding assistant. Answer concisely with relevant code examples when appropriate. Use markdown code blocks with language hints." },
    { role: "user", content: text },
  ]

  try {
    const response = await chatStream({
      provider,
      model,
      messages,
      stream: true,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Request failed with status ${response.status}.`)
    }

    await readUnifiedStream(response.body, (content) => {
      answer.value = content
    })

    addToHistory(text, answer.value)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    answer.value = `**Error**: ${message}`
  } finally {
    loading.value = false
  }
}

watch(visible, (val) => {
  if (val) {
    nextTick(() => {
      qqInputRef.value?.focus()
    })
  }
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    dismiss()
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown)
})
</script>

<style scoped>
.qq-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(4px);
}

.qq-panel {
  width: 540px;
  max-width: 92vw;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.qq-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.qq-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  padding: 6px 0;
  outline: none;
  font-family: inherit;
}

.qq-input::placeholder {
  color: var(--text-muted);
}

.qq-input:disabled {
  opacity: 0.5;
}

.qq-send-btn {
  width: 32px;
  height: 32px;
  background: var(--accent);
  border: none;
  border-radius: 9px;
  color: #0d0e10;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.qq-send-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.qq-send-btn:disabled {
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: not-allowed;
}

.qq-close-btn {
  width: 32px;
  height: 32px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s, border-color 0.15s;
}

.qq-close-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.qq-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  color: var(--text-muted);
  font-size: 13px;
}

.qq-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-bright);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: qq-spin 0.6s linear infinite;
}

@keyframes qq-spin {
  to { transform: rotate(360deg); }
}

.qq-answer {
  padding: 14px 18px;
  overflow-y: auto;
  max-height: 45vh;
}

.qq-answer-content {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-primary);
}

.qq-answer-content :deep(pre) {
  background: var(--bg-deepest);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
  margin: 8px 0;
}

.qq-answer-content :deep(code) {
  background: var(--bg-elevated);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  color: #f472b6;
}

.qq-answer-content :deep(pre code) {
  background: none;
  padding: 0;
  color: var(--text-primary);
}

.qq-answer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.qq-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  padding: 5px 10px;
  transition: color 0.15s, border-color 0.15s;
}

.qq-action-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.qq-copied {
  font-size: 11px;
  color: var(--accent);
  margin-left: 4px;
}

.qq-history {
  padding: 8px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.qq-history-item {
  background: var(--bg-dark);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.qq-history-item:hover {
  border-color: var(--border-bright);
  background: var(--bg-elevated);
}

.qq-history-q {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.qq-history-a {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qq-hint {
  padding: 20px 18px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
