<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="cdk-overlay"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="title ? titleId : undefined"
      :aria-label="title ? undefined : 'Codek'"
      @click.self="onBackdrop"
      @keydown.esc="onEsc"
    >
      <div
        ref="panelRef"
        class="cdk-panel"
        :style="{ maxWidth: width }"
        tabindex="-1"
      >
        <!-- Header -->
        <header v-if="$slots.header || title" class="cdk-header">
          <slot name="header">
            <h2 :id="titleId" class="cdk-title">{{ title }}</h2>
          </slot>
        </header>

        <!-- Body -->
        <div class="cdk-body">
          <slot />
        </div>

        <!-- Footer -->
        <footer v-if="!noFooter && $slots.footer" class="cdk-footer">
          <slot name="footer" />
        </footer>
        <div v-if="loading" class="cdk-loading" aria-live="polite">
          <span class="cdk-spinner" />
          <span>处理中...</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue"

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    width?: string
    loading?: boolean
    noFooter?: boolean
    closeOnBackdrop?: boolean
  }>(),
  {
    title: "",
    width: "min(540px, 94vw)",
    loading: false,
    noFooter: false,
    closeOnBackdrop: true,
  },
)

const emit = defineEmits<{
  close: []
}>()

const titleId = `codek-dialog-title-${Math.random().toString(36).slice(2)}`
const panelRef = ref<HTMLElement | null>(null)
let previousActiveElement: HTMLElement | null = null

// ── ESC ──
function onEsc() {
  emit("close")
}

function onBackdrop() {
  if (props.closeOnBackdrop) emit("close")
}

// ── Focus trap (basic: 循环在 dialog 内) ──
function trapFocus(e: KeyboardEvent) {
  if (e.key !== "Tab") return
  const focusable = getFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

// ── lifecycle ──
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") onEsc()
  trapFocus(e)
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      previousActiveElement = document.activeElement as HTMLElement | null
      document.addEventListener("keydown", onKeyDown)
      await nextTick()
      const firstFocusable = getFocusable()[0]
      ;(firstFocusable ?? panelRef.value)?.focus()
    } else {
      document.removeEventListener("keydown", onKeyDown)
      if (previousActiveElement && typeof previousActiveElement.focus === "function") {
        previousActiveElement.focus()
      }
      previousActiveElement = null
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeyDown)
})

function getFocusable(): HTMLElement[] {
  if (!panelRef.value) return []
  return Array.from(panelRef.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ))
}
</script>

<style scoped>
/* ── Overlay ── */
.cdk-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: cdk-fade-in 100ms ease-out;
  padding: 24px;
}

/* ── Panel ── */
.cdk-panel {
  position: relative;
  background: var(--bg-panel);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  outline: none;
  animation: cdk-panel-in 150ms ease-out;
  font-family: var(--font-sans);
  overflow: hidden;
}

/* ── Header ── */
.cdk-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.cdk-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
  line-height: 1.4;
}

/* ── Body ── */
.cdk-body {
  padding: 14px 20px;
  overflow-y: auto;
  flex: 1 1 auto;
}

/* ── Footer ── */
.cdk-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.cdk-loading {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-bright);
  font-size: 13px;
}

.cdk-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, var(--text-muted) 45%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cdk-spin 750ms linear infinite;
}

/* ── Animations ── */
@keyframes cdk-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes cdk-panel-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes cdk-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .cdk-overlay,
  .cdk-panel {
    animation: none;
  }
}
</style>
