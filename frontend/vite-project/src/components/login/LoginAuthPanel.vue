<template>
  <section class="auth">
    <div class="login-card">
      <div class="login-head">
        <h3>账号登录</h3>
        <p>使用邮箱验证码注册账号，或通过 GitHub 授权进入 Codek 工作区。</p>
      </div>

      <form @submit.prevent="handleSubmit">
        <div class="field">
          <label for="email">邮箱</label>
          <input
            id="email"
            v-model="email"
            class="input"
            type="email"
            placeholder="name@gmail.com"
            autocomplete="email"
            @keydown.enter="handleSubmit"
          />
        </div>

        <div class="field">
          <label for="password">密码</label>
          <div class="password">
            <input
              id="password"
              v-model="password"
              class="input"
              :type="showPassword ? 'text' : 'password'"
              placeholder="输入密码"
              autocomplete="current-password"
              @keydown.enter="handleSubmit"
            />
            <button
              class="eye"
              type="button"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? "隐藏" : "显示" }}
            </button>
          </div>
        </div>

        <div class="row">
          <div class="checks">
            <label>
              <input
                type="checkbox"
                :checked="auth.rememberMe"
                @change="onRememberChange(($event.target as HTMLInputElement).checked)"
              />
              记住我
            </label>
            <label :class="{ disabled: !auth.rememberMe }">
              <input
                type="checkbox"
                :checked="auth.autoLogin"
                :disabled="!auth.rememberMe"
                @change="onAutoLoginChange(($event.target as HTMLInputElement).checked)"
              />
              自动登录
            </label>
          </div>
          <a class="link" href="#" @click.prevent="$emit('switchToForgot')">忘记密码?</a>
        </div>

        <div v-if="auth.needCaptcha" class="captcha-field">
          <label for="captcha">验证码</label>
          <div class="captcha-row">
            <img
              v-if="auth.captchaImage"
              :src="auth.captchaImage"
              class="captcha-img"
              alt="captcha"
              title="点击刷新验证码"
              @click="auth.refreshCaptcha()"
            />
            <button v-else class="captcha-placeholder" type="button" @click="auth.refreshCaptcha()">
              刷新验证码
            </button>
            <input
              id="captcha"
              v-model="captchaInput"
              class="input"
              type="text"
              maxlength="4"
              placeholder="验证码"
              autocomplete="off"
              @keydown.enter="handleSubmit"
            />
          </div>
        </div>

        <button class="submit" type="submit" :disabled="emailLoginDisabled">
          <span v-if="auth.loading && !auth.githubDeviceFlow.active" class="spinner"></span>
          <span v-else>登录</span>
        </button>

        <div
          v-if="
            auth.loginError &&
            auth.loginErrorCode !== 'user_not_found' &&
            auth.oauthStatus === 'idle'
          "
          class="auth-error"
        >
          {{ auth.loginError }}
        </div>

        <div class="divider">其他方式</div>

        <div class="socials">
          <button
            class="social social--github"
            type="button"
            :disabled="githubBusy"
            title="使用 GitHub 授权登录"
            @click="handleOAuth"
          >
            <svg class="github-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.18-.02-2.14-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.97 10.97 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.02 2.8-.02 3.18 0 .31.21.68.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.73 18.27.5 12 .5Z"
              />
            </svg>
            <span>{{ githubBusy ? "等待 GitHub 授权" : "使用 GitHub 登录" }}</span>
          </button>
        </div>

        <GitHubDeviceAuthStatus />

        <section class="notice-card">
          <strong>登录说明</strong>
          <span>邮箱注册需要验证码确认；GitHub 登录需要账号存在已验证的主邮箱。</span>
        </section>

        <div class="footer">
          还没有账号? <a href="#" @click.prevent="$emit('switchToRegister', email)">立即注册</a>
        </div>
      </form>
    </div>

    <div v-if="showNotFoundDialog" class="auth-dialog-backdrop" @click.self="dismissNotFound">
      <div class="auth-dialog">
        <div class="auth-dialog-title">账号不存在</div>
        <div class="auth-dialog-body">当前邮箱还没有注册 Codek 账号，可以直接进入注册流程。</div>
        <div class="auth-dialog-actions">
          <button class="auth-dialog-btn ghost" type="button" @click="dismissNotFound">取消</button>
          <button class="auth-dialog-btn primary" type="button" @click="goRegister">去注册</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { auth } from "../../auth/authState"
