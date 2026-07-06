<template>
  <div v-if="visible" class="visual-editor">
    <div class="ve-header">
      <span class="ve-title">{{ t("visualEditor.title") }}</span>
      <div class="ve-actions">
        <input
          v-model="urlInput"
          class="ve-url-input"
          placeholder="http://localhost:5173"
          @keydown.enter="navigateToUrl"
        />
        <button class="ve-btn" @click="refresh" :title="t('visualEditor.refresh')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button
          class="ve-btn"
          @click="toggleDevServer"
          :title="devRunning ? t('visualEditor.stopDevServer') : t('visualEditor.startDevServer')"
        >
          <svg
            v-if="!devRunning"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
        <button class="ve-btn" @click="openExternal" :title="t('visualEditor.openExternal')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
        <button class="ve-btn ve-close" @click="$emit('close')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    <div class="ve-devices">
      <button
        v-for="d in devices"
        :key="d.id"
        class="ve-device-btn"
        :class="{ active: activeDevice === d.id }"
        @click="activeDevice = d.id"
        :title="`${d.label} (${d.width}px)`"
      >
        {{ d.label }}
      </button>
      <span class="ve-status" v-if="devRunning"
        >● {{ t("visualEditor.devRunning") }}:{{ devPort }}</span
      >
      <span class="ve-status ve-status-off" v-else>● {{ t("visualEditor.devStopped") }}</span>
    </div>
    <div class="ve-body">
      <div v-if="currentUrl" class="ve-frame-wrap" :style="frameWrapStyle">
        <iframe
          ref="frameRef"
          :src="previewProjection?.src || currentUrl"
          class="ve-frame"
          :sandbox="previewProjection?.sandbox || defaultPreviewSandbox"
          :allow="previewProjection?.allow || defaultPreviewAllow"
        ></iframe>
      </div>
      <div v-else class="ve-empty">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          stroke-width="1.5"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p>{{ t("visualEditor.enterUrl") }}</p>
        <button class="ve-start-btn" @click="startDevServer">
          {{ t("visualEditor.startDevServer") }}
        </button>
      </div>
      <aside v-if="inspected" class="ve-inspector">
        <div class="ve-insp-head">
          <span class="ve-insp-tag">&lt;{{ inspected.tag }}&gt;</span>
          <span v-if="inspected.classes" class="ve-insp-cls">.{{ inspected.classes }}</span>
          <button
            class="ve-btn ve-close"
            @click="inspected = null"
            :title="t('visualEditor.closeInspector')"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div v-if="inspected.file" class="ve-insp-src">
          <a href="#" @click.prevent="openInspectedSource"
            >{{ inspected.file }}:{{ inspected.line || 1 }}</a
          >
        </div>
        <div class="ve-insp-props">
          <div v-for="(val, key) in editableStyles" :key="key" class="ve-prop">
            <label class="ve-prop-key">{{ key }}</label>
            <input
              class="ve-prop-val"
              :value="val"
              @change="updateStyle(String(key), ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="ve-prop ve-prop-new">
            <input
              v-model="newPropKey"
              class="ve-prop-key-input"
              :placeholder="t('visualEditor.propertyPlaceholder')"
              @keydown.enter="addNewProp"
            />
            <input
              v-model="newPropVal"
              class="ve-prop-val"
              :placeholder="t('visualEditor.valuePlaceholder')"
              @keydown.enter="addNewProp"
            />
          </div>
        </div>
        <div class="ve-insp-actions">
          <button class="ve-start-btn" :disabled="!hasPendingEdits" @click="saveStylesToSource">
            {{ t("visualEditor.saveToSource") }}
          </button>
          <button class="ve-btn-secondary" @click="resetEdits" :disabled="!hasPendingEdits">
            {{ t("visualEditor.resetEdits") }}
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue"
import { useI18n } from "../i18n/index"
import {
  globalWebviewCustomEditorPreviewService,
  type Disposable,
  type LegacyIframeProjection,
  type WebviewMessage,
  type WebviewPanelModel,
} from "../workbench/webviewCustomEditorPreviewService"

