<template>
  <div class="password-meter" :class="tone" aria-live="polite">
    <div class="meter-head">
      <span class="meter-label">{{ label }}</span>
      <span class="meter-caption">{{ caption }}</span>
    </div>

    <div
      class="meter-bars"
      role="progressbar"
      aria-label="密码强度"
      :aria-valuenow="score"
      aria-valuemin="0"
      aria-valuemax="4"
    >
      <span
        v-for="index in 4"
        :key="index"
        class="meter-bar"
        :class="{ active: index <= score }"
      ></span>
    </div>

    <div class="meter-tips">
      <span
        v-for="item in tips"
        :key="item.label"
        class="meter-tip"
        :class="{ passed: item.passed }"
      >
        <span class="tip-dot"></span>
        {{ item.label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{ password?: string }>(), {
  password: "",
})

const commonWeakPasswords = new Set([
  "123456",
  "12345678",
  "password",
  "qwerty",
  "111111",
  "000000",
  "abc123",
  "codek",
])

const value = computed(() => props.password || "")
const normalized = computed(() => value.value.trim().toLowerCase())
const length = computed(() => value.value.length)

const varietyCount = computed(() => {
  const checks = [
    /[a-z]/.test(value.value),
    /[A-Z]/.test(value.value),
    /\d/.test(value.value),
    /[^A-Za-z0-9]/.test(value.value),
  ]
  return checks.filter(Boolean).length
})

const hasWeakPattern = computed(() => {
  const current = normalized.value
  if (!current) return false
  if (commonWeakPasswords.has(current)) return true
  if (/^(.)\1{5,}$/.test(current)) return true
  return /(123456|abcdef|qwerty|654321)/.test(current)
})

const score = computed(() => {
  if (!value.value) return 0

  let next = 0
  if (length.value >= 6) next += 1
  if (length.value >= 10) next += 1
  if (varietyCount.value >= 2) next += 1
  if (length.value >= 14 || varietyCount.value >= 3) next += 1
  if (hasWeakPattern.value) next = Math.min(next, 1)

  return Math.max(1, Math.min(4, next))
})

const label = computed(() => {
  if (!value.value) return "密码强度"
  if (score.value <= 1) return "偏弱"
  if (score.value === 2) return "可用"
  if (score.value === 3) return "稳妥"
  return "很强"
})

const caption = computed(() => {
  if (!value.value) return "注册最低 6 位，建议 8 位以上"
  if (hasWeakPattern.value) return "避开常见弱密码和连续数字"
  if (length.value < 8) return "再加几位会更稳"
  if (score.value >= 3) return "适合长期使用"
  return "建议增加长度或字符变化"
})

const tone = computed(() => {
  if (!value.value) return "idle"
  if (score.value <= 1) return "weak"
  if (score.value === 2) return "usable"
  if (score.value === 3) return "good"
  return "strong"
})

const tips = computed(() => [
  { label: "至少 6 位", passed: length.value >= 6 },
  { label: "建议 8 位以上", passed: length.value >= 8 },
  { label: "避免连续或重复", passed: !!value.value && !hasWeakPattern.value },
])
</script>

<style scoped>
.password-meter {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.035);
}

.meter-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.meter-label {
  color: #dbeafe;
  font-size: 12px;
  font-weight: 800;
}

.meter-caption {
  color: #8b97b7;
  font-size: 12px;
  line-height: 1.35;
  text-align: right;
  overflow-wrap: anywhere;
}

.meter-bars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 9px;
}

.meter-bar {
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.meter-bar.active {
  background: rgba(139, 151, 183, 0.8);
}

.password-meter.weak .meter-bar.active {
  background: #f87171;
  box-shadow: 0 0 14px rgba(248, 113, 113, 0.18);
}

.password-meter.usable .meter-bar.active {
  background: #f0b35a;
  box-shadow: 0 0 14px rgba(240, 179, 90, 0.18);
}

.password-meter.good .meter-bar.active {
  background: #6f86ff;
  box-shadow: 0 0 14px rgba(111, 134, 255, 0.18);
}

.password-meter.strong .meter-bar.active {
  background: #4ddac6;
  box-shadow: 0 0 14px rgba(77, 218, 198, 0.2);
}

.meter-tips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
}

.meter-tip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #7e8aaa;
  font-size: 11px;
  line-height: 1.35;
}

.meter-tip.passed {
  color: #a7b5d4;
}

.tip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(126, 138, 170, 0.5);
}

.meter-tip.passed .tip-dot {
  background: #4ddac6;
  box-shadow: 0 0 8px rgba(77, 218, 198, 0.38);
}

@media (max-width: 520px) {
  .meter-head {
    align-items: flex-start;
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .meter-caption {
    text-align: left;
  }
}
</style>
