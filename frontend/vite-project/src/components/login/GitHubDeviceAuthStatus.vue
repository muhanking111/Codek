<template>
  <section v-if="visible" class="github-device" :class="stateClass">
    <div class="device-head">
      <div>
        <div class="device-title">{{ title }}</div>
        <div class="device-text">{{ description }}</div>
      </div>
      <span v-if="isWaiting" class="device-spinner"></span>
    </div>

    <div v-if="auth.githubDeviceFlow.userCode" class="code-box" aria-label="GitHub 验证码">
      <span>{{ auth.githubDeviceFlow.userCode }}</span>
    </div>

    <div v-if="auth.githubDeviceFlow.remainingSeconds > 0" class="device-meta">
      <span>剩余 {{ remainingLabel }}</span>
      <span>每 {{ auth.githubDeviceFlow.interval }} 秒检查一次</span>
    </div>

    <div v-if="auth.githubDeviceFlow.active" class="device-actions">
      <button type="button" @click="auth.copyGithubUserCode()">
        {{ auth.githubDeviceFlow.copyState === "copied" ? "已复制" : "复制验证码" }}
      </button>
      <button type="button" @click="auth.openGithubDevicePage()">打开 GitHub</button>
      <button type="button" class="ghost" @click="auth.cancelGithubDeviceFlow()">取消</button>
    </div>

    <div v-else-if="auth.oauthStatus === 'cancelled' || auth.oauthStatus === 'expired' || auth.oauthStatus === 'error'" class="device-actions">
      <button type="button" @click="retry">重新发起 GitHub 登录</button>
      <button type="button" class="ghost" @click="reset">收起</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { auth } from "../../auth/authState"

const visible = computed(
  () => auth.githubDeviceFlow.active
    || auth.oauthStatus === "pending"
    || auth.oauthStatus === "exchanging"
    || auth.oauthStatus === "cancelled"
    || auth.oauthStatus === "expired"
    || auth.oauthStatus === "error",
)

const isWaiting = computed(() => auth.oauthStatus === "pending" || auth.oauthStatus === "exchanging")

const title = computed(() => {
  if (auth.oauthStatus === "exchanging") return "正在完成 GitHub 登录"
  if (auth.oauthStatus === "cancelled") return "GitHub 授权已取消"
  if (auth.oauthStatus === "expired") return "GitHub 验证码已过期"
  if (auth.oauthStatus === "error") return "GitHub 登录遇到问题"
  return "在浏览器中完成 GitHub 授权"
})

const description = computed(() => {
  if (auth.githubDeviceFlow.statusText) return auth.githubDeviceFlow.statusText
  if (auth.loginError) return auth.loginError
  return "复制下方验证码，在 GitHub 页面输入并确认授权。"
})

const stateClass = computed(() => ({
  waiting: isWaiting.value,
  error: auth.oauthStatus === "error" || auth.oauthStatus === "expired",
  muted: auth.oauthStatus === "cancelled",
}))

const remainingLabel = computed(() => {
  const total = auth.githubDeviceFlow.remainingSeconds
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds} 秒`
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`
})

async function retry() {
  auth.resetOAuthFlow()
  await auth.loginWithOAuth("github")
}

function reset() {
  auth.resetOAuthFlow()
  auth.resetError()
}
</script>

<style scoped>
.github-device {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid rgba(77, 218, 198, 0.22);
  background: rgba(77, 218, 198, 0.07);
  color: #d7fff8;
}

.github-device.error {
  border-color: rgba(248, 113, 113, 0.25);
  background: rgba(248, 113, 113, 0.08);
  color: #fecaca;
}

.github-device.muted {
  border-color: rgba(156, 163, 175, 0.22);
  background: rgba(156, 163, 175, 0.08);
  color: #d1d5db;
}

.device-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.device-title {
  color: #eef4ff;
  font-size: 13px;
  font-weight: 800;
}

.device-text {
  margin-top: 4px;
  color: currentColor;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.device-spinner {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.code-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.22);
  background: rgba(0, 0, 0, 0.18);
  color: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.device-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: rgba(238, 244, 255, 0.72);
  font-size: 12px;
  flex-wrap: wrap;
}

.device-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.device-actions button {
  min-height: 36px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.1);
  color: #eef4ff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.device-actions button:not(.ghost) {
  background: #4ddac6;
  border-color: #4ddac6;
  color: #07111e;
}

.device-actions button:hover {
  filter: brightness(1.06);
}

.device-actions .ghost {
  color: #c8d2ea;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 520px) {
  .code-box {
    font-size: 20px;
  }

  .device-actions {
    grid-template-columns: 1fr;
  }
}
</style>