const { t } = useI18n()

const props = defineProps<{ visible: boolean; projectRoot?: string }>()
const emit = defineEmits<{
  close: []
  openSource: [payload: { file: string; line: number }]
  requestAiEdit: [payload: { prompt: string; file?: string; line?: number }]
}>()

interface InspectedElement {
  tag: string
  classes?: string
  selector?: string
  styles: Record<string, string>
  file?: string
  line?: number
}

const inspected = ref<InspectedElement | null>(null)
const editedStyles = ref<Record<string, string>>({})
const newPropKey = ref("")
const newPropVal = ref("")

const editableStyles = computed<Record<string, string>>(() => {
  if (!inspected.value) return {}
  return { ...inspected.value.styles, ...editedStyles.value }
})

const hasPendingEdits = computed(() => Object.keys(editedStyles.value).length > 0)

function updateStyle(key: string, value: string): void {
  if (!inspected.value) return
  editedStyles.value = { ...editedStyles.value, [key]: value }
  postStyleUpdate(inspected.value.selector, key, value)
}

function addNewProp(): void {
  const key = newPropKey.value.trim()
  const val = newPropVal.value.trim()
  if (!key || !val) return
  updateStyle(key, val)
  newPropKey.value = ""
  newPropVal.value = ""
}

function resetEdits(): void {
  editedStyles.value = {}
  if (inspected.value?.selector) {
    postStyleUpdate(inspected.value.selector, "__reset__", "")
  }
}

function postStyleUpdate(selector: string | undefined, prop: string, value: string): void {
  if (!selector) return
  ensurePreviewPanel()
  projectPreviewFrame()
  globalWebviewCustomEditorPreviewService.postToLegacyIframe(PREVIEW_PANEL_ID, {
    type: "codek-style-update",
    selector,
    prop,
    value,
  })
}

function openInspectedSource(): void {
  if (!inspected.value?.file) return
  emit("openSource", { file: inspected.value.file, line: inspected.value.line || 1 })
}

function saveStylesToSource(): void {
  if (!inspected.value || !hasPendingEdits.value) return
  const edits = Object.entries(editedStyles.value)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")
  const target = inspected.value.selector
    ? `selector "${inspected.value.selector}"`
    : `<${inspected.value.tag}>`
  const fileHint = inspected.value.file ? ` in ${inspected.value.file}` : ""
  const prompt = `Update the styles for ${target}${fileHint} to match these CSS declarations:\n${edits}\n\nLocate the relevant style block (component <style>, CSS module, or stylesheet) and apply the changes. Preserve other properties.`
  emit("requestAiEdit", {
    prompt,
    file: inspected.value.file,
    line: inspected.value.line,
  })
  editedStyles.value = {}
}

const urlInput = ref("")
const currentUrl = ref("")
const frameRef = ref<HTMLIFrameElement | null>(null)
const previewProjection = ref<LegacyIframeProjection | null>(null)
const devRunning = ref(false)
const devPort = ref<number | null>(null)
const PREVIEW_PANEL_ID = "visualEditor.preview"
const defaultPreviewSandbox = "allow-scripts allow-same-origin allow-forms allow-popups"
const defaultPreviewAllow = "clipboard-read; clipboard-write"
let previewMessageDisposable: Disposable | null = null

const devices = [
  { id: "desktop", label: t("visualEditor.deviceDesktop"), width: 0 },
  { id: "tablet", label: t("visualEditor.deviceTablet"), width: 768 },
  { id: "mobile", label: t("visualEditor.deviceMobile"), width: 390 },
]
const activeDevice = ref("desktop")

