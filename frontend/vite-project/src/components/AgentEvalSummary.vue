<template>
  <div class="agent-eval-summary" data-codek-smoke="agent-eval-summary">
    <div class="eval-head">
      <div>
        <div class="eval-title">评测摘要</div>
        <div class="eval-subtitle">{{ subtitle }}</div>
      </div>
      <div class="eval-actions">
        <button :disabled="busy" data-codek-smoke="run-agent-eval" @click="$emit('run')">
          {{ busy ? "运行中" : "运行评测" }}
        </button>
        <button :disabled="!markdownPath" @click="$emit('open-report')">打开报告</button>
        <div class="task-set-toggle" data-codek-smoke="acceptance-task-set">
          <button
            v-for="option in taskSetOptions"
            :key="option.id"
            type="button"
            :class="{ active: option.id === selectedAcceptanceTaskSet }"
            :title="option.description"
            :disabled="acceptanceBusy"
            @click="$emit('update:acceptance-task-set', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
        <button :disabled="acceptanceBusy" data-codek-smoke="run-acceptance-eval" @click="$emit('run-acceptance', selectedAcceptanceTaskSet)">
          {{ acceptanceBusy ? "验收中" : "运行验收" }}
        </button>
        <button :disabled="!acceptanceMarkdownPath" @click="$emit('open-acceptance-report')">打开验收报告</button>
      </div>
    </div>

    <div v-if="report" class="eval-grid">
      <div>
        <span>总数</span>
        <strong>{{ report.total }}</strong>
      </div>
      <div>
        <span>通过</span>
        <strong>{{ report.passed }}</strong>
      </div>
      <div>
        <span>失败</span>
        <strong>{{ report.failed }}</strong>
      </div>
      <div>
        <span>通过率</span>
        <strong>{{ successRate }}%</strong>
      </div>
    </div>

    <div v-if="markdownPath" class="eval-path" :title="markdownPath">{{ markdownPath }}</div>

    <div v-if="acceptanceReport" class="strategy-comparison" data-codek-smoke="acceptance-matrix-summary">
      <div class="eval-history-title">发布验收矩阵</div>
      <div class="strategy-grid">
        <div>
          <span>检查项</span>
          <strong>{{ acceptanceReport.passed }}/{{ acceptanceReport.total }}</strong>
        </div>
        <div>
          <span>场景</span>
          <strong>{{ acceptanceReport.matrix?.passed || 0 }}/{{ acceptanceReport.matrix?.total || 0 }}</strong>
        </div>
        <div>
          <span>任务集</span>
          <strong>{{ formatAcceptanceTaskSet(acceptanceReport.taskSet) }}</strong>
        </div>
        <div>
          <span>耗时</span>
          <strong>{{ acceptanceReport.durationMs || 0 }}ms</strong>
        </div>
      </div>
      <div v-if="acceptanceComparison" class="strategy-grid comparison-export" data-codek-smoke="acceptance-comparison-export">
        <div>
          <span>检查通过率</span>
          <strong>{{ acceptanceComparison.successRate }}%</strong>
        </div>
        <div>
          <span>场景通过率</span>
          <strong>{{ acceptanceComparison.scenarioPassRate }}%</strong>
        </div>
        <div>
          <span>风险阻断</span>
          <strong>{{ acceptanceComparison.blocked }}</strong>
        </div>
        <div>
          <span>质量门/冲突</span>
          <strong>{{ acceptanceComparison.qualityGateFailures }}/{{ acceptanceComparison.conflictScenarios }}</strong>
        </div>
      </div>
      <div v-if="scenarioGroups.length" class="scenario-groups" data-codek-smoke="acceptance-scenario-groups">
        <div class="eval-history-title">场景分组</div>
        <div class="group-grid">
          <div v-for="group in scenarioGroups" :key="group.category" class="group-chip">
            <span>{{ formatScenarioCategory(group.category) }}</span>
            <strong>{{ group.passed }}/{{ group.total }}</strong>
          </div>
        </div>
      </div>
      <div v-if="acceptanceReport.routerData" class="strategy-grid router-data" data-codek-smoke="acceptance-router-data">
        <div>
          <span>Router 样本</span>
          <strong>{{ acceptanceReport.routerData.totalSamples }}</strong>
        </div>
        <div>
          <span>策略建议</span>
          <strong>{{ formatRouterRecommendation(acceptanceReport.routerData.recommendation) }}</strong>
        </div>
        <div>
          <span>当前对齐</span>
          <strong>{{ acceptanceReport.routerData.shadow?.currentAligned || 0 }}/{{ acceptanceReport.routerData.shadow?.total || 0 }}</strong>
        </div>
        <div>
          <span>候选对齐</span>
          <strong>{{ acceptanceReport.routerData.shadow?.candidateAligned || 0 }}/{{ acceptanceReport.routerData.shadow?.total || 0 }}</strong>
        </div>
      </div>
      <div v-if="acceptanceReport.longTask" class="strategy-grid long-task-summary" data-codek-smoke="acceptance-long-task">
        <div>
          <span>长任务</span>
          <strong>{{ acceptanceReport.longTask.ready ? "通过" : "未通过" }}</strong>
        </div>
        <div>
          <span>内部策略</span>
          <strong>{{ formatRecommendedStrategy(acceptanceReport.longTask.routerDecision?.executionStrategy) }}</strong>
        </div>
        <div>
          <span>阶段/智能体</span>
          <strong>{{ acceptanceReport.longTask.run?.phaseCount || 0 }}/{{ acceptanceReport.longTask.run?.assignmentCount || 0 }}</strong>
        </div>
        <div>
          <span>变更文件</span>
          <strong>{{ acceptanceReport.longTask.run?.filesChanged?.length || 0 }}</strong>
        </div>
      </div>
      <div v-if="acceptanceReport.matrix?.scenarios?.length" class="acceptance-list">
        <div
          v-for="scenario in acceptanceReport.matrix.scenarios"
          :key="scenario.id"
          class="acceptance-row"
          :class="{ failed: !scenario.passed }"
          data-codek-smoke="acceptance-matrix-row"
        >
          <span class="acceptance-name">{{ scenario.label || scenario.id }}</span>
          <span class="acceptance-result">{{ scenario.passed ? "PASS" : "FAIL" }}</span>
          <span>{{ formatScenarioCategory(scenario.category) }}</span>
          <span>{{ formatRecommendedStrategy(scenario.strategy) }}</span>
          <span>{{ formatRunStatus(scenario.status) }}</span>
          <span>{{ formatQualityGate(scenario.qualityGateStatus) }}</span>
          <span>{{ scenario.conflictCount ? `${scenario.conflictCount} 冲突` : "无冲突" }}</span>
        </div>
      </div>
      <div v-if="acceptanceMarkdownPath" class="eval-path" :title="acceptanceMarkdownPath">
        {{ acceptanceMarkdownPath }}
      </div>
    </div>

    <div v-if="acceptanceHistory.length" class="eval-history" data-codek-smoke="acceptance-history-summary">
      <div class="eval-history-title">发布验收历史</div>
      <div class="eval-history-bars">
        <div
          v-for="item in acceptanceHistory.slice(0, 8).reverse()"
          :key="item.id"
          class="eval-history-bar"
          :title="`${new Date(item.createdAt).toLocaleString()} · ${item.successRate}% · ${item.matrix.passed}/${item.matrix.total}`"
        >
          <span :style="{ height: `${Math.max(6, item.successRate)}%` }" />
        </div>
      </div>
      <div class="eval-history-list">
        <div
          v-for="item in acceptanceHistory.slice(0, 5)"
          :key="item.id"
          class="eval-history-row acceptance-history-row"
          data-codek-smoke="acceptance-history-row"
        >
          <span>{{ new Date(item.createdAt).toLocaleTimeString() }}</span>
          <strong>{{ item.successRate }}%</strong>
          <span>{{ formatAcceptanceTaskSet(item.taskSet) }}</span>
          <span>{{ item.matrix.passed }}/{{ item.matrix.total }} 场景</span>
          <button :disabled="!item.markdownPath" @click="$emit('open-acceptance-report', item.markdownPath)">打开</button>
        </div>
      </div>
    </div>

    <div v-if="strategyComparison" class="strategy-comparison">
      <div class="eval-history-title">估算策略对照</div>
      <div class="strategy-grid">
        <div>
          <span>推荐多智能体</span>
          <strong>{{ strategyComparison.recommendedMultiAgent }}</strong>
        </div>
        <div>
          <span>推荐单智能体</span>
          <strong>{{ strategyComparison.recommendedSingleAgent }}</strong>
        </div>
        <div>
          <span>路由一致率</span>
          <strong>{{ strategyComparison.routerAgreementRate }}%</strong>
        </div>
        <div>
          <span>平均得分</span>
          <strong>{{ strategyComparison.averageRecommendedScore }}</strong>
        </div>
      </div>
    </div>

    <div v-if="realRunComparison" class="strategy-comparison">
      <div class="eval-history-title">真实实跑对照</div>
      <div class="strategy-grid">
        <div>
          <span>实跑任务</span>
          <strong>{{ realRunComparison.totalTasks }}</strong>
        </div>
        <div>
          <span>完成 run</span>
          <strong>{{ realRunComparison.completedRuns }}/{{ realRunComparison.totalRuns }}</strong>
        </div>
        <div>
          <span>多智能体胜出</span>
          <strong>{{ realRunComparison.multiAgentWins }}</strong>
        </div>
        <div>
          <span>平均耗时</span>
          <strong>{{ realRunComparison.averageDurationMs }}ms</strong>
        </div>
      </div>
    </div>

    <div v-if="routerCalibration" class="strategy-comparison">
      <div class="eval-history-title">路由校准</div>
      <div class="strategy-grid">
        <div>
          <span>对齐推荐</span>
          <strong>{{ routerCalibration.recommendationAligned }}/{{ routerCalibration.total }}</strong>
        </div>
        <div>
          <span>对齐路由</span>
          <strong>{{ routerCalibration.routerAligned }}/{{ routerCalibration.total }}</strong>
        </div>
        <div>
          <span>待校准</span>
          <strong>{{ routerCalibration.misaligned }}</strong>
        </div>
        <div>
          <span>风险样本</span>
          <strong>{{ routerCalibration.qualityGateFailureTasks + routerCalibration.conflictTasks }}</strong>
        </div>
      </div>
    </div>

    <div v-if="routerShadowEval" class="strategy-comparison">
      <div class="eval-history-title">Router 影子评测</div>
      <div class="strategy-grid">
        <div>
          <span>当前对齐</span>
          <strong>{{ routerShadowEval.currentAligned }}/{{ routerShadowEval.total }}</strong>
        </div>
        <div>
          <span>候选对齐</span>
          <strong>{{ routerShadowEval.candidateAligned }}/{{ routerShadowEval.total }}</strong>
        </div>
        <div>
          <span>改进/退化</span>
          <strong>{{ routerShadowEval.improved }}/{{ routerShadowEval.regressed }}</strong>
        </div>
        <div>
          <span>建议</span>
          <strong>{{ formatShadowRecommendation(routerShadowEval.recommendation) }}</strong>
        </div>
      </div>
    </div>

    <div v-if="history.length" class="eval-history">
      <div class="eval-history-title">历史趋势</div>
      <div class="eval-history-bars">
        <div
          v-for="item in history.slice(0, 8).reverse()"
          :key="item.id"
          class="eval-history-bar"
          :title="`${new Date(item.createdAt).toLocaleString()} · ${item.successRate}%`"
        >
          <span :style="{ height: `${Math.max(6, item.successRate)}%` }" />
        </div>
      </div>
      <div class="eval-history-list">
        <div v-for="item in history.slice(0, 5)" :key="item.id" class="eval-history-row">
          <span>{{ new Date(item.createdAt).toLocaleTimeString() }}</span>
          <strong>{{ item.successRate }}%</strong>
          <span>{{ item.passed }}/{{ item.total }}</span>
          <button :disabled="!item.markdownPath" @click="$emit('open-report', item.markdownPath)">打开</button>
        </div>
      </div>
    </div>

    <div v-if="report?.results?.length" class="eval-task-list">
      <div
        v-for="task in report.results"
        :key="String(task.id)"
        class="eval-task-row"
        :class="{ failed: !task.passed }"
      >
        <span class="eval-task-id">{{ task.id }}</span>
        <span class="eval-task-result">{{ task.passed ? "PASS" : "FAIL" }}</span>
        <span class="eval-task-strategy">{{ formatRecommendedStrategy(task.recommendedStrategy) }}</span>
        <span class="eval-task-reason">{{ task.reason }}</span>
      </div>
    </div>

    <div v-if="!report" class="eval-empty">暂无评测报告</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type {
  AcceptanceReportHistoryItem,
  AcceptanceReportSummary,
  AcceptanceComparisonSummary,
  AcceptanceTaskSetId,
  AcceptanceTaskSetOption,
  EvalReportHistoryItem,
  EvalReportSummary,
} from "../agent/orchestratorClient"

