<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from "vue"
import { retrieveRelevantFiles } from "../ai/retriever.js"
import { settingsStore } from "../settings/settingsStore"
import { getSearchSettings, parseSearchPatternInput } from "../settings/searchSettings"
import { createSearchPreviewParts } from "../vscode-adapter/workbench/contrib/search/searchResultView"
import { CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import {
  globalSearchWorkbenchService,
  type CodekSearchWorkbenchProjection,
  type CodekSearchWorkbenchTextSearchRequest,
} from "../vscode-adapter/workbench/contrib/search/searchWorkbenchService"
import type { CodekSearchFileMatch } from "../vscode-adapter/workbench/contrib/search/searchModel"

interface SemanticMatch {
  path: string
  score: number
  snippet: string
  symbols?: string[]
}

type SearchTab = "text" | "semantic"
const activeTab = ref<SearchTab>("text")
const semanticMatches = ref<SemanticMatch[]>([])

interface Props {
  visible: boolean
  projectRoot: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: "close"): void
  (e: "openFile", path: string, line: number, column: number): void
}>()

const query = ref("")
const searchSettings = getSearchSettings(settingsStore.getAll())
const include = ref(searchSettings.include.join(", "))
const exclude = ref(searchSettings.exclude.join(", "))
const regex = ref(false)
const caseSensitive = ref(false)
const wholeWord = ref(false)
const loading = ref(false)
const truncated = ref(false)
const error = ref<string | null>(null)
const textResultTree = ref<CodekSearchFileMatch[]>([])
const progressMessage = ref("")
let activeSearch:
  | {
    cancel?: () => void
  }
  | null = null
let activeSearchRunId = 0

const grouped = computed(() => {
  return textResultTree.value.map((group) => ({
    path: group.path,
    list: group.matches.map((match) => ({
      path: group.path,
      line: match.line,
      column: match.column,
      matchLength: match.matchLength,
      preview: match.text,
      previewParts: createSearchPreviewParts(match.text, {
        line: match.line,
        column: match.column,
        matchLength: match.matchLength,
      }),
    })),
  }))
})

async function runSemanticSearch(): Promise<void> {
  if (!props.projectRoot || !query.value.trim()) {
    semanticMatches.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const results = (await retrieveRelevantFiles(query.value, {
      projectRoot: props.projectRoot,
      maxResults: 20,
      rerank: true,
    })) as SemanticMatch[]
    semanticMatches.value = results
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : "Semantic search failed"
    semanticMatches.value = []
  } finally {
    loading.value = false
  }
}

async function runSearch(): Promise<void> {
  if (activeTab.value === "semantic") {
    cancelSearch()
    await runSemanticSearch()
    return
  }
  if (!props.projectRoot || !query.value.trim()) {
    textResultTree.value = []
    truncated.value = false
    error.value = null
    return
  }
  activeSearch?.cancel?.()
  const runId = activeSearchRunId + 1
  activeSearchRunId = runId
  loading.value = true
  error.value = null
  truncated.value = false
  progressMessage.value = ""
  try {
    const request = {
      root: props.projectRoot,
      query: query.value,
      include: parseSearchPatternInput(include.value),
      exclude: parseSearchPatternInput(exclude.value),
      regex: regex.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      maxResults: 1000,
      includeContentForSmallFiles: true,
    }
    const result = await searchTextFiles(request)
    if (activeSearchRunId !== runId) return
    textResultTree.value = result.resultTree
    truncated.value = result.truncated
    error.value = result.error || null
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      progressMessage.value = ""
      return
    }
    error.value = err instanceof Error ? err.message : "Search failed"
    textResultTree.value = []
  } finally {
    if (activeSearchRunId === runId) {
      loading.value = false
      activeSearch = null
    }
  }
}

function cancelSearch(): void {
  activeSearchRunId += 1
  activeSearch?.cancel?.()
  activeSearch = null
  loading.value = false
  progressMessage.value = ""
}

async function searchTextFiles(request: CodekSearchWorkbenchTextSearchRequest): Promise<CodekSearchWorkbenchProjection> {
  const source = new CancellationTokenSource()
  activeSearch = {
    cancel: () => source.cancel(),
  }
  try {
    return await globalSearchWorkbenchService.textSearch(request, source.token, (progress) => {
      if (typeof progress?.message === "string") progressMessage.value = progress.message
    })
  } finally {
    source.dispose()
  }
}

function onSubmit(e: Event): void {
  e.preventDefault()
  void runSearch()
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      cancelSearch()
      return
    }
    const next = getSearchSettings(settingsStore.getAll())
    include.value = next.include.join(", ")
    exclude.value = next.exclude.join(", ")
  },
)

onBeforeUnmount(() => {
  cancelSearch()
})
</script>