const frameWrapStyle = computed(() => {
  const d = devices.find((x) => x.id === activeDevice.value)
  if (!d || d.width === 0) return { width: "100%", height: "100%" }
  return {
    width: `${d.width}px`,
    height: "100%",
    margin: "0 auto",
    boxShadow: "0 0 0 1px var(--border)",
  }
})

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return window.codek!.api(method, path, body) as Promise<T>
}

async function pollStatus(): Promise<void> {
  try {
    const r = await api<{ running: boolean; port: number | null }>("GET", "/api/dev-server/status")
    devRunning.value = !!r?.running
    devPort.value = r?.port ?? null
    if (r?.running && r.port && !currentUrl.value) {
      const url = `http://localhost:${r.port}`
      urlInput.value = url
      setPreviewUrl(url)
    }
  } catch {
    devRunning.value = false
  }
}

async function startDevServer(): Promise<void> {
  const projectRoot = props.projectRoot || ""
  if (!projectRoot) return
  try {
    const r = await api<{ success: boolean; port: number }>("POST", "/api/dev-server/start", {
      projectRoot,
    })
    if (r?.success) {
      devRunning.value = true
      devPort.value = r.port
      const url = `http://localhost:${r.port}`
      urlInput.value = url
      setTimeout(() => {
        setPreviewUrl(url)
      }, 800)
    }
  } catch (e) {
    console.warn("[visual-editor] start failed", e)
  }
}

async function stopDevServer(): Promise<void> {
  await api("POST", "/api/dev-server/stop", {})
  devRunning.value = false
  currentUrl.value = ""
  previewProjection.value = null
  globalWebviewCustomEditorPreviewService.hidePanel(PREVIEW_PANEL_ID)
}

function toggleDevServer(): void {
  if (devRunning.value) stopDevServer()
  else startDevServer()
}

function navigateToUrl(): void {
  let url = urlInput.value.trim()
  if (!url) return
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url
  setPreviewUrl(url)
}

function refresh(): void {
  if (!currentUrl.value) return
  const url = currentUrl.value
  currentUrl.value = ""
  previewProjection.value = null
  setTimeout(() => {
    setPreviewUrl(url)
  }, 100)
}

function openExternal(): void {
  if (currentUrl.value && window.codek?.openExternal) window.codek.openExternal(currentUrl.value)
}

function onMessage(e: MessageEvent): void {
  ensurePreviewPanel()
  if (globalWebviewCustomEditorPreviewService.postFromLegacyIframe(PREVIEW_PANEL_ID, e.data)) return
  handlePreviewMessage({ type: "", payload: e.data })
}

function handlePreviewMessage(message: WebviewMessage): void {
  const data = toLegacyPreviewPayload(message)
  if (!data || typeof data !== "object") return
  if (data.type === "codek-click" && typeof data.file === "string") {
    const line = typeof data.line === "number" ? data.line : 1
    emit("openSource", { file: data.file, line })
  }
  if (data.type === "codek-inspect" && typeof data.tag === "string") {
    inspected.value = {
      tag: data.tag,
      classes: typeof data.classes === "string" ? data.classes : undefined,
      selector: typeof data.selector === "string" ? data.selector : undefined,
      styles: normalizePreviewStyles(data.styles),
      file: typeof data.file === "string" ? data.file : undefined,
      line: typeof data.line === "number" ? data.line : undefined,
    }
    editedStyles.value = {}
  }
}

function toLegacyPreviewPayload(message: WebviewMessage): Record<string, unknown> | null {
  if (message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)) {
    return { type: message.type, ...(message.payload as Record<string, unknown>) }
  }
  if (message.type && message.payload === undefined) return { type: message.type }
  return null
}

function normalizePreviewStyles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const styles: Record<string, string> = {}
  for (const [key, styleValue] of Object.entries(value)) {
    if (typeof styleValue === "string") styles[key] = styleValue
  }
  return styles
}

let statusTimer: ReturnType<typeof setInterval> | null = null