const props = defineProps<{
  report?: EvalReportSummary | null
  history?: EvalReportHistoryItem[]
  markdownPath?: string
  busy?: boolean
  acceptanceReport?: AcceptanceReportSummary | null
  acceptanceHistory?: AcceptanceReportHistoryItem[]
  acceptanceMarkdownPath?: string
  acceptanceBusy?: boolean
  acceptanceTaskSet?: AcceptanceTaskSetId
  acceptanceTaskSets?: AcceptanceTaskSetOption[]
}>()

defineEmits<{
  run: []
  "open-report": [markdownPath?: string]
  "run-acceptance": [taskSet?: AcceptanceTaskSetId]
  "update:acceptance-task-set": [taskSet: AcceptanceTaskSetId]
  "open-acceptance-report": [markdownPath?: string]
}>()

const successRate = computed(() => {
  const total = props.report?.total || 0
  return total ? Math.round(((props.report?.passed || 0) / total) * 100) : 0
})

const strategyComparison = computed(() => props.report?.strategyComparison || null)
const realRunComparison = computed(() => props.report?.realRunComparison || null)
const routerCalibration = computed(() => props.report?.routerCalibration || null)
const routerShadowEval = computed(() => props.report?.routerShadowEval || null)
const acceptanceComparison = computed<AcceptanceComparisonSummary | null>(() => {
  const report = props.acceptanceReport
  if (!report) return null
  if (report.comparison) return report.comparison
  const scenarios = report.matrix?.scenarios || []
  const matrixTotal = report.matrix?.total || 0
  return {
    taskSet: report.taskSet || "standard",
    ready: Boolean(report.ready),
    successRate: report.total ? Math.round(((report.passed || 0) / report.total) * 100) : 0,
    scenarioPassRate: matrixTotal ? Math.round(((report.matrix?.passed || 0) / matrixTotal) * 100) : 0,
    blocked: scenarios.filter((item) => !item.passed || item.status === "waiting_user").length,
    qualityGateFailures: scenarios.filter((item) => item.qualityGateStatus === "failed").length,
    conflictScenarios: scenarios.filter((item) => Number(item.conflictCount || 0) > 0).length,
    mainFlow: null,
  }
})
const scenarioGroups = computed(() => {
  const groups = new Map<string, { category: string; total: number; passed: number }>()
  for (const scenario of props.acceptanceReport?.matrix?.scenarios || []) {
    const category = scenario.category || "general"
    const current = groups.get(category) || { category, total: 0, passed: 0 }
    current.total += 1
    if (scenario.passed) current.passed += 1
    groups.set(category, current)
  }
  return Array.from(groups.values())
})

