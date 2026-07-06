<template>
  <div class="code-status" :class="status" aria-live="polite">
    <div class="status-main">
      <span class="status-dot"></span>
      <div class="status-copy">
        <strong>{{ title }}</strong>
        <span>{{ detail }}</span>
      </div>
      <span v-if="cooldown > 0" class="cooldown">{{ cooldown }}s</span>
    </div>

    <div v-if="providerHint" class="provider-hint">{{ providerHint }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"

type CodeStatus = "idle" | "sending" | "sent" | "error" | "dev"

const props = withDefaults(
  defineProps<{
    email?: string
    status?: CodeStatus
    message?: string
    cooldown?: number
    devMode?: boolean
  }>(),
  {
    email: "",
    status: "idle",
    message: "",
    cooldown: 0,
    devMode: false,
  },
)

const domain = computed(() => {
  const [, rawDomain = ""] = (props.email || "").trim().toLowerCase().split("@")
  return rawDomain
})

const title = computed(() => {
  if (props.status === "sending") return "正在发送"
  if (props.status === "sent") return "验证码已发送"
  if (props.status === "dev") return "开发模式验证码"
  if (props.status === "error") return "发送失败"
  return "邮箱验证"
})

const detail = computed(() => {
  if (props.message) return props.message
  if (props.status === "sending") return "正在检查邮箱并投递验证码"
  if (props.status === "sent") return "查看收件箱，验证码有效期以服务端配置为准"
  if (props.status === "dev") return "邮件未真正发送，查看后端日志里的 6 位验证码"
  if (props.status === "error") return "确认邮箱格式或稍后重试"
  if (domain.value) return "点击发送后会先校验邮箱域名，再发送 6 位随机验证码"
  return "填写邮箱后发送 6 位随机验证码"
})

const providerHint = computed(() => {
  if (!domain.value) return "支持 QQ 邮箱、网易 163/126 邮箱、Gmail 等常见邮箱。"
  if (domain.value === "qq.com") return "QQ 邮箱收不到时，检查垃圾箱或安全拦截通知。"
  if (["163.com", "126.com", "yeah.net"].includes(domain.value)) {
    return "网易邮箱收不到时，检查垃圾箱、广告邮件或客户端收信设置。"
  }
  if (domain.value === "gmail.com" || domain.value === "googlemail.com") {
    return "Gmail 收不到时，检查 Spam、Promotions 或 All Mail。"
  }
  if (props.status === "sent") return "如果一分钟内未收到，检查垃圾箱后再重新发送。"
  return ""
})
</script>

<style scoped>
.code-status {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.035);
}

.status-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #7e8aaa;
  box-shadow: 0 0 10px rgba(126, 138, 170, 0.24);
}

.status-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.status-copy strong {
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.35;
}

.status-copy span,
.provider-hint {
  color: #8b97b7;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.cooldown {
  min-width: 42px;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(77, 218, 198, 0.09);
  color: #4ddac6;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
}

.provider-hint {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.code-status.sending .status-dot {
  background: #f0b35a;
  box-shadow: 0 0 12px rgba(240, 179, 90, 0.38);
}

.code-status.sent .status-dot,
.code-status.dev .status-dot {
  background: #4ddac6;
  box-shadow: 0 0 12px rgba(77, 218, 198, 0.38);
}

.code-status.error {
  border-color: rgba(248, 113, 113, 0.2);
  background: rgba(248, 113, 113, 0.08);
}

.code-status.error .status-dot {
  background: #f87171;
  box-shadow: 0 0 12px rgba(248, 113, 113, 0.34);
}

.code-status.error .status-copy strong,
.code-status.error .status-copy span {
  color: #fca5a5;
}

@media (max-width: 420px) {
  .status-main {
    align-items: flex-start;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .cooldown {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