import GitHubDeviceAuthStatus from "./GitHubDeviceAuthStatus.vue"

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

const githubBusy = computed(
  () =>
    auth.githubDeviceFlow.active ||
    auth.oauthStatus === "pending" ||
    auth.oauthStatus === "exchanging",
)

const emailLoginDisabled = computed(
  () =>
    auth.loading || !email.value || !password.value || (auth.needCaptcha && !captchaInput.value),
)

function onRememberChange(value: boolean) {
  auth.setRememberMe(value)
  if (!value) password.value = ""
}

function onAutoLoginChange(value: boolean) {
  auth.setAutoLogin(value)
}

async function handleSubmit() {
  if (emailLoginDisabled.value) return

  dialogDismissed.value = false
  const ok = await auth.loginWithEmail(email.value, password.value, captchaInput.value)
  if (!ok) captchaInput.value = ""
}

async function handleOAuth() {
  if (githubBusy.value) return
  await auth.loginWithOAuth("github")
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
.auth {
  box-sizing: border-box;
  width: 100%;
  max-width: 390px;
  min-width: 0;
  padding: 0;
  display: grid;
  align-items: center;
  justify-items: center;
  min-height: 0;
  overflow: visible;
  -webkit-app-region: no-drag;
}

.login-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-height: calc(100vh - 126px);
  padding: 28px;
  overflow: auto;
  scrollbar-gutter: stable;
  border-radius: 24px;
  border: 1px solid rgba(186, 203, 235, 0.14);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.072), rgba(255, 255, 255, 0.03)),
    rgba(15, 20, 29, 0.76);
  box-shadow:
    0 24px 62px rgba(0, 0, 0, 0.32),
    0 1px 0 rgba(255, 255, 255, 0.08) inset;
  backdrop-filter: blur(24px);
}

.login-card::before {
  content: "";
  position: absolute;
  inset: 1px 1px auto;
  height: 120px;
  border-radius: 22px 22px 0 0;
  background: linear-gradient(180deg, rgba(77, 218, 198, 0.055), transparent);
  pointer-events: none;
}

.login-head h3 {
  position: relative;
  margin: 0;
  color: #f4f8ff;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: 0;
}