const subtitle = computed(() => {
  if (!props.report?.createdAt) return "multi-agent baseline"
  return new Date(props.report.createdAt).toLocaleString()
})

const history = computed(() => props.history || [])
const acceptanceHistory = computed(() => props.acceptanceHistory || [])
const selectedAcceptanceTaskSet = computed<AcceptanceTaskSetId>(() => props.acceptanceTaskSet || props.acceptanceReport?.taskSet || "standard")
const taskSetOptions = computed<AcceptanceTaskSetOption[]>(() => {
  if (props.acceptanceTaskSets?.length) return props.acceptanceTaskSets
  return [
    { id: "standard", label: "标准", description: "完整发布验收" },
    { id: "quick", label: "快速", description: "开发态快速回归" },
    { id: "risk", label: "风险", description: "质量门、冲突和恢复动作" },
  ]
})

function formatAcceptanceTaskSet(value?: string) {
  if (value === "quick") return "快速"
  if (value === "risk") return "风险"
  return "标准"
}

function formatRecommendedStrategy(value: unknown) {
  if (value === "multi-agent") return "推荐多智能体"
  if (value === "single-agent") return "推荐单智能体"
  return "未评估"
}
function formatRunStatus(value: string) {
  if (value === "completed") return "完成"
  if (value === "waiting_user") return "等待确认"
  if (value === "running") return "运行中"
  if (value === "failed") return "失败"
  if (value === "blocked") return "已阻断"
  return value || "-"
}
function formatQualityGate(value: string) {
  if (value === "passed") return "质量门通过"
  if (value === "failed") return "质量门阻断"
  if (value === "not_run") return "未运行"
  if (value === "not_applicable") return "不适用"
  return value || "-"
}
function formatShadowRecommendation(value: string) {
  if (value === "candidate-improves-shadow") return "候选更优"
  if (value === "candidate-regresses-shadow") return "保留当前"
  if (value === "needs-more-samples") return "需要更多样本"
  return "继续观察"
}
function formatScenarioCategory(value?: string) {
  if (value === "ui") return "UI"
  if (value === "backend") return "后端"
  if (value === "settings") return "设置"
  if (value === "extensions") return "扩展"
  if (value === "refactor") return "重构"
  if (value === "risk") return "风险"
  return "通用"
}
function formatRouterRecommendation(value?: string) {
  if (value === "switch-candidate-router") return "候选可切换"
  if (value === "needs-more-samples") return "需要更多样本"
  return "保留当前"
}
</script>