function setPreviewUrl(url: string): void {
  currentUrl.value = url
  const panel = ensurePreviewPanel(url)
  previewProjection.value = panel?.projection
    ? {
        src: panel.projection.src,
        sandbox: panel.projection.sandbox,
        allow: panel.projection.allow,
      }
    : null
  void nextTick(projectPreviewFrame)
}

function ensurePreviewPanel(url = currentUrl.value): WebviewPanelModel | null {
  if (!url) return null
  const panel = globalWebviewCustomEditorPreviewService.openOrRevivePreview(PREVIEW_PANEL_ID, {
    viewType: "codek.visualEditor.preview",
    title: t("visualEditor.title"),
    url,
    owner: "visualEditor",
  })
  if (!previewMessageDisposable) {
    previewMessageDisposable = panel.channel.onDidReceiveFromWebview(handlePreviewMessage)
  }
  return panel
}

function projectPreviewFrame(): void {
  const panel = ensurePreviewPanel()
  if (!panel) return
  const projection = globalWebviewCustomEditorPreviewService.projectPanelForIframe(
    panel.id,
    frameRef.value?.contentWindow,
  )
  if (projection) previewProjection.value = projection
}

onMounted(() => {
  window.addEventListener("message", onMessage)
  pollStatus()
  statusTimer = setInterval(pollStatus, 3000)
})

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage)
  if (statusTimer) clearInterval(statusTimer)
  previewMessageDisposable?.dispose()
  previewMessageDisposable = null
  globalWebviewCustomEditorPreviewService.hidePanel(PREVIEW_PANEL_ID)
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      pollStatus()
      projectPreviewFrame()
    } else {
      globalWebviewCustomEditorPreviewService.hidePanel(PREVIEW_PANEL_ID)
    }
  },
)

watch(frameRef, () => projectPreviewFrame())
</script>

<style scoped>
.visual-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
}
.ve-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ve-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}
.ve-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}
.ve-url-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}
.ve-url-input:focus {
  border-color: var(--accent);
}
.ve-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.12s;
}
.ve-btn:hover {
  background: var(--bg-hover);
}
.ve-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.ve-devices {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.ve-device-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
}
.ve-device-btn.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.ve-status {
  margin-left: auto;
  color: #22c55e;
  font-size: 10px;
}
.ve-status-off {
  color: var(--text-muted);
}
.ve-body {
  flex: 1;
  overflow: auto;
  background: var(--bg-base);
  display: flex;
  min-height: 0;
}
.ve-frame-wrap {
  background: white;
  flex: 1;
  min-width: 0;
}
.ve-inspector {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ve-insp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.ve-insp-tag {
  color: var(--accent);
  font-weight: 600;
}
.ve-insp-cls {
  color: var(--text-muted);
  font-size: 11px;
}
.ve-insp-head .ve-close {
  margin-left: auto;
}
.ve-insp-src {
  padding: 4px 10px;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.ve-insp-src a {
  color: var(--accent);
  text-decoration: none;
}
.ve-insp-src a:hover {
  text-decoration: underline;
}
.ve-insp-props {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ve-prop {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 4px;
  align-items: center;
}
.ve-prop-key {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ve-prop-val,
.ve-prop-key-input {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 11px;
  font-family: monospace;
  outline: none;
  min-width: 0;
}
.ve-prop-val:focus,
.ve-prop-key-input:focus {
  border-color: var(--accent);
}
.ve-prop-new {
  border-top: 1px dashed var(--border);
  padding-top: 6px;
  margin-top: 4px;
}
.ve-insp-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.ve-insp-actions .ve-start-btn {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
}
.ve-insp-actions .ve-start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ve-btn-secondary {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
}
.ve-btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ve-frame {
  width: 100%;
  height: 100%;
  border: none;
}
.ve-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted);
}
.ve-empty p {
  font-size: 13px;
  margin: 0;
}
.ve-start-btn {
  padding: 6px 14px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.ve-start-btn:hover {
  opacity: 0.9;
}
</style>