.login-head p {
  position: relative;
  margin: 9px 0 24px;
  color: #9ba8c4;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.field,
.captcha-field {
  display: grid;
  gap: 9px;
  margin-bottom: 15px;
}

.field label,
.captcha-field label {
  color: #d8e3fb;
  font-size: 13px;
  font-weight: 700;
}

.input {
  box-sizing: border-box;
  min-height: 48px;
  width: 100%;
  border-radius: 13px;
  border: 1px solid rgba(190, 205, 235, 0.14);
  background: rgba(6, 10, 16, 0.38);
  color: #f2f7ff;
  padding: 0 14px;
  outline: none;
  font: inherit;
  -webkit-app-region: no-drag;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.input:focus {
  border-color: rgba(77, 218, 198, 0.58);
  background: rgba(6, 10, 16, 0.48);
  box-shadow: 0 0 0 3px rgba(77, 218, 198, 0.12);
}

.password {
  position: relative;
}

.password .input {
  padding-right: 72px;
}

.eye {
  position: absolute;
  right: 7px;
  top: 7px;
  min-height: 34px;
  padding: 0 11px;
  border-radius: 10px;
  border: 1px solid rgba(190, 205, 235, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #b5c2de;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.eye:hover {
  color: #edf4ff;
  background: rgba(255, 255, 255, 0.09);
}

.row,
.checks {
  display: flex;
  align-items: center;
}

.row {
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 2px 0 18px;
}

.checks {
  gap: 14px;
  flex-wrap: wrap;
}

.checks label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #a7b5d4;
  font-size: 12px;
}

.checks input {
  accent-color: #4ddac6;
}

.checks .disabled {
  opacity: 0.45;
}

.link,
.footer a {
  color: #4ddac6;
  text-decoration: none;
  font-weight: 700;
  -webkit-app-region: no-drag;
}

.link:hover,
.footer a:hover {
  color: #7ff1df;
}

.captcha-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.captcha-img,
.captcha-placeholder {
  width: 112px;
  height: 48px;
  border-radius: 13px;
  border: 1px solid rgba(190, 205, 235, 0.12);
  background: rgba(6, 10, 16, 0.34);
}

.captcha-placeholder {
  color: #a7b5d4;
  cursor: pointer;
}

.submit {
  width: 100%;
  min-height: 50px;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(90deg, #45d6c2, #6ee7b7);
  color: #041116;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 14px 30px rgba(77, 218, 198, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  transition:
    transform 0.16s ease,
    filter 0.16s ease,
    box-shadow 0.16s ease;
}

.submit:not(:disabled):hover {
  filter: brightness(1.05);
  transform: translateY(-1px);
  box-shadow: 0 17px 34px rgba(77, 218, 198, 0.24);
}

.submit:disabled,
.social:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.auth-error {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
  color: #f87171;
  font-size: 13px;
  line-height: 1.5;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0;
  color: #7785a1;
  font-size: 12px;
}

.divider::before,
.divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
}

.socials {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.social {
  min-height: 48px;
  border-radius: 13px;
  border: 1px solid rgba(190, 205, 235, 0.13);
  background: rgba(255, 255, 255, 0.045);
  color: #eef4ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
  position: relative;
  -webkit-app-region: no-drag;
}

.social:not(:disabled):hover {
  border-color: rgba(77, 218, 198, 0.28);
  background: rgba(77, 218, 198, 0.075);
}

.github-mark {
  width: 19px;
  height: 19px;
  fill: currentColor;
}

.notice-card {
  box-sizing: border-box;
  margin-top: 14px;
  padding: 0;
  border: 0;
  background: transparent;
}

.notice-card strong {
  display: none;
}

.notice-card span,
.footer {
  color: #9aa8c4;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.footer {
  margin-top: 14px;
  text-align: center;
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
  width: min(92vw, 360px);
  background: #1c1e23;
  border: 1px solid #363a42;
  border-radius: 12px;
  padding: 20px 24px;
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
  line-height: 1.6;
  margin-bottom: 16px;
}

.auth-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.auth-dialog-btn {
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  border: 1px solid #2a2d34;
  background: transparent;
  color: #d1d5db;
}

.auth-dialog-btn.primary {
  background: #4ddac6;
  border-color: #4ddac6;
  color: #07111e;
  font-weight: 700;
}

@media (max-height: 760px) and (min-width: 761px) {
  .login-card {
    padding: 20px;
    border-radius: 18px;
    max-height: calc(100vh - 74px);
  }

  .login-card::before {
    border-radius: 16px 16px 0 0;
  }

  .login-head h3 {
    font-size: 21px;
  }

  .login-head p {
    margin: 5px 0 12px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .field,
  .captcha-field {
    gap: 5px;
    margin-bottom: 9px;
  }

  .field label,
  .captcha-field label {
    font-size: 12px;
  }

  .input,
  .submit,
  .social {
    min-height: 40px;
    border-radius: 10px;
  }

  .password .input {
    padding-right: 62px;
  }

  .eye {
    top: 4px;
    min-height: 32px;
    padding: 0 8px;
  }

  .row {
    margin: 2px 0 10px;
    gap: 8px;
  }

  .checks {
    gap: 10px;
  }

  .divider {
    margin: 11px 0;
  }

  .notice-card {
    display: none;
  }

  .footer {
    margin-top: 8px;
  }

  .github-device {
    margin-top: 8px;
  }
}

@media (max-width: 640px) {
  .auth {
    max-width: 100%;
  }

  .captcha-row {
    grid-template-columns: 1fr;
  }

  .captcha-img,
  .captcha-placeholder {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .login-card {
    padding: 24px 20px 22px;
    border-radius: 20px;
    max-height: none;
  }

  .login-head h3 {
    font-size: 24px;
  }

  .row {
    align-items: flex-start;
    flex-direction: column;
  }

  .submit {
    font-size: 16px;
  }

  .password .input {
    padding-right: 58px;
  }

  .eye {
    right: 6px;
    padding: 0 8px;
  }
}
</style>