<style scoped>
.agent-eval-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.eval-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.eval-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 700;
}

.eval-subtitle,
.eval-empty,
.eval-path {
  color: var(--text-muted);
  font-size: 12px;
}

button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.eval-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.task-set-toggle {
  display: inline-flex;
  height: 26px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.task-set-toggle button {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.task-set-toggle button.active {
  background: var(--accent);
  color: var(--bg-dark);
}

.eval-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.eval-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.strategy-comparison {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.strategy-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.comparison-export {
  margin-top: 2px;
}

.strategy-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.strategy-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.strategy-grid strong {
  color: var(--text-bright);
  font-size: 14px;
}

.eval-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.eval-grid strong {
  color: var(--text-bright);
  font-size: 14px;
}

.eval-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-task-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.acceptance-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.acceptance-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) 44px 42px 82px 70px 86px 56px;
  gap: 7px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
}

.scenario-groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 78px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
}

.group-chip strong {
  color: var(--text-bright);
}

.acceptance-row.failed {
  border-color: rgba(248, 113, 113, 0.45);
}

.acceptance-name,
.acceptance-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acceptance-result {
  color: var(--text-secondary);
  font-weight: 700;
}

.acceptance-row.failed .acceptance-result {
  color: var(--red);
}

.eval-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.eval-history-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.eval-history-bars {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  align-items: end;
  gap: 5px;
  height: 46px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.eval-history-bar {
  display: flex;
  align-items: end;
  height: 100%;
}

.eval-history-bar span {
  width: 100%;
  min-height: 6px;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
}

.eval-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.eval-history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px 48px 46px;
  gap: 8px;
  align-items: center;
  color: var(--text-muted);
  font-size: 11px;
}

.acceptance-history-row {
  grid-template-columns: minmax(0, 1fr) 44px 36px 48px 46px;
}

.eval-history-row strong {
  color: var(--text-bright);
}

.eval-history-row button {
  height: 22px;
  padding: 0 7px;
  font-size: 11px;
}

.eval-task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 46px 76px minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
}

.eval-task-row.failed {
  border-color: rgba(248, 113, 113, 0.45);
}

.eval-task-id,
.eval-task-strategy,
.eval-task-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-task-strategy {
  color: var(--text-secondary);
}

.eval-task-result {
  color: var(--text-secondary);
  font-weight: 700;
}

.eval-task-row.failed .eval-task-result {
  color: var(--red);
}
</style>