<template>
  <aside v-if="visible" class="search-panel">
    <header class="search-header">
      <span class="search-title">搜索</span>
      <button class="search-close" @click="emit('close')">×</button>
    </header>
    <div class="search-tabs">
      <button
        type="button"
        class="search-tab"
        :class="{ active: activeTab === 'text' }"
        @click="activeTab = 'text'"
      >Text</button>
      <button
        type="button"
        class="search-tab"
        :class="{ active: activeTab === 'semantic' }"
        @click="activeTab = 'semantic'"
        title="Vector + rerank semantic search"
      >Semantic</button>
    </div>
    <form class="search-form" @submit="onSubmit">
      <input
        v-model="query"
        class="search-input"
        type="text"
        placeholder="搜索内容"
        autofocus
      />
      <div class="search-options">
        <button type="button" :class="{ active: caseSensitive }" title="区分大小写" @click="caseSensitive = !caseSensitive">Aa</button>
        <button type="button" :class="{ active: wholeWord }" title="全字匹配" @click="wholeWord = !wholeWord">ab</button>
        <button type="button" :class="{ active: regex }" title="正则" @click="regex = !regex">.*</button>
      </div>
      <input v-model="include" class="search-input small" type="text" placeholder="包含 (例: src/**/*.ts)" />
      <input v-model="exclude" class="search-input small" type="text" placeholder="排除 (例: **/node_modules/**)" />
      <button
        v-if="loading"
        type="button"
        class="search-submit cancel"
        @click="cancelSearch"
      >
        取消
      </button>
      <button v-else type="submit" class="search-submit">
        搜索
      </button>
    </form>
    <div v-if="loading && progressMessage" class="search-progress">{{ progressMessage }}</div>
    <div v-if="error" class="search-error">{{ error }}</div>
    <div v-if="truncated && activeTab === 'text'" class="search-truncated">结果超出上限，已截断</div>
    <div v-if="activeTab === 'semantic'" class="search-results">
      <div
        v-for="(m, idx) in semanticMatches"
        :key="idx"
        class="search-group"
        @click="emit('openFile', m.path, 1, 1)"
      >
        <div class="search-group-header">
          <span class="search-file">{{ m.path }}</span>
          <span class="search-count" :title="`score ${m.score.toFixed(3)}`">{{ m.score.toFixed(2) }}</span>
        </div>
        <div class="search-semantic-snippet">{{ m.snippet }}</div>
        <div v-if="m.symbols && m.symbols.length" class="search-semantic-symbols">
          <span v-for="s in m.symbols" :key="s" class="search-sym">{{ s }}</span>
        </div>
      </div>
      <div v-if="!loading && semanticMatches.length === 0 && query" class="search-empty">没有匹配项</div>
    </div>
    <div v-else class="search-results">
      <div v-for="group in grouped" :key="group.path" class="search-group">
        <div class="search-group-header">
          <span class="search-file">{{ group.path }}</span>
          <span class="search-count">{{ group.list.length }}</span>
        </div>
        <div
          v-for="(m, idx) in group.list"
          :key="idx"
          class="search-match"
          @click="emit('openFile', group.path, m.line, m.column)"
        >
          <span class="search-line">{{ m.line }}</span>
          <span class="search-preview">
            <span>{{ m.previewParts.before }}</span>
            <mark>{{ m.previewParts.hit }}</mark>
            <span>{{ m.previewParts.after }}</span>
          </span>
        </div>
      </div>
      <div v-if="!loading && textResultTree.length === 0 && query" class="search-empty">没有匹配项</div>
    </div>
  </aside>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  height: 100%;
  background: #1a1b1e;
  color: #e5e7eb;
  border-right: 1px solid #2a2c33;
  font-size: 13px;
}
.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #2a2c33;
}
.search-title { font-weight: 600; }
.search-close {
  background: transparent; border: none; color: #9ca3af; font-size: 16px; cursor: pointer;
}
.search-close:hover { color: #fff; }
.search-form {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  border-bottom: 1px solid #2a2c33;
}
.search-input {
  background: #0d0e10; color: #e5e7eb; border: 1px solid #2a2c33;
  border-radius: 4px; padding: 6px 8px; outline: none;
}
.search-input.small { font-size: 12px; padding: 4px 6px; }
.search-tabs {
  display: flex;
  border-bottom: 1px solid #2a2c33;
}
.search-tab {
  flex: 1;
  background: transparent;
  border: none;
  color: #9ca3af;
  font-size: 12px;
  padding: 6px 0;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.search-tab.active { color: #e5e7eb; border-bottom-color: #4c8bf5; }
.search-tab:hover { color: #fff; }
.search-semantic-snippet {
  padding: 4px 12px 8px;
  color: #c2c7cf;
  font-size: 12px;
  white-space: pre-wrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  line-height: 1.4;
}
.search-semantic-symbols {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px 8px;
}
.search-sym {
  font-size: 10px;
  background: #2a2c33;
  color: #9ca3af;
  padding: 1px 6px;
  border-radius: 8px;
}
.search-input:focus { border-color: #2dd4bf; }
.search-options { display: flex; gap: 4px; }
.search-options button {
  background: #0d0e10; color: #9ca3af; border: 1px solid #2a2c33;
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font-family: monospace;
}
.search-options button.active { color: #2dd4bf; border-color: #2dd4bf; }
.search-submit {
  background: #2dd4bf; color: #0d0e10; border: none; border-radius: 4px;
  padding: 6px 10px; cursor: pointer; font-weight: 600;
}
.search-submit:disabled { opacity: 0.6; cursor: default; }
.search-error { color: #f87171; padding: 6px 12px; }
.search-truncated { color: #fbbf24; padding: 4px 12px; font-size: 12px; }
.search-results { flex: 1; overflow-y: auto; padding: 4px 0; }
.search-group { margin-bottom: 4px; }
.search-group-header {
  display: flex; justify-content: space-between;
  padding: 4px 12px; color: #9ca3af; font-size: 12px;
  background: #14151a;
}
.search-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-count { color: #6b7280; }
.search-match {
  display: flex; gap: 8px; padding: 2px 12px;
  cursor: pointer; font-family: monospace; font-size: 12px;
}
.search-match:hover { background: #232529; }
.search-line { color: #6b7280; min-width: 32px; text-align: right; }
.search-preview { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.search-preview mark { background: #2dd4bf; color: #0d0e10; padding: 0 1px; }
.search-empty { color: #6b7280; padding: 12px; text-align: center; }
</style>
