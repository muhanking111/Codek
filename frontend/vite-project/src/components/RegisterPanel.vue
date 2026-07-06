<template>
  <div class="auth-overlay register-overlay">
    <div class="auth-bg">
      <div class="auth-bg-grid"></div>
    </div>
    <div class="auth-card register-card">
      <div class="auth-logo">创建 Codek 账号</div>
      <div class="auth-subtitle">使用真实邮箱完成验证后进入你的项目工作区</div>

      <div class="auth-input-group">
        <label class="auth-label">邮箱</label>
        <input
          v-model="email"
          class="auth-input"
          type="email"
          placeholder="name@gmail.com"
          autocomplete="email"
          @keydown.enter="handleSubmit"
        />
      </div>

      <div class="auth-input-group">
        <label class="auth-label">邮箱验证码</label>
        <div class="auth-code-row">
          <input
            v-model="code"
            class="auth-input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="输入 6 位验证码"
            autocomplete="one-time-code"
            @keydown.enter="handleSubmit"
          />
          <button
            class="auth-code-btn"
            type="button"
            :disabled="auth.loading || codeStatus === 'sending' || codeCooldown > 0 || !email"
            :aria-busy="codeStatus === 'sending'"
            @click="sendRegisterCode"
          >
            {{ codeButtonText }}
          </button>
        </div>
        <VerificationCodeStatus
          :email="email"
          :status="codeStatus"
          :message="codeMessage"
          :cooldown="codeCooldown"
          :dev-mode="codeDevMode"
        />
      </div>

      <div class="auth-input-group">
        <label class="auth-label">密码</label>
        <div class="auth-password-wrap">
          <input
            v-model="password"
            class="auth-input"
            :type="showPassword ? 'text' : 'password'"
            placeholder="至少 6 位密码"
            autocomplete="new-password"
            @keydown.enter="handleSubmit"
          />
          <button
            class="auth-pw-toggle"
            type="button"
            :title="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? "隐藏" : "显示" }}
          </button>
        </div>
        <PasswordStrengthMeter :password="password" />
      </div>

      <div class="auth-input-group">
        <label class="auth-label">确认密码</label>
        <input
          v-model="confirmPassword"
          class="auth-input"
          type="password"
          autocomplete="new-password"
          @keydown.enter="handleSubmit"
        />
      </div>

      <button
        class="auth-btn"
        :disabled="auth.loading || !email || !password || !confirmPassword || !code"
        @click="handleSubmit"
      >
        <span v-if="auth.loading" class="auth-spinner"></span>
        {{ auth.loading ? "" : "注册并登录" }}
      </button>

      <div v-if="localError" class="auth-error">{{ localError }}</div>
      <div v-if="auth.loginError" class="auth-error">{{ auth.loginError }}</div>

      <div class="auth-switch">
        已有账号？
        <a href="#" @click.prevent="$emit('switchToLogin')">返回登录</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { auth } from "../auth/authState"
import PasswordStrengthMeter from "./login/PasswordStrengthMeter.vue"
import VerificationCodeStatus from "./login/VerificationCodeStatus.vue"

const props = defineProps<{ initialEmail?: string }>()

defineEmits<{
  switchToLogin: []
}>()

const email = ref(props.initialEmail || "")
const password = ref("")
const confirmPassword = ref("")
const code = ref("")
const showPassword = ref(false)
const localError = ref("")
type CodeStatus = "idle" | "sending" | "sent" | "error" | "dev"
const codeStatus = ref<CodeStatus>("idle")
const codeMessage = ref("")
const codeDevMode = ref(false)
const codeCooldown = ref(0)
let cooldownTimer: number | undefined

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const codeButtonText = computed(() => {
  if (codeStatus.value === "sending") return "发送中"
  if (codeCooldown.value > 0) return `${codeCooldown.value}s`
  return "发送验证码"
})

watch(() => props.initialEmail, (value) => {
  if (value && !email.value) email.value = value
})

watch(email, (value, oldValue) => {
  if (oldValue && value !== oldValue) resetCodeFeedback(true)
})

onBeforeUnmount(() => {
  clearCooldown()
})

function clearCooldown() {
  if (cooldownTimer === undefined) return
  window.clearInterval(cooldownTimer)
  cooldownTimer = undefined
}

function resetCodeFeedback(clearEnteredCode = false) {
  codeStatus.value = "idle"
  codeMessage.value = ""
  codeDevMode.value = false
  codeCooldown.value = 0
  clearCooldown()
  if (clearEnteredCode) code.value = ""
}

async function sendRegisterCode() {
  localError.value = ""
  resetCodeFeedback()
  if (!email.value || !EMAIL_RE.test(email.value.trim())) {
    localError.value = "请输入有效的邮箱地址"
    codeStatus.value = "error"
    codeMessage.value = "先填写正确的邮箱地址"
    return
  }

  codeStatus.value = "sending"
  codeMessage.value = ""
  const requestedEmail = email.value.trim()
  const res = await auth.requestRegisterCode(requestedEmail)
  if (email.value.trim() !== requestedEmail) return
  if (!res.success) {
    localError.value = res.error || "验证码发送失败"
    codeStatus.value = "error"
    codeMessage.value = res.error || "验证码发送失败，请稍后重试"
    return
  }

  codeDevMode.value = !!res.devMode
  codeStatus.value = res.devMode ? "dev" : "sent"
  codeMessage.value = res.devMode
    ? "开发模式：验证码已输出到后端日志"
    : "验证码已发送，请检查邮箱"
  const seconds = Math.max(1, Math.round((res.resendCooldownMs || 60000) / 1000))
  codeCooldown.value = seconds
  clearCooldown()
  cooldownTimer = window.setInterval(() => {
    codeCooldown.value = Math.max(0, codeCooldown.value - 1)
    if (codeCooldown.value === 0) clearCooldown()
  }, 1000)
}

function handleSubmit() {
  if (auth.loading) return
  localError.value = ""

  if (!email.value || !EMAIL_RE.test(email.value.trim())) {
    localError.value = "请输入有效的邮箱地址"
    return
  }
  if (!code.value || code.value.trim().length !== 6) {
    localError.value = "请输入 6 位邮箱验证码"
    return
  }
  if (!password.value || password.value.length < 6) {
    localError.value = "密码至少 6 位"
    return
  }
  if (password.value !== confirmPassword.value) {
    localError.value = "两次输入的密码不一致"
    return
  }

  auth.resetError()
  auth.registerWithEmail(email.value.trim(), password.value, code.value.trim())
}
</script>

<style scoped>
.register-overlay {
  box-sizing: border-box;
  width: 100vw;
  max-width: 100vw;
  min-height: 100vh;
  padding: 16px;
  overflow: auto;
}

.auth-card.register-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 380px;
  min-width: 0;
  margin: 0 auto;
}

.auth-input,
.auth-btn {
  box-sizing: border-box;
}

.auth-code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 8px;
}

.auth-code-btn {
  box-sizing: border-box;
  min-height: 42px;
  border-radius: 10px;
  border: 1px solid rgba(45, 212, 191, 0.28);
  background: rgba(45, 212, 191, 0.1);
  color: #2dd4bf;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.auth-code-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .register-overlay {
    align-items: flex-start;
  }

  .auth-card.register-card {
    padding: 28px 20px;
    width: 100%;
    max-width: 100%;
  }

  .auth-code-row {
    grid-template-columns: 1fr;
  }
}
</style>
