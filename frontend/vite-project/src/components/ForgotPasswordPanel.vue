<template>
  <div class="auth-overlay">
    <div class="auth-bg">
      <div class="auth-bg-grid"></div>
    </div>
    <div class="auth-card">
      <div class="auth-logo">{{ t('auth.forgotTitle') }}</div>
      <div class="auth-subtitle">{{ t('auth.forgotSubtitle') }}</div>

      <div class="auth-input-group">
        <label class="auth-label">{{ t('auth.email') }}</label>
        <input
          v-model="email"
          class="auth-input"
          type="email"
          :placeholder="t('auth.emailPlaceholderForgot')"
          autocomplete="email"
          :disabled="step === 'reset' || sending"
          @keydown.enter="onPrimaryEnter"
        />
      </div>

      <div class="auth-input-group">
        <label class="auth-label">{{ t('auth.codeLabel') }}</label>
        <div class="auth-code-row">
          <input
            v-model="code"
            class="auth-input auth-code-input"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            :placeholder="t('auth.codePlaceholder')"
            autocomplete="one-time-code"
            @input="filterCode"
            @keydown.enter="onPrimaryEnter"
          />
          <button
            type="button"
            class="auth-code-btn"
            :disabled="sending || cooldown > 0 || !emailValid"
            @click="handleSendCode"
          >
            <span v-if="sending" class="auth-spinner"></span>
            <span v-else-if="cooldown > 0">{{ t('auth.codeBtnCountdown', { n: cooldown }) }}</span>
            <span v-else>{{ sentOnce ? t('auth.codeBtnResend') : t('auth.codeBtnSend') }}</span>
          </button>
        </div>
        <div v-if="codeExpiryRemaining > 0" class="auth-hint">
          {{ t('auth.codeValidFor', { time: formatRemaining(codeExpiryRemaining) }) }}
        </div>
        <div v-if="devModeNotice" class="auth-hint dev">
          {{ t('auth.devModeNotice') }}
        </div>
      </div>

      <div class="auth-input-group">
        <label class="auth-label">{{ t('auth.newPassword') }}</label>
        <div class="auth-password-wrap">
          <input
            v-model="newPassword"
            class="auth-input"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="t('auth.newPasswordHint')"
            autocomplete="new-password"
            @keydown.enter="onPrimaryEnter"
          />
          <button
            class="auth-pw-toggle"
            type="button"
            :title="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
            @click="showPassword = !showPassword"
          >
            <span v-if="showPassword">👁</span>
            <span v-else>👁‍🗨</span>
          </button>
        </div>
      </div>

      <div class="auth-input-group">
        <label class="auth-label">{{ t('auth.confirmNewPassword') }}</label>
        <input
          v-model="confirmPassword"
          class="auth-input"
          type="password"
          autocomplete="new-password"
          @keydown.enter="onPrimaryEnter"
        />
      </div>

      <button
        class="auth-btn"
        :disabled="!canSubmit"
        @click="handleReset"
      >
        <span v-if="resetting" class="auth-spinner"></span>
        {{ resetting ? '' : t('auth.resetBtn') }}
      </button>

      <div v-if="successMessage" class="auth-success">{{ successMessage }}</div>
      <div v-if="errorMessage" class="auth-error">{{ errorMessage }}</div>

      <div class="auth-switch">
        {{ t('auth.rememberPwd') }}
        <a href="#" @click.prevent="$emit('switchToLogin')">{{ t('auth.backToLogin') }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { auth } from '../auth/authState'
import { useI18n } from '../i18n/index'

const { t } = useI18n()

const emit = defineEmits<{
  switchToLogin: []
}>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const email = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)

const sending = ref(false)
const resetting = ref(false)
const sentOnce = ref(false)
const step = ref<'request' | 'reset'>('request')
const errorMessage = ref('')
const successMessage = ref('')
const devModeNotice = ref(false)

const cooldown = ref(0)
let cooldownTimer: number | null = null

const codeExpiresAt = ref(0)
const codeExpiryRemaining = ref(0)
let expiryTimer: number | null = null

const emailValid = computed(() => EMAIL_RE.test(email.value.trim()))
const codeValid = computed(() => /^\d{6}$/.test(code.value))

const canSubmit = computed(() =>
  !resetting.value
  && emailValid.value
  && codeValid.value
  && newPassword.value.length >= 6
  && newPassword.value === confirmPassword.value,
)

function filterCode() {
  code.value = code.value.replace(/\D/g, '').slice(0, 6)
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function startCooldown(seconds: number) {
  cooldown.value = seconds
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
  cooldownTimer = window.setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && cooldownTimer !== null) {
      window.clearInterval(cooldownTimer)
      cooldownTimer = null
      cooldown.value = 0
    }
  }, 1000)
}

function startExpiryCountdown() {
  if (expiryTimer !== null) window.clearInterval(expiryTimer)
  const tick = () => {
    codeExpiryRemaining.value = Math.max(0, codeExpiresAt.value - Date.now())
    if (codeExpiryRemaining.value <= 0 && expiryTimer !== null) {
      window.clearInterval(expiryTimer)
      expiryTimer = null
    }
  }
  tick()
  expiryTimer = window.setInterval(tick, 1000)
}

async function handleSendCode() {
  if (sending.value || cooldown.value > 0) return
  errorMessage.value = ''
  successMessage.value = ''
  if (!emailValid.value) {
    errorMessage.value = t('auth.invalidEmail')
    return
  }
  sending.value = true
  const res = await auth.requestPasswordReset(email.value.trim().toLowerCase())
  sending.value = false
  if (!res.success) {
    errorMessage.value = res.error || t('auth.codeSendFailed')
    return
  }
  sentOnce.value = true
  step.value = 'reset'
  devModeNotice.value = !!res.devMode
  successMessage.value = res.devMode
    ? t('auth.codeSentDev')
    : t('auth.codeSent')
  if (res.expiresInMs) {
    codeExpiresAt.value = Date.now() + res.expiresInMs
    startExpiryCountdown()
  }
  startCooldown(Math.ceil((res.resendCooldownMs || 60_000) / 1000))
}

async function handleReset() {
  if (!canSubmit.value) return
  errorMessage.value = ''
  successMessage.value = ''
  resetting.value = true
  const res = await auth.resetPasswordWithCode(
    email.value.trim().toLowerCase(),
    code.value,
    newPassword.value,
  )
  resetting.value = false
  if (!res.success) {
    errorMessage.value = res.error || t('auth.resetFailed')
    return
  }
  successMessage.value = t('auth.resetSuccess')
  window.setTimeout(() => emit('switchToLogin'), 1200)
}

function onPrimaryEnter() {
  if (canSubmit.value) handleReset()
  else if (!sentOnce.value && emailValid.value) handleSendCode()
}

onBeforeUnmount(() => {
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
  if (expiryTimer !== null) window.clearInterval(expiryTimer)
})
</script>

<style scoped>
.auth-code-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.auth-code-input {
  flex: 1;
  letter-spacing: 4px;
  font-variant-numeric: tabular-nums;
}
.auth-code-btn {
  min-width: 120px;
  padding: 0 14px;
  background: #1c1e23;
  color: #2dd4bf;
  border: 1px solid #2a2d34;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.auth-code-btn:hover:not(:disabled) {
  background: #22252b;
  border-color: #2dd4bf;
}
.auth-code-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #8b8fa3;
}
.auth-hint.dev {
  color: #f59e0b;
}
.auth-success {
  margin-top: 10px;
  font-size: 13px;
  color: #2dd4bf;
}
</style>
