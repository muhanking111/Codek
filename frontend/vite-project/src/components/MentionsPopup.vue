<template>
  <div v-if="visible && filteredMentions.length > 0" class="mentions-popup" :style="popupStyle" @click.stop>
    <div class="mentions-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="mentions-tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="mentions-list" ref="listRef">
      <div
        v-for="(mention, index) in filteredMentions"
        :key="mention.id"
        class="mentions-item"
        :class="{ active: index === activeIndex }"
        @click="selectMention(mention)"
        @mouseenter="activeIndex = index"
      >
        <span class="mentions-item-icon">{{ mention.icon }}</span>
        <div class="mentions-item-text">
          <span class="mentions-item-label">{{ mention.label }}</span>
          <span v-if="mention.detail" class="mentions-item-detail">{{ mention.detail }}</span>
        </div>
        <span class="mentions-item-type">{{ mention.type }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { searchMentions } from "../ai/mentions"
import type { Mention } from "../ai/mentions"

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "file", label: "Files" },
  { key: "code", label: "Code" },
  { key: "git", label: "Git" },
] as const

type TabKey = (typeof FILTER_TABS)[number]["key"]

const props = defineProps<{
  visible: boolean
  position: { top: number; left: number }
  query: string
  projectRoot: string
}>()

const emit = defineEmits<{
  select: [mention: Mention]
  close: []
}>()

const activeIndex = ref(0)
const activeTab = ref<TabKey>("all")
const allMentions = ref<Mention[]>([])
const listRef = ref<HTMLDivElement | null>(null)

const tabs = computed(() => FILTER_TABS)

const filteredMentions = computed(() => {
  if (activeTab.value === "all") return allMentions.value
  return allMentions.value.filter((m) => m.type === activeTab.value)
})

const popupStyle = computed(() => ({
  top: `${props.position.top}px`,
  left: `${props.position.left}px`,
}))

watch(
  () => props.query,
  async (newQuery) => {
    if (!props.visible) return
    activeIndex.value = 0
    allMentions.value = await searchMentions(newQuery, props.projectRoot)
  },
  { immediate: true },
)

watch(
  () => props.visible,
  async (isVisible) => {
    if (isVisible) {
      activeIndex.value = 0
      activeTab.value = "all"
      allMentions.value = await searchMentions(props.query, props.projectRoot)
    }
  },
)

watch(activeTab, () => {
  activeIndex.value = 0
})

watch(activeIndex, () => {
  const list = listRef.value
  if (!list) return
  const activeEl = list.children[activeIndex.value] as HTMLElement | undefined
  activeEl?.scrollIntoView({ block: "nearest" })
})

function selectMention(mention: Mention): void {
  emit("select", mention)
}

function handleKeydown(e: KeyboardEvent): void {
  if (!props.visible) return

  const items = filteredMentions.value
  if (items.length === 0) return

  if (e.key === "ArrowDown") {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % items.length
    return
  }

  if (e.key === "ArrowUp") {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + items.length) % items.length
    return
  }

  if (e.key === "Enter") {
    e.preventDefault()
    const selected = items[activeIndex.value]
    if (selected) selectMention(selected)
    return
  }

  if (e.key === "Escape") {
    e.preventDefault()
    emit("close")
  }
}

defineExpose({ handleKeydown })
</script>

<style scoped>
.mentions-popup {
  position: fixed;
  z-index: 10000;
  width: 320px;
  max-height: 300px;
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 10px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mentions-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.mentions-tab {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.mentions-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.mentions-tab.active {
  color: var(--text-primary);
  background: var(--bg-elevated);
  border-color: var(--border);
}

.mentions-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px;
}

.mentions-list::-webkit-scrollbar {
  width: 4px;
}

.mentions-list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.mentions-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.08s;
}

.mentions-item:hover,
.mentions-item.active {
  background: var(--bg-hover);
}

.mentions-item-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  border-radius: 5px;
  background: var(--bg-elevated);
}

.mentions-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mentions-item-label {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mentions-item-detail {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mentions-item-type {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 2px 6px;
  background: var(--bg-elevated);
  border-radius: 4px;
  flex-shrink: 0;
}
</style>