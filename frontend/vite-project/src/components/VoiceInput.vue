<template>
  <div class="voice-input" :class="{ listening }">
    <button
      class="voice-btn"
      :class="{ active: listening, supported: supported }"
      :disabled="!supported"
      :title="t('voiceInput.title')"
      @click="toggle"
    >
      <svg v-if="!listening" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
    </button>
    <div v-if="transcript" class="voice-transcript">{{ transcript }}</div>
    <div v-if="error" class="voice-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue"
import { useI18n } from "../i18n/index"

const { t } = useI18n()
const emit = defineEmits<{ text: [value: string] }>()

const supported = ref(false)
const listening = ref(false)
const transcript = ref("")
const error = ref("")

let recognition: SpeechRecognition | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null

function init() {
  const SpeechRecognitionAPI = (window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }).SpeechRecognition || (window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }).webkitSpeechRecognition

  if (!SpeechRecognitionAPI) {
    supported.value = false
    return
  }

  supported.value = true
  const sr = new SpeechRecognitionAPI()
  sr.continuous = true
  sr.interimResults = true
  sr.lang = "zh-CN"

  sr.onresult = (event: SpeechRecognitionEvent) => {
    let finalText = ""
    for (let i = event.resultIndex; i < event.results.length; i++) {
      finalText += event.results[i][0].transcript
    }
    transcript.value = finalText
  }

  sr.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === "no-speech") {
      // Silently restart if no speech detected
      restartTimer = setTimeout(() => {
        if (listening.value) {
          try { sr.start() } catch {}
        }
      }, 500)
      return
    }
    error.value = `语音识别错误：${event.error}`
    listening.value = false
  }

  sr.onend = () => {
    if (listening.value) {
      // Auto-restart for continuous listening
      restartTimer = setTimeout(() => {
        if (listening.value) {
          try { sr.start() } catch {}
        }
      }, 200)
    }
  }

  recognition = sr
}

function toggle() {
  if (!recognition) init()
  if (!recognition) return

  if (listening.value) {
    stop()
  } else {
    start()
  }
}

function start() {
  error.value = ""
  transcript.value = ""
  listening.value = true
  try {
    recognition?.start()
  } catch {
    // already started
  }
}

function stop() {
  listening.value = false
  if (restartTimer) clearTimeout(restartTimer)
  try { recognition?.stop() } catch {}

  // Emit the transcript if we got something
  if (transcript.value.trim()) {
    emit("text", transcript.value.trim())
    transcript.value = ""
  }
}

onBeforeUnmount(() => {
  listening.value = false
  if (restartTimer) clearTimeout(restartTimer)
  try { recognition?.abort() } catch {}
})

// Attempt to initialize on mount
init()
</script>

<style scoped>
.voice-input {
  display: flex;
  align-items: center;
  gap: 6px;
}
.voice-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.voice-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.voice-btn.active {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #ef4444;
  animation: pulse 1.5s infinite;
}
.voice-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
  50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
}
.voice-transcript {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voice-error {
  font-size: 11px;
  color: #ef4444;
}
</style>
