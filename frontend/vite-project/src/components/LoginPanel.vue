<template>
  <div class="auth-overlay">
    <div class="auth-bg">
      <div class="auth-bg-grid"></div>
    </div>
    <div class="auth-card">
      <div class="auth-logo">Codek</div>
      <div class="auth-subtitle">{{ t("auth.loginSubtitle") }}</div>

      <div class="auth-input-group">
        <label class="auth-label">{{ t("auth.email") }}</label>
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
        <label class="auth-label">{{ t("auth.password") }}</label>
        <div class="auth-password-wrap">
          <input
            v-model="password"
            class="auth-input"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="t('auth.password')"
            autocomplete="current-password"
            @keydown.enter="handleSubmit"
          />
          <button class="auth-pw-toggle" type="button" :title="showPassword ? t('auth.hidePassword') : t('auth.showPassword')" @click="showPassword = !showPassword">
            {{ showPassword ? t("auth.hidePassword") : t("auth.showPassword") }}
          </button>
        </div>
        <div class="auth-forgot-row">
          <a href="#" class="auth-forgot-link" @click.prevent="$emit('switchToForgot')">{{ t("auth.forgotLink") }}</a>
        </div>
      </div>

      <div class="auth-remember-row">
        <label class="auth-remember-item">
          <input type="checkbox" :checked="auth.rememberMe" @change="onRememberChange(($event.target as HTMLInputElement).checked)" />
          <span>{{ t("auth.rememberMe") }}</span>
        </label>
        <label class="auth-remember-item" :class="{ disabled: !auth.rememberMe }">
          <input
            type="checkbox"
            :checked="auth.autoLogin"
            :disabled="!auth.rememberMe"
            @change="onAutoLoginChange(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t("auth.autoLogin") }}</span>
        </label>
      </div>

      <div v-if="auth.needCaptcha" class="auth-captcha-group">
        <label class="auth-label">{{ t("auth.captchaLabel") }}</label>
        <div class="auth-captcha-row">
          <img
            v-if="auth.captchaImage"
            :src="auth.captchaImage"
            class="auth-captcha-img"
            alt="captcha"
            :title="t('auth.captchaHint')"
            @click="auth.refreshCaptcha()"
          />
          <button v-else class="auth-captcha-placeholder" type="button" @click="auth.refreshCaptcha()">
            {{ t("auth.captchaHint") }}
          </button>
          <input
            v-model="captchaInput"
            class="auth-input"
            type="text"
            maxlength="4"
            :placeholder="t('auth.captchaPlaceholder')"
            autocomplete="off"
            @keydown.enter="handleSubmit"
          />
        </div>
      </div>

      <button
        class="auth-btn"
        :disabled="auth.loading || !email || !password || (auth.needCaptcha && !captchaInput)"
        @click="handleSubmit"
      >
        <span v-if="auth.loading && !auth.githubDeviceFlow.active" class="auth-spinner"></span>
        {{ auth.loading && !auth.githubDeviceFlow.active ? "" : t("auth.loginButton") }}
      </button>

      <div v-if="auth.loginError && auth.loginErrorCode !== 'user_not_found' && auth.oauthStatus === 'idle'" class="auth-error">{{ auth.loginError }}</div>

      <div class="auth-divider"><span>{{ t("auth.or") }}</span></div>

      <div class="auth-oauth-row">
        <button class="auth-oauth-btn github" type="button" :disabled="githubBusy" @click="handleOAuth('github')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.18-.02-2.14-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.97 10.97 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.02 2.8-.02 3.18 0 .31.21.68.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.73 18.27.5 12 .5Z"/></svg>
          {{ githubBusy ? "等待 GitHub 授权" : "GitHub" }}
        </button>
      </div>

      <GitHubDeviceAuthStatus />

      <div class="auth-switch">
        {{ t("auth.noAccount") }}
        <a href="#" @click.prevent="$emit('switchToRegister', email)"> {{ t("auth.registerLink") }} </a>
      </div>
    </div>

    <div v-if="showNotFoundDialog" class="auth-dialog-backdrop" @click.self="dismissNotFound">
      <div class="auth-dialog">
        <div class="auth-dialog-title">{{ t("auth.accountNotFound") }}</div>
        <div class="auth-dialog-body">{{ t("auth.accountNotFoundDesc") }}</div>
        <div class="auth-dialog-actions">
          <button class="auth-dialog-btn ghost" @click="dismissNotFound">{{ t("auth.cancel") }}</button>
          <button class="auth-dialog-btn primary" @click="goRegister">{{ t("auth.goRegister") }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { auth, type OAuthProvider } from "../auth/authState"
import { useI18n } from "../i18n/index"
import GitHubDeviceAuthStatus from "./login/GitHubDeviceAuthStatus.vue"

const { t } = useI18n()

const emit = defineEmits<{
  switchToRegister: [email?: string]
  switchToForgot: []
}>()

const email = ref("")
const password = ref("")
const captchaInput = ref("")
const showPassword = ref(false)
const dialogDismissed = ref(false)

onMounted(async () => {
  await auth.loadOAuthProviders()
  if (auth.rememberMe) {
    const saved = await auth.getSavedCredentials()
    if (saved.email) email.value = saved.email
    if (saved.password) password.value = saved.password
  }
})

const showNotFoundDialog = computed(
  () => auth.loginErrorCode === "user_not_found" && !dialogDismissed.value,
)

const githubBusy = computed(() => auth.githubDeviceFlow.active || auth.oauthStatus === "pending" || auth.oauthStatus === "exchanging")

function onRememberChange(value: boolean) {
  auth.setRememberMe(value)
  if (!value) password.value = ""
}

function onAutoLoginChange(value: boolean) {
  auth.setAutoLogin(value)
}

async function handleSubmit() {
  if (auth.loading) return
  if (!email.value || !password.value) return
  if (auth.needCaptcha && !captchaInput.value) return

  dialogDismissed.value = false
  const ok = await auth.loginWithEmail(email.value, password.value, captchaInput.value)
  if (!ok) captchaInput.value = ""
}

async function handleOAuth(provider: OAuthProvider) {
  if (githubBusy.value) return
  await auth.loginWithOAuth(provider)
}

function dismissNotFound() {
  dialogDismissed.value = true
  auth.resetError()
}

function goRegister() {
  dialogDismissed.value = true
  auth.resetError()
  emit("switchToRegister", email.value)
}
</script>

<style scoped>
.auth-remember-row {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 4px 0 12px;
}
.auth-remember-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #d1d5db;
  cursor: pointer;
  user-select: none;
}
.auth-remember-item.disabled {
  color: #5a5e6a;
  cursor: not-allowed;
}
.auth-remember-item input[type='checkbox'] {
  accent-color: #2dd4bf;
  cursor: inherit;
}
.auth-forgot-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.auth-forgot-link {
  font-size: 12px;
  color: #8b8fa3;
  text-decoration: none;
  transition: color 0.15s;
}
.auth-forgot-link:hover {
  color: #2dd4bf;
}
.auth-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 12px;
  color: #5a5e6a;
  font-size: 12px;
}
.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #2a2d34;
}
.auth-oauth-row {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.auth-oauth-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: #1c1e23;
  color: #d1d5db;
  border: 1px solid #2a2d34;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s, border-color 0.15s;
}
.auth-oauth-btn:hover:not(:disabled) {
  background: #22252b;
  border-color: #363a42;
}
.auth-oauth-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth-captcha-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 8px;
}
.auth-captcha-placeholder {
  min-height: 42px;
  border-radius: 8px;
  border: 1px solid #2a2d34;
  background: #1c1e23;
  color: #8b8fa3;
}
.auth-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.auth-dialog {
  background: #1c1e23;
  border: 1px solid #363a42;
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 320px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
.auth-dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
  margin-bottom: 8px;
}
.auth-dialog-body {
  color: #8b8fa3;
  font-size: 14px;
  margin-bottom: 16px;
}
.auth-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.auth-dialog-btn {
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  border: 1px solid #2a2d34;
  background: transparent;
  color: #d1d5db;
}
.auth-dialog-btn.primary {
  background: #2dd4bf;
  border-color: #2dd4bf;
  color: #0d0e10;
  font-weight: 600;
}
.auth-dialog-btn:hover {
  filter: brightness(1.1);
}
@media (max-width: 520px) {
  .auth-captcha-row {
    grid-template-columns: 1fr;
  }
}
</style>
