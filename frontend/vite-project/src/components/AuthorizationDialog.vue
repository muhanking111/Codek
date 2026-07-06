<template>
  <CodekDialog
    :visible="!!current"
    :title="t('toolAuth.title')"
    width="min(580px, 94vw)"
    @close="deny"
  >
    <template #default>
      <p class="auth-hint">{{ t("toolAuth.subtitle") }}</p>

      <div class="auth-row">
        <span class="auth-label">{{ t("toolAuth.toolLabel") }}</span>
        <code class="auth-tool-name">{{ current?.tool }}</code>
      </div>

      <div v-if="current?.preview" class="auth-row">
        <span class="auth-label">{{ t("toolAuth.previewLabel") }}</span>
        <div class="auth-preview">{{ current.preview }}</div>
      </div>

      <!-- edit_file → line diff -->
      <div v-if="diffView?.type === 'edit'" class="auth-row">
        <span class="auth-label">{{ t("toolAuth.diffLabel") || "Diff" }}</span>
        <div class="auth-diff">
          <div class="diff-block diff-removed">
            <span class="diff-gutter">−</span>
            <pre class="diff-text">{{ diffView.before }}</pre>
          </div>
          <div class="diff-block diff-added">
            <span class="diff-gutter">+</span>
            <pre class="diff-text">{{ diffView.after }}</pre>
          </div>
        </div>
      </div>

      <!-- write_file → content preview -->
      <div v-else-if="diffView?.type === 'write'" class="auth-row">
        <span class="auth-label">{{ (t("toolAuth.writeLabel") || "Write") + ' → ' + diffView.path }}</span>
        <div class="auth-diff">
          <div class="diff-block diff-added">
            <span class="diff-gutter">+</span>
            <pre class="diff-text">{{ diffView.content }}{{ diffView.truncated ? '\n…' : '' }}</pre>
          </div>
        </div>
      </div>

      <!-- run_shell → command -->
      <div v-else-if="diffView?.type === 'shell'" class="auth-row">
        <span class="auth-label">{{ t("toolAuth.commandLabel") || "Command" }}</span>
        <pre class="auth-shell">$ {{ diffView.command }}</pre>
      </div>

      <!-- fallback → raw input -->
      <div v-else class="auth-row">
        <span class="auth-label">{{ t("toolAuth.inputLabel") }}</span>
        <pre class="auth-input">{{ formattedInput }}</pre>
      </div>

      <div v-if="queueLength > 1" class="auth-pending">
        {{ pendingText }}
      </div>
    </template>

    <template #footer>
      <button class="cdk-btn cdk-btn-secondary" @click="deny">
        {{ t("toolAuth.deny") }}
      </button>
      <button class="cdk-btn cdk-btn-secondary" @click="allowAlways">
        {{ t("toolAuth.allowAlways") }}
      </button>
      <button class="cdk-btn cdk-btn-primary" @click="allowOnce">
        {{ t("toolAuth.allowOnce") }}
      </button>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useI18n } from "../i18n/index"
import {
  resolveAuthRequest,
  subscribeToAuthRequests,
  type AuthRequestPayload,
} from "../ai/tools"
import CodekDialog from "./CodekDialog.vue"

const { t } = useI18n()

const queue = ref<AuthRequestPayload[]>([])
const current = computed<AuthRequestPayload | null>(() => queue.value[0] ?? null)
const queueLength = computed(() => queue.value.length)

const formattedInput = computed(() => {
  const payload = current.value
  if (!payload) return ""
  try { return JSON.stringify(payload.input ?? {}, null, 2) } catch { return String(payload.input ?? "") }
})

const WRITE_PREVIEW_LINES = 40

type DiffView =
  | { type: "edit"; before: string; after: string }
  | { type: "write"; path: string; content: string; truncated: boolean }
  | { type: "shell"; command: string }
  | null

const diffView = computed<DiffView>(() => {
  const payload = current.value
  if (!payload) return null
  const input = (payload.input ?? {}) as Record<string, unknown>
  switch (payload.tool) {
    case "edit_file": return { type: "edit", before: String(input.old_string ?? ""), after: String(input.new_string ?? "") }
    case "write_file": {
      const full = String(input.content ?? "")
      const lines = full.split("\n")
      const truncated = lines.length > WRITE_PREVIEW_LINES
      return { type: "write", path: String(input.path ?? ""), content: truncated ? lines.slice(0, WRITE_PREVIEW_LINES).join("\n") : full, truncated }
    }
    case "run_shell": return { type: "shell", command: String(input.command ?? "") }
    default: return null
  }
})

const pendingText = computed(() => {
  const remaining = Math.max(queueLength.value - 1, 0)
  return t("toolAuth.pendingCount").replace("{count}", String(remaining))
})

let unsubscribe: (() => void) | null = null

onMounted(() => { unsubscribe = subscribeToAuthRequests((p) => { queue.value = [...queue.value, p] }) })
onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
  for (const p of queue.value) resolveAuthRequest(p.requestId, false, false)
  queue.value = []
})

function consume() { const h = queue.value[0]; if (h) queue.value = queue.value.slice(1); return h ?? null }
function allowOnce() { const h = consume(); if (h) resolveAuthRequest(h.requestId, true, false) }
function allowAlways() { const h = consume(); if (h) resolveAuthRequest(h.requestId, true, true) }
function deny() { const h = consume(); if (h) resolveAuthRequest(h.requestId, false, false) }
</script>

<style scoped>
.auth-hint { margin: 0 0 8px; font-size: 12px; opacity: 0.65; line-height: 1.5; }
.auth-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.auth-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.5; }
.auth-tool-name {
  font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
  font-size: 13px; background: var(--bg-dark); padding: 4px 8px; border-radius: 8px; width: max-content;
}
.auth-preview { font-size: 12px; background: var(--bg-dark); padding: 6px 10px; border-radius: 8px; line-height: 1.4; word-break: break-word; }
.auth-input {
  font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace; font-size: 12px;
  background: var(--bg-deepest); padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--border); margin: 0; max-height: 240px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
}
.auth-diff { display: flex; flex-direction: column; gap: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); max-height: 320px; overflow-y: auto; }
.diff-block { display: flex; align-items: stretch; font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace; font-size: 12px; line-height: 1.45; }
.diff-gutter { width: 22px; flex: 0 0 auto; text-align: center; font-weight: 600; padding-top: 6px; user-select: none; opacity: 0.7; }
.diff-text { margin: 0; padding: 6px 10px; flex: 1 1 auto; white-space: pre-wrap; word-break: break-word; background: transparent; }
.diff-removed { background: rgba(220, 60, 60, 0.14); color: #ffbaba; }
.diff-added   { background: rgba(70, 200, 110, 0.14); color: #b8efc8; }
.auth-shell {
  font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace; font-size: 12px;
  background: var(--bg-deepest); color: var(--text-primary);
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
  margin: 0; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto;
}
.auth-pending { font-size: 11px; opacity: 0.5; text-align: right; }
</style>
