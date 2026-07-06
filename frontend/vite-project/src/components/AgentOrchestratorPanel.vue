<template>
  <div class="orchestrator-panel" data-codek-smoke="orchestrator-panel">
    <div class="orchestrator-header">
      <div>
        <div class="panel-title">任务中心</div>
        <div class="panel-subtitle">自动路由、执行记录、工件和决策审计</div>
      </div>
      <button class="refresh-btn" data-codek-smoke="orchestrator-refresh" @click="() => refresh()">刷新</button>
    </div>

    <div class="orchestrator-summary">
      <div class="summary-card">
        <span>活跃任务</span>
        <strong>{{ activeRunCount }}</strong>
      </div>
      <div class="summary-card">
        <span>待复核</span>
        <strong>{{ warningRunCount }}</strong>
      </div>
      <div class="summary-card">
        <span>最近更新</span>
        <strong :title="latestRunUpdatedAtLabel">{{ latestRunUpdatedAtLabel }}</strong>
      </div>
    </div>

    <div class="run-list">
      <button
        v-for="run in runs"
        :key="run.id"
        class="run-row"
        data-codek-smoke="orchestrator-run-row"
        :data-codek-run-id="run.id"
        :class="{ active: run.id === selectedRunId }"
        @click="selectRun(run.id)"
      >
        <span :title="run.executionStrategy">{{ formatStrategy(run.executionStrategy) }}</span>
        <span :title="localizeRunDisplayText(run.runtimeReason || run.status)">{{ formatRunStatus(run) }}</span>
      </button>
      <div v-if="runs.length === 0" class="empty">暂无任务记录</div>
    </div>

    <div v-if="selectedRun" class="run-detail">
      <div class="run-summary">
        <span :title="selectedRun.visibleMode">{{ formatVisibleMode(selectedRun.visibleMode) }}</span>
        <span>{{ localizeRunDisplayText(selectedRun.strategyReason) }}</span>
      </div>

      <div class="agent-observable-panel" data-codek-smoke="agent-observable-panel">
        <div class="agent-observable-head">
          <div>
            <div class="agent-observable-title">{{ agentObservableDisplay.summary.title }}</div>
            <div class="agent-observable-subtitle">{{ agentObservableDisplay.summary.detail }}</div>
          </div>
          <span class="agent-observable-status" :class="agentObservableDisplay.summary.severity">
            {{ agentObservableDisplay.summary.statusLabel }}
          </span>
        </div>
        <div class="agent-observable-next">{{ agentObservableDisplay.summary.nextAction }}</div>
        <div class="agent-observable-badges">
          <span
            v-for="badge in agentObservableDisplay.statusBadges"
            :key="badge.id"
            :class="badge.severity"
            :title="badge.detail"
          >
            {{ badge.label }} · {{ badge.statusLabel }}
          </span>
        </div>
        <div class="agent-observable-grid">
          <section>
            <h4>阶段与智能体</h4>
            <div
              v-for="row in agentObservableDisplay.stageRows"
              :key="row.id"
              class="agent-observable-row"
              :class="row.severity"
            >
              <span>{{ row.label }}</span>
              <strong>{{ row.statusLabel }}</strong>
              <small :title="row.detail">{{ row.detail }}</small>
            </div>
          </section>
          <section>
            <h4>实时活动</h4>
            <div
              v-for="row in agentObservableDisplay.activityRows"
              :key="row.id"
              class="agent-observable-row"
              :class="row.severity"
            >
              <span>{{ row.label }}</span>
              <strong>{{ row.statusLabel }}</strong>
              <small :title="row.detail">{{ row.detail }}</small>
            </div>
          </section>
        </div>
        <div class="agent-observable-actions">
          <div
            v-for="row in agentObservableDisplay.actionRows"
            :key="row.id"
            class="agent-observable-action"
            :class="row.severity"
          >
            <span>{{ row.label }}</span>
            <strong>{{ row.statusLabel }}</strong>
            <small :title="row.nextAction || row.detail">{{ row.nextAction || row.detail }}</small>
          </div>
        </div>
      </div>

      <div class="enterprise-control-panel" data-codek-smoke="orchestrator-run-control">
        <div class="enterprise-control-head">
          <div>
            <div class="enterprise-control-title">企业运行控制台</div>
            <div class="enterprise-control-subtitle">{{ enterpriseRunControlSummary }}</div>
          </div>
        </div>
        <div class="enterprise-control-steps">
          <div
            v-for="step in enterpriseRunControlSteps"
            :key="step.id"
            class="enterprise-control-step"
            :class="step.status"
          >
            <span>{{ step.title }}</span>
            <strong>{{ step.statusLabel }}</strong>
            <small :title="step.detail">{{ step.detail }}</small>
          </div>
        </div>
        <div class="enterprise-control-action" data-codek-smoke="orchestrator-run-primary-action">
          <div>
            <span>主操作</span>
            <strong>{{ enterpriseRunPrimaryAction.detail }}</strong>
            <small
              :class="{ blocked: enterpriseRunPrimaryAction.disabled }"
              :title="enterpriseRunPrimaryAction.disabledReason"
              data-codek-smoke="orchestrator-run-primary-disabled-reason"
            >
              {{ enterpriseRunPrimaryAction.disabledReason }}
            </small>
          </div>
          <button
            type="button"
            :title="enterpriseRunPrimaryAction.disabledReason"
            :disabled="enterpriseRunPrimaryAction.disabled"
            @click="handleEnterprisePrimaryAction"
          >
            {{ enterpriseRunPrimaryAction.label }}
          </button>
        </div>
        <div
          class="enterprise-control-feedback"
          :class="enterpriseRunActionFeedback.status"
          data-codek-smoke="orchestrator-run-action-feedback"
        >
          <span>{{ enterpriseRunActionFeedback.title }}</span>
          <strong :title="enterpriseRunActionFeedback.detail">{{ enterpriseRunActionFeedback.detail }}</strong>
          <small v-if="enterpriseRunActionFeedback.at">{{ new Date(enterpriseRunActionFeedback.at).toLocaleString() }}</small>
        </div>
        <div class="enterprise-control-audit" data-codek-smoke="orchestrator-run-action-audit">
          <span>最近主操作</span>
          <strong :title="latestRunActionAuditTitle">{{ latestRunActionAuditTitle }}</strong>
        </div>
      </div>

      <div class="decision-audit" data-codek-smoke="orchestrator-router-decision">
        <div class="decision-audit-title">路由决策</div>
        <div class="decision-audit-grid">
          <span>策略</span>
          <strong>{{ formatStrategy(selectedRun.executionStrategy) }}</strong>
          <span>风险</span>
          <strong>{{ formatRisk(selectedRun.strategySignals?.risk) }}</strong>
          <span>原因</span>
          <strong>{{ selectedRun.strategyReason || "未记录" }}</strong>
          <span>当前状态</span>
          <strong>{{ selectedRun.runtimeReason || selectedRun.blockingReason || formatRunStatus(selectedRun) }}</strong>
          <span v-if="selectedRun.runtimeStatus">运行状态</span>
          <strong v-if="selectedRun.runtimeStatus">{{ formatRunStatus(selectedRun) }}</strong>
          <span>项目类型</span>
          <strong>{{ selectedRun.projectKindLabel || formatProjectKind(selectedRun.projectKind) }}</strong>
          <span>写入模式</span>
          <strong>{{ selectedRun.writeModeLabel || formatWriteMode(selectedRun.writeMode) }}</strong>
        </div>
        <div v-if="matchedSignals.length" class="decision-signals">
          <span v-for="signal in matchedSignals" :key="signal">{{ signal }}</span>
        </div>
      </div>

      <div class="context-evidence-panel" data-codek-smoke="orchestrator-context-evidence">
        <div class="context-evidence-head">
          <div>
            <div class="context-evidence-title">代码库上下文</div>
            <div class="context-evidence-subtitle">{{ contextEvidenceSubtitle }}</div>
          </div>
          <span
            :class="{
              ready: contextEvidenceReady,
              warning: selectedRun.contextEvidence && !contextEvidenceReady,
            }"
          >
            {{ contextEvidenceStatusLabel }}
          </span>
        </div>
        <div v-if="selectedRun.contextEvidence" class="context-evidence-grid">
          <div>
            <span>来源</span>
            <strong>{{ selectedRun.contextEvidence.budget.totalSources }}</strong>
          </div>
          <div>
            <span>工作区</span>
            <strong>{{ selectedRun.contextEvidence.workspaceSources.length }}</strong>
          </div>
          <div>
            <span>提及</span>
            <strong>{{ selectedRun.contextEvidence.mentions.length }}</strong>
          </div>
          <div>
            <span>规则</span>
            <strong>{{ selectedRun.contextEvidence.rules.length }}</strong>
          </div>
          <div>
            <span>截断</span>
            <strong>{{ selectedRun.contextEvidence.budget.truncatedSources }}</strong>
          </div>
          <div>
            <span>告警</span>
            <strong>{{ selectedRun.contextEvidence.warnings.length }}</strong>
          </div>
        </div>
        <div v-if="selectedRun.contextEvidence" class="context-evidence-grid secondary">
          <div>
            <span>索引</span>
            <strong :title="contextEvidenceIndexTitle">{{ contextEvidenceIndexLabel }}</strong>
          </div>
          <div>
            <span>预算</span>
            <strong :title="contextEvidenceBudgetTitle">{{ contextEvidenceBudgetLabel }}</strong>
          </div>
          <div>
            <span>任务类型</span>
            <strong>{{ formatContextTaskType(selectedRun.contextEvidence.budget.policy?.taskType) }}</strong>
          </div>
          <div>
            <span>风险</span>
            <strong>{{ formatContextRiskLevel(selectedRun.contextEvidence.budget.policy?.riskLevel) }}</strong>
          </div>
        </div>
        <div v-if="contextEvidenceSourceRows.length" class="context-evidence-source-list">
          <div
            v-for="source in contextEvidenceSourceRows"
            :key="source.id"
            class="context-evidence-source-row"
            :class="{ warning: source.truncated }"
          >
            <span>{{ source.type }}</span>
            <strong :title="source.title">{{ source.label }}</strong>
            <small>{{ source.meta }}</small>
          </div>
        </div>
        <div v-if="!selectedRun.contextEvidence" class="context-evidence-empty">
          当前任务尚未记录上下文证据。请从智能助手发起一次智能体任务，确认提及、规则、工作区来源和索引状态已进入证据链。
        </div>
      </div>

      <div class="decision-log-panel" data-codek-smoke="orchestrator-decision-log">
        <div class="decision-log-head">
          <div>
            <div class="decision-log-title">决策记录</div>
            <div class="decision-log-subtitle">{{ decisionLogSummary }}</div>
          </div>
          <button
            type="button"
            data-codek-smoke="run-task-report"
            :disabled="taskReportBusy"
            @click="handleLoadTaskReport"
          >
            任务报告
          </button>
          <button
            type="button"
            data-codek-smoke="save-run-task-report"
            :disabled="taskReportBusy || !selectedRunId"
            @click="handleSaveTaskReport"
          >
            保存报告
          </button>
        </div>
        <div v-if="taskReportSavedPath" class="task-report-saved" data-codek-smoke="run-task-report-saved">
          <span>已保存</span>
          <strong :title="taskReportSavedPath">{{ taskReportSavedPath }}</strong>
        </div>
        <div v-if="taskReportMarkdown" class="task-report-preview" data-codek-smoke="run-task-report-preview">
          <div class="task-report-title">中文任务报告</div>
          <pre>{{ taskReportMarkdown }}</pre>
        </div>
        <div v-if="decisionLog.length === 0" class="decision-log-empty">暂无决策记录</div>
        <div v-for="entry in decisionLog.slice(0, 6)" :key="entry.id" class="decision-log-row">
          <div class="decision-log-row-head">
            <span>{{ formatDecisionType(entry.type) }}</span>
            <strong>{{ formatDecisionStatus(entry.status) }}</strong>
          </div>
          <div class="decision-log-reason">{{ entry.reason || entry.blockingReason || "未记录原因" }}</div>
          <div class="decision-log-meta">
            <span v-if="entry.selectedOption">选择: {{ formatDecisionOption(entry.selectedOption) }}</span>
            <span v-if="entry.risk">风险: {{ formatRisk(entry.risk) }}</span>
            <span>{{ entry.userConfirmed ? "用户已确认" : "未确认" }}</span>
          </div>
        </div>
      </div>

      <div v-if="selectedRun.permissionRequest" class="permission-panel" data-codek-smoke="orchestrator-permission-request">
        <div class="permission-head">
          <div>
            <div class="permission-title">沙箱权限</div>
            <div class="permission-subtitle">{{ formatPermissionStatus(selectedRun.permissionRequest.status) }}</div>
          </div>
          <span class="permission-risk">{{ formatRisk(selectedRun.permissionRequest.risk) }}</span>
        </div>
        <div class="permission-reason">{{ selectedRun.permissionRequest.reason }}</div>
        <div class="permission-grid">
          <span>读取</span>
          <strong>{{ formatList(selectedRun.permissionRequest.readPaths) }}</strong>
          <span>写入</span>
          <strong>{{ formatList(selectedRun.permissionRequest.writePaths) }}</strong>
          <span>命令</span>
          <strong>{{ formatList(selectedRun.permissionRequest.commandAllowlist) }}</strong>
          <span>网络</span>
          <strong>{{ selectedRun.permissionRequest.network ? "需要" : "不需要" }}</strong>
          <span>安装</span>
          <strong>{{ selectedRun.permissionRequest.install ? "可能需要" : "不需要" }}</strong>
          <span>破坏性</span>
          <strong>{{ selectedRun.permissionRequest.destructive ? "包含" : "不包含" }}</strong>
        </div>
        <div v-if="selectedRun.permissionRequest.status === 'waiting_user'" class="permission-actions">
          <button data-codek-smoke="permission-approve" :disabled="permissionBusy" @click="handlePermission('approved')">允许</button>
          <button data-codek-smoke="permission-reject" class="danger" :disabled="permissionBusy" @click="handlePermission('rejected')">拒绝</button>
        </div>
      </div>

      <div v-if="commandAuthorization" class="command-auth-panel" data-codek-smoke="command-authorization-panel">
        <div class="command-auth-head">
          <div>
            <div class="command-auth-title">命令授权</div>
            <div class="command-auth-subtitle">{{ commandAuthorizationSummary }}</div>
          </div>
          <span :class="{ danger: !commandAuthorization.ok }">{{ commandAuthorization.ok ? "通过" : "需处理" }}</span>
        </div>
        <div v-if="commandAuthorization.commands.length" class="command-auth-list">
          <div
            v-for="item in commandAuthorization.commands"
            :key="item.command"
            class="command-auth-row"
            :class="{ danger: item.status === 'blocked', warning: item.status === 'needs_permission' }"
          >
            <span :title="item.command">{{ item.command }}</span>
            <strong>{{ formatCommandStatus(item.status) }}</strong>
            <em>{{ formatCommandCapabilities(item.capabilities) }}</em>
            <small>{{ formatList(item.reasons) }}</small>
          </div>
        </div>
        <div v-else class="command-auth-empty">暂无质量门命令</div>
      </div>

      <div class="readiness-panel" data-codek-smoke="orchestrator-readiness-panel">
        <div class="readiness-head">
          <div>
            <div class="readiness-title">企业级运行预检</div>
            <div class="readiness-subtitle">{{ orchestratorReadinessSubtitle }}</div>
          </div>
          <span
            :class="{
              ready: orchestratorReadiness?.ready,
              warning: orchestratorReadiness?.status === 'degraded',
              danger: orchestratorReadiness?.status === 'blocked',
            }"
          >
            {{ orchestratorReadiness?.statusLabel || "待刷新" }}
          </span>
        </div>
        <div class="readiness-actions">
          <button
            type="button"
            data-codek-smoke="orchestrator-readiness-defaults"
            :disabled="orchestratorReadinessBusy || !selectedRun.projectRoot"
            @click="applyReadinessSafeDefaults"
          >
            应用安全默认配置
          </button>
          <button
            type="button"
            data-codek-smoke="orchestrator-readiness-refresh"
            :disabled="orchestratorReadinessBusy || !selectedRun.projectRoot"
            @click="() => refreshOrchestratorReadiness({ writeLatest: true })"
          >
            {{ orchestratorReadinessBusy ? "刷新中" : "刷新预检" }}
          </button>
        </div>
        <div v-if="orchestratorReadiness" class="readiness-grid">
          <div>
            <span>检查项</span>
            <strong>{{ orchestratorReadiness.summary.passed }}/{{ orchestratorReadiness.summary.total }}</strong>
          </div>
          <div>
            <span>需处理</span>
            <strong>{{ orchestratorReadiness.summary.warning }}</strong>
          </div>
          <div>
            <span>阻断</span>
            <strong>{{ orchestratorReadiness.summary.failed }}</strong>
          </div>
          <div>
            <span>下一步</span>
            <strong :title="orchestratorReadiness.nextAction">{{ orchestratorReadiness.nextAction }}</strong>
          </div>
        </div>
        <div v-if="orchestratorReadiness?.checks?.length" class="readiness-check-list">
          <div
            v-for="check in orchestratorReadiness.checks.slice(0, 5)"
            :key="check.id"
            class="readiness-check-row"
            :class="{ failed: check.status === 'failed', warning: check.status === 'warning' }"
          >
            <span>{{ check.title }}</span>
            <strong>{{ check.statusLabel }}</strong>
            <small>{{ check.detail }}</small>
          </div>
        </div>
        <div class="readiness-check-list" data-codek-smoke="orchestrator-readiness-remediations">
          <div
            v-for="action in (orchestratorReadiness?.remediations || []).slice(0, 4)"
            :key="action.id"
            class="readiness-check-row remediation"
            :class="{ failed: action.risk === 'high', warning: action.risk === 'medium' }"
          >
            <span>{{ action.title }}</span>
            <strong>{{ action.canApplyInUi ? "可执行" : "人工" }}</strong>
            <small>{{ action.detail }}</small>
          </div>
          <div v-if="!orchestratorReadiness?.remediations?.length" class="readiness-check-row">
            <span>暂无修复建议</span>
            <strong>已处理</strong>
            <small>当前预检没有失败或告警对应的结构化建议。</small>
          </div>
        </div>
        <div class="readiness-audit" data-codek-smoke="orchestrator-readiness-audit">
          <span>最近修复</span>
          <strong :title="latestReadinessAuditTitle">{{ latestReadinessAuditTitle }}</strong>
        </div>
        <div v-if="orchestratorReadinessPath" class="readiness-path" :title="orchestratorReadinessPath">
          {{ orchestratorReadinessPath }}
        </div>
        <div v-if="!orchestratorReadiness" class="readiness-empty">
          预检会按当前 run 的项目、变更文件、工作区设置和真实试运行安全边界计算，不会自动启动任务。
        </div>
      </div>

      <div class="real-trial-panel" data-codek-smoke="real-workspace-trial-panel">
        <div class="real-trial-head">
          <div>
            <div class="real-trial-title">真实工作区试运行</div>
            <div class="real-trial-subtitle">{{ realTrialSubtitle }}</div>
          </div>
          <span :class="{ ready: realTrialMainWorkspaceUntouched === '确认未写入', danger: realTrialMainWorkspaceUntouched === '需复核' }">
            {{ realTrialWriteMode }}
          </span>
        </div>
        <div class="real-trial-actions">
          <button
            type="button"
            data-codek-smoke="real-workspace-trial-run"
            :disabled="realTrialBusy || !selectedRun.projectRoot"
            @click="handleStartRealWorkspaceTrial"
          >
            {{ realTrialBusy ? "试运行中" : "以当前项目试运行" }}
          </button>
        </div>
        <div class="real-trial-grid">
          <div>
            <span>项目</span>
            <strong :title="selectedRun.projectRoot">{{ selectedRun.projectRoot }}</strong>
          </div>
          <div>
            <span>文件范围</span>
            <strong>{{ formatList(realTrialAllowedPaths) }}</strong>
          </div>
          <div>
            <span>质量门</span>
            <strong>{{ formatList(realTrialQualityGateCommands) }}</strong>
          </div>
          <div>
            <span>阻断命令</span>
            <strong>{{ formatList(realTrialBlockedCommands) }}</strong>
          </div>
          <div>
            <span>主工作区</span>
            <strong>{{ realTrialMainWorkspaceUntouched }}</strong>
          </div>
          <div>
            <span>回滚</span>
            <strong>{{ realTrialRollbackState }}</strong>
          </div>
        </div>
      </div>

      <div class="delivery-trust-panel" data-codek-smoke="delivery-trust-summary">
        <div class="delivery-trust-head">
          <div>
            <div class="delivery-trust-title">可信交付</div>
            <div class="delivery-trust-subtitle">{{ deliveryTrustSubtitle }}</div>
          </div>
          <span
            :class="{
              ready: deliveryTrustStatus === 'trusted',
              warning: deliveryTrustStatus === 'review',
              danger: deliveryTrustStatus === 'blocked',
            }"
          >
            {{ deliveryTrustStatusLabel }}
          </span>
        </div>
        <div class="delivery-trust-grid">
          <div>
            <span>可信分数</span>
            <strong>{{ deliveryTrustScoreLabel }}</strong>
          </div>
          <div>
            <span>Router</span>
            <strong>{{ deliveryTrustRouterState }}</strong>
          </div>
          <div>
            <span>工作区</span>
            <strong>{{ deliveryTrustWorkspaceState }}</strong>
          </div>
          <div>
            <span>质量门</span>
            <strong>{{ deliveryTrustQualityGateState }}</strong>
          </div>
        </div>
        <div class="delivery-trust-next">
          <span>下一步</span>
          <strong :title="deliveryTrustNextAction">{{ deliveryTrustNextAction }}</strong>
        </div>
        <div class="delivery-trust-list">
          <div
            v-for="item in deliveryTrustEvidenceRows"
            :key="item.id"
            class="delivery-trust-row"
            :class="{ risk: item.kind === 'risk' }"
          >
            <span>{{ item.kind === "risk" ? "风险" : "证据" }}</span>
            <strong :title="item.text">{{ item.text }}</strong>
          </div>
        </div>
      </div>

      <AgentEvalSummary
        v-if="showEvalSummary"
        :report="evalReport"
        :history="evalHistory"
        :markdown-path="evalMarkdownPath"
        :busy="evalBusy"
        :acceptance-report="acceptanceReport"
        :acceptance-history="acceptanceHistory"
        :acceptance-markdown-path="acceptanceMarkdownPath"
        :acceptance-busy="acceptanceBusy"
        :acceptance-task-set="acceptanceTaskSet"
        :acceptance-task-sets="acceptanceTaskSets"
        @run="handleRunEval"
        @open-report="handleOpenEvalReport"
        @run-acceptance="handleRunAcceptance"
        @update:acceptance-task-set="acceptanceTaskSet = $event"
        @open-acceptance-report="handleOpenAcceptanceReport"
      />

      <div class="release-gate-panel" data-codek-smoke="release-gate-panel">
        <div class="release-gate-head">
          <div>
            <div class="release-gate-title">发布质量门</div>
            <div class="release-gate-subtitle">{{ releaseGateSubtitle }}</div>
          </div>
          <span v-if="releaseGateReport" :class="{ ready: releaseGateReport.ready, danger: !releaseGateReport.ready }">
            {{ releaseGateReport.ready ? "就绪" : "需处理" }}
          </span>
        </div>
        <div class="release-gate-actions" data-codek-smoke="release-gate-actions">
          <button type="button" :disabled="releaseGateBusy" @click="handleRunReleaseGate('quick')">
            {{ releaseGateBusy && releaseGateMode === "quick" ? "运行中" : "快速门" }}
          </button>
          <button type="button" :disabled="releaseGateBusy" @click="handleRunReleaseGate('build')">
            {{ releaseGateBusy && releaseGateMode === "build" ? "运行中" : "构建门" }}
          </button>
          <button type="button" :disabled="releaseGateBusy" @click="handleRunReleaseGate('full')">
            {{ releaseGateBusy && releaseGateMode === "full" ? "运行中" : "完整门" }}
          </button>
        </div>
        <div v-if="releaseGateReport" class="release-gate-grid" data-codek-smoke="release-gate-summary">
          <div>
            <span>模式</span>
            <strong>{{ formatReleaseGateMode(releaseGateReport.mode) }}</strong>
          </div>
          <div>
            <span>步骤</span>
            <strong>{{ releaseGatePassedSteps }}/{{ releaseGateTotalSteps }}</strong>
          </div>
          <div>
            <span>耗时</span>
            <strong>{{ releaseGateReport.durationMs || 0 }}ms</strong>
          </div>
          <div>
            <span>告警</span>
            <strong>{{ releaseGateReport.warnings?.length || 0 }}</strong>
          </div>
        </div>
        <div v-if="releaseGateReport?.steps?.length" class="release-gate-steps">
          <div
            v-for="step in releaseGateReport.steps"
            :key="step.id"
            class="release-gate-step"
            :class="{ failed: !step.passed }"
            data-codek-smoke="release-gate-step"
          >
            <span>{{ step.label || step.id }}</span>
            <strong>{{ step.passed ? "通过" : "失败" }}</strong>
            <small :title="step.command">{{ step.command }}</small>
          </div>
        </div>
        <div v-if="releaseGateFirstWarning" class="release-gate-warning">{{ releaseGateFirstWarning }}</div>
        <div v-if="releaseGateJsonPath" class="release-gate-path" :title="releaseGateJsonPath">{{ releaseGateJsonPath }}</div>
      </div>

      <AgentRunTimeline :events="selectedRun.events || []" />

      <div v-if="selectedRun.recoveryRecommendation" class="recovery-recommendation" data-codek-smoke="recovery-recommendation">
        <div>
          <div class="recovery-recommendation-title">推荐恢复动作</div>
          <div class="recovery-recommendation-subtitle">
            {{ formatRecoveryRecommendation(selectedRun.recoveryRecommendation.action) }}
          </div>
        </div>
        <p>{{ selectedRun.recoveryRecommendation.reason }}</p>
      </div>

      <div class="checkpoint-panel" data-codek-smoke="orchestrator-checkpoints">
        <div class="checkpoint-head">
          <div>
            <div class="checkpoint-title">检查点</div>
            <div class="checkpoint-subtitle">{{ checkpointSummary }}</div>
          </div>
          <button
            type="button"
            :disabled="checkpointBusy || !latestCheckpoint?.canResume"
            @click="handleResumeCheckpoint"
          >
            恢复
          </button>
        </div>
        <div v-if="checkpoints.length === 0" class="checkpoint-empty">暂无检查点</div>
        <div v-for="checkpoint in checkpoints.slice(0, 3)" :key="checkpoint.id" class="checkpoint-row">
          <span>{{ formatStatusLabel(checkpoint.stage) }}</span>
          <span>{{ checkpoint.summary || checkpoint.id }}</span>
        </div>
      </div>

      <div class="assignment-grid">
        <AgentAssignmentCard
          v-for="assignment in selectedRun.assignments"
          :key="assignment.id"
          :assignment="assignment"
        />
      </div>

      <IntegrationDecisionDialog
        :decision="selectedRun.integrationDecision"
        :busy="decisionBusy"
        @decide="handleDecision"
      />

      <AgentRecoveryActions
        :actions="recoveryActions"
        :busy="recoveryBusy"
        @execute="handleRecoveryExecute"
      />

      <AgentDiffViewer
        :run-id="selectedRunId"
        :diff="diff"
        :busy="diffBusy"
        @load="loadDiff"
      />

      <AgentArtifactViewer :artifacts="artifacts" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue"
import {
  buildAgentObservableDisplay,
  type AgentObservableDisplay,
} from "../agent/agentObservableDisplay"
import {
  checkOrchestratorReadiness,
  decideOrchestratorRun,
  executeRecoveryAction,
  getLatestAcceptanceReport,
  getLatestEvalReport,
  getLatestReleaseGateReport,
  getOrchestratorDiff,
  getOrchestratorRun,
  getRunCommandAuthorization,
  getRunTaskReport,
  listOrchestratorEvents,
  listOrchestratorDecisions,
  listOrchestratorCheckpoints,
  listOrchestratorReadinessActionAudits,
  listOrchestratorRunActionAudits,
  openEvalReport,
  listRecoveryActions,
  listOrchestratorArtifacts,
  listOrchestratorRuns,
  runEvalReport,
  runAcceptanceReport,
  runReleaseGateReport,
  saveRunTaskReport,
  saveOrchestratorReadinessActionAudit,
  saveOrchestratorRunActionAudit,
  pauseOrchestratorRun,
  resumeOrchestratorRun,
  resolveOrchestratorPermission,
  startRealWorkspaceTrial,
  subscribeOrchestratorEvents,
  type AcceptanceReportHistoryItem,
  type AcceptanceReportSummary,
  type AcceptanceTaskSetId,
  type AcceptanceTaskSetOption,
  type AgentArtifact,
  type CommandAuthorizationSummary,
  type EvalReportHistoryItem,
  type EvalReportSummary,
  type IntegrationDecision,
  type DecisionAuditEntry,
  type OrchestratorEvent,
  type OrchestratorCheckpoint,
  type OrchestratorReadinessActionAudit,
  type OrchestratorReadinessReport,
  type OrchestratorRunActionAudit,
  type OrchestratorRun,
  type ProposedPatch,
  type RecoveryAction,
  type ReleaseGateMode,
  type ReleaseGateReport,
  type RunTaskReport,
} from "../agent/orchestratorClient"
import { settingsStore } from "../settings/settingsStore"

const AgentEvalSummary = defineAsyncComponent(() => import("./AgentEvalSummary.vue"))
const AgentRunTimeline = defineAsyncComponent(() => import("./AgentRunTimeline.vue"))
const AgentAssignmentCard = defineAsyncComponent(() => import("./AgentAssignmentCard.vue"))
const AgentArtifactViewer = defineAsyncComponent(() => import("./AgentArtifactViewer.vue"))
const AgentDiffViewer = defineAsyncComponent(() => import("./AgentDiffViewer.vue"))
const AgentRecoveryActions = defineAsyncComponent(() => import("./AgentRecoveryActions.vue"))
const IntegrationDecisionDialog = defineAsyncComponent(() => import("./IntegrationDecisionDialog.vue"))

const props = defineProps<{
  initialRunId?: string
}>()

type EnterpriseRunControlStatus = "complete" | "warning" | "blocked" | "pending"

interface EnterpriseRunControlStep {
  id: string
  title: string
  status: EnterpriseRunControlStatus
  statusLabel: string
  detail: string
}

interface EnterpriseRunPrimaryAction {
  id: "refresh-readiness" | "apply-defaults" | "start-trial" | "run-release-gate" | "pause-run" | "resume-run" | "none"
  label: string
  detail: string
  disabled: boolean
  disabledReason: string
}

interface EnterpriseRunActionFeedback {
  status: "idle" | "running" | "success" | "error"
  title: string
  detail: string
  at: number | null
}

const runs = ref<OrchestratorRun[]>([])
const selectedRunId = ref(props.initialRunId || "")
const artifacts = ref<AgentArtifact[]>([])
const recoveryActions = ref<RecoveryAction[]>([])
const checkpoints = ref<OrchestratorCheckpoint[]>([])
const latestCheckpoint = ref<OrchestratorCheckpoint | null>(null)
const decisionLog = ref<DecisionAuditEntry[]>([])
const taskReport = ref<RunTaskReport | null>(null)
const taskReportMarkdown = ref("")
const taskReportSavedPath = ref("")
const commandAuthorization = ref<CommandAuthorizationSummary | null>(null)
const diff = ref<ProposedPatch | null>(null)
const evalReport = ref<EvalReportSummary | null>(null)
const evalHistory = ref<EvalReportHistoryItem[]>([])
const evalMarkdownPath = ref("")
const acceptanceReport = ref<AcceptanceReportSummary | null>(null)
const acceptanceHistory = ref<AcceptanceReportHistoryItem[]>([])
const acceptanceMarkdownPath = ref("")
const acceptanceTaskSet = ref<AcceptanceTaskSetId>("standard")
const acceptanceTaskSets = ref<AcceptanceTaskSetOption[]>([])
const releaseGateReport = ref<ReleaseGateReport | null>(null)
const releaseGateJsonPath = ref("")
const releaseGateMode = ref<ReleaseGateMode>("quick")
const orchestratorReadiness = ref<OrchestratorReadinessReport | null>(null)
const orchestratorReadinessPath = ref("")
const orchestratorReadinessAudits = ref<OrchestratorReadinessActionAudit[]>([])
const orchestratorRunActionAudits = ref<OrchestratorRunActionAudit[]>([])
const decisionBusy = ref(false)
const recoveryBusy = ref(false)
const checkpointBusy = ref(false)
const permissionBusy = ref(false)
const diffBusy = ref(false)
const evalBusy = ref(false)
const acceptanceBusy = ref(false)
const releaseGateBusy = ref(false)
const taskReportBusy = ref(false)
const realTrialBusy = ref(false)
const orchestratorReadinessBusy = ref(false)
const enterpriseRunActionFeedback = ref<EnterpriseRunActionFeedback>({
  status: "idle",
  title: "等待主操作",
  detail: "控制台会在这里显示最近一次主操作结果",
  at: null,
})
const showEvalSummary = ref(false)
const eventRefreshTimer = ref<number | null>(null)
let unsubscribeEvents: (() => void) | null = null

const selectedRun = computed(() => runs.value.find((run) => run.id === selectedRunId.value) || null)
const agentObservableDisplay = computed<AgentObservableDisplay>(() => buildAgentObservableDisplay({
  run: selectedRun.value,
  events: selectedRun.value?.events || [],
  commandAuthorization: commandAuthorization.value,
  recoveryActions: recoveryActions.value,
  artifacts: artifacts.value,
  diff: diff.value,
}))
const activeRunCount = computed(() => runs.value.filter((run) => ["running", "queued", "pending", "paused"].includes(String(run.runtimeStatus || "").toLowerCase())).length)
const warningRunCount = computed(() => runs.value.filter((run) => String(run.runtimeReason || run.blockingReason || "").trim().length > 0).length)
const latestRunUpdatedAtLabel = computed(() => {
  const latest = runs.value.reduce((max, run) => Math.max(max, Number(run.updatedAt || 0)), 0)
  if (!latest) return "暂无"
  return new Date(latest).toLocaleString()
})
const matchedSignals = computed(() => {
  const matched = selectedRun.value?.strategySignals?.matched
  return Array.isArray(matched) ? matched.map((item) => String(item)).filter(Boolean) : []
})
const currentContextEvidence = computed(() => selectedRun.value?.contextEvidence || null)
const contextEvidenceReady = computed(() => {
  const evidence = currentContextEvidence.value
  if (!evidence) return false
  const index = evidence.indexStatus
  const indexReady = !index || (index.enabled !== false && ["ready", "indexed", "fresh", "idle"].includes(String(index.state || "").toLowerCase()))
  const freshEnough = !index?.freshness || ["fresh", "current", "ready", "unknown"].includes(String(index.freshness || "").toLowerCase())
  return indexReady
    && freshEnough
    && (evidence.budget.truncatedSources || 0) === 0
    && (evidence.budget.policy?.overflowChars || 0) === 0
    && (evidence.warnings.length || 0) === 0
})
const contextEvidenceStatusLabel = computed(() => {
  if (!currentContextEvidence.value) return "未记录"
  return contextEvidenceReady.value ? "已就绪" : "需复核"
})
const contextEvidenceSubtitle = computed(() => {
  const evidence = currentContextEvidence.value
  if (!evidence) return "尚未记录提及、规则、工作区来源和索引状态"
  const budget = evidence.budget
  return `${budget.totalSources} 个来源 · ${budget.estimatedChars} 字符 · ${budget.truncatedSources} 个截断 · ${evidence.warnings.length} 个告警`
})
const contextEvidenceIndexLabel = computed(() => {
  const index = currentContextEvidence.value?.indexStatus
  if (!index) return "未记录"
  return `${index.state}/${index.freshness}`
})
const contextEvidenceIndexTitle = computed(() => {
  const index = currentContextEvidence.value?.indexStatus
  if (!index) return "未记录索引状态"
  const updated = index.updatedAt ? new Date(index.updatedAt).toLocaleString() : "未知时间"
  return `已索引 ${index.indexedFiles}/${index.indexableFiles} · 已排除 ${index.excludedFiles} · 工作区 ${index.workspaceRoots} · ${updated}`
})
const contextEvidenceBudgetLabel = computed(() => {
  const budget = currentContextEvidence.value?.budget
  if (!budget) return "未记录"
  const overflow = budget.policy?.overflowChars || 0
  return `${budget.contextBlockChars}/${budget.policy?.availableContextChars || budget.estimatedChars} 字符${overflow > 0 ? ` · 溢出 ${overflow}` : ""}`
})
const contextEvidenceBudgetTitle = computed(() => {
  const budget = currentContextEvidence.value?.budget
  if (!budget) return "未记录预算策略"
  const allocation = budget.policy?.allocation || {}
  return `工作区 ${allocation.workspace || 0} · 提及 ${allocation.mentions || 0} · 附件 ${allocation.attachments || 0} · 规则 ${allocation.rules || 0} · 诊断 ${allocation.diagnostics || 0}`
})
const contextEvidenceSourceRows = computed(() => {
  const evidence = currentContextEvidence.value
  if (!evidence) return []
  return evidence.workspaceSources.slice(0, 6).map((source, index) => ({
    id: `${source.type}-${source.path || source.label}-${index}`,
    type: source.type,
    label: source.label,
    title: source.path || source.detail || source.label,
    meta: [
      source.count != null ? `${source.count} 项` : "",
      source.contentLength != null ? `${source.contentLength} 字符` : "",
      source.truncated ? "已截断" : "",
    ].filter(Boolean).join(" · ") || "元数据",
    truncated: source.truncated === true,
  }))
})
const checkpointSummary = computed(() => {
  if (!latestCheckpoint.value) return "尚未保存可恢复状态"
  return latestCheckpoint.value.canResume ? "可从最近状态恢复" : "仅作为历史快照"
})
const latestEventAt = computed(() => {
  const events = selectedRun.value?.events || []
  return events.reduce((max, event) => Math.max(max, Number(event.createdAt || 0)), 0)
})
const decisionLogSummary = computed(() => {
  const total = decisionLog.value.length
  if (!total) return "系统尚未记录关键决策"
  const blocked = decisionLog.value.filter((entry) => entry.status === "blocked" || entry.type === "permission_block").length
  return blocked > 0 ? `${total} 条记录，${blocked} 条需要关注` : `${total} 条记录`
})
const commandAuthorizationSummary = computed(() => {
  const summary = commandAuthorization.value
  if (!summary) return "尚未加载命令授权"
  if (summary.total === 0) return "当前 run 未配置质量门命令"
  return `${summary.allowed} 个允许，${summary.blocked} 个阻断，${summary.needsPermission} 个需授权`
})
const releaseGateTotalSteps = computed(() => releaseGateReport.value?.plannedSteps?.length || releaseGateReport.value?.steps?.length || 0)
const releaseGatePassedSteps = computed(() => (releaseGateReport.value?.steps || []).filter((step) => step.passed).length)
const releaseGateFirstWarning = computed(() => {
  const failed = (releaseGateReport.value?.steps || []).find((step) => !step.passed)
  if (failed) return `${failed.label || failed.id} 未通过：${failed.error || failed.command}`
  return releaseGateReport.value?.warnings?.[0]?.note || ""
})
const releaseGateSubtitle = computed(() => {
  if (releaseGateBusy.value) return `${formatReleaseGateMode(releaseGateMode.value)}正在运行`
  if (!releaseGateReport.value?.createdAt) return "尚未生成发布质量门报告"
  return new Date(releaseGateReport.value.createdAt).toLocaleString()
})
const realTrialReport = computed(() => taskReport.value?.realWorkspaceTrial || null)
const realTrialConfig = computed(() => selectedRun.value?.realWorkspaceTrial || null)
const realTrialAllowedPaths = computed(() => realTrialReport.value?.allowedPaths || realTrialConfig.value?.allowedPaths || [])
const realTrialQualityGateCommands = computed(() => realTrialReport.value?.qualityGateCommands || realTrialConfig.value?.qualityGateCommands || [])
const realTrialBlockedCommands = computed(() => realTrialReport.value?.blockedQualityGateCommands || realTrialConfig.value?.blockedQualityGateCommands || [])
const realTrialWriteMode = computed(() => formatWriteMode(realTrialReport.value?.writeMode || realTrialConfig.value?.writeMode || selectedRun.value?.writeMode))
const realTrialMainWorkspaceUntouched = computed(() => {
  if (!realTrialReport.value) return "等待报告"
  return realTrialReport.value.mainWorkspaceUntouchedBeforeAccept ? "确认未写入" : "需复核"
})
const realTrialRollbackState = computed(() => {
  if (!realTrialReport.value) return "等待报告"
  return realTrialReport.value.rollbackAvailable ? "可回滚" : "未生成快照"
})
const realTrialSubtitle = computed(() => {
  if (realTrialBusy.value) return "正在创建仅提案模式试运行"
  if (realTrialReport.value) return `${formatStrategy(realTrialReport.value.executionStrategy)} / ${formatStatusLabel(realTrialReport.value.status)}`
  if (realTrialConfig.value) return "已按真实工作区策略创建，等待任务报告"
  return "默认只生成拟议补丁，确认前不写入主工作区"
})
const deliveryTrust = computed(() => acceptanceReport.value?.longTask?.deliveryTrust || null)
const deliveryEvidenceChain = computed(() => acceptanceReport.value?.longTask?.evidenceChain || null)
const deliveryTrustStatus = computed(() => deliveryTrust.value?.status || "missing")
const deliveryTrustStatusLabel = computed(() => deliveryTrust.value?.statusLabel || "暂无可信摘要")
const deliveryTrustSubtitle = computed(() => {
  const longTask = acceptanceReport.value?.longTask
  if (!acceptanceReport.value) return "尚未生成真实项目验收报告"
  if (!longTask) return "最新验收报告不包含长任务证据"
  if (!deliveryTrust.value) return "长任务已存在，等待可信摘要生成"
  return deliveryTrust.value.summary || `${deliveryTrust.value.statusLabel} · ${deliveryTrust.value.nextAction}`
})
const deliveryTrustScoreLabel = computed(() => {
  if (!deliveryTrust.value) return "待生成"
  return `${deliveryTrust.value.score}/100`
})
const deliveryTrustNextAction = computed(() => deliveryTrust.value?.nextAction || "先运行真实项目长任务验收，生成可信交付摘要")
const deliveryTrustRouterState = computed(() => {
  const router = deliveryEvidenceChain.value?.router
  if (!router) return "待验证"
  return router.matchedExpected ? formatStrategy(router.executionStrategy) : "需复核"
})
const deliveryTrustWorkspaceState = computed(() => {
  const workspace = deliveryEvidenceChain.value?.workspace
  if (!workspace) return "待验证"
  return workspace.isolated ? "已隔离" : "需复核"
})
const deliveryTrustQualityGateState = computed(() => {
  const qualityGate = deliveryEvidenceChain.value?.qualityGate
  if (!qualityGate?.status) return "待验证"
  if (qualityGate.status === "passed") return "已通过"
  if (qualityGate.status === "failed") return "未通过"
  return formatStatusLabel(qualityGate.status)
})
const deliveryTrustEvidenceRows = computed(() => {
  const rows = [
    ...(deliveryTrust.value?.evidence || []).slice(0, 3).map((text, index) => ({
      id: `evidence-${index}-${text}`,
      kind: "evidence",
      text,
    })),
    ...(deliveryTrust.value?.risks || []).slice(0, 2).map((text, index) => ({
      id: `risk-${index}-${text}`,
      kind: "risk",
      text,
    })),
  ]
  if (rows.length) return rows
  return [
    {
      id: "empty",
      kind: "evidence",
      text: "运行真实项目长任务验收后，这里会显示路由器、隔离工作区、质量门和接受证据",
    },
  ]
})
const orchestratorReadinessSubtitle = computed(() => {
  if (orchestratorReadinessBusy.value) return "正在刷新企业级运行预检"
  if (!orchestratorReadiness.value) return "尚未执行入口预检"
  const summary = orchestratorReadiness.value.summary
  return `${orchestratorReadiness.value.statusLabel} · ${summary.passed}/${summary.total} 通过 · ${summary.warning} 个需处理 · ${summary.failed} 个阻断`
})
const latestReadinessAuditTitle = computed(() => {
  const latest = orchestratorReadinessAudits.value[0]
  if (!latest) return "暂无审计记录"
  return `${latest.title || latest.actionId} · ${new Date(latest.createdAt).toLocaleString()}`
})
const latestRunActionAuditTitle = computed(() => {
  const latest = orchestratorRunActionAudits.value[0]
  if (!latest) return "暂无主操作审计"
  const time = new Date(latest.finishedAt || latest.createdAt).toLocaleString()
  const duration = latest.durationMs ? ` · ${latest.durationMs}ms` : ""
  const suffix = latest.status === "error" && latest.error ? ` · ${latest.error}` : duration
  return `${latest.title || latest.actionId} · ${formatRunActionAuditStatus(latest.status)} · ${time}${suffix}`
})
const enterpriseRunControlSteps = computed<EnterpriseRunControlStep[]>(() => {
  const readiness = orchestratorReadiness.value
  const remediationCount = readiness?.remediations?.length || 0
  const latestAudit = orchestratorReadinessAudits.value[0]
  const trial = realTrialReport.value
  const release = releaseGateReport.value

  return [
    {
      id: "readiness",
      title: "预检",
      status: readinessStatus(readiness?.status),
      statusLabel: readiness?.statusLabel || "待预检",
      detail: readiness?.nextAction || "先刷新企业级运行预检",
    },
    {
      id: "remediation",
      title: "修复",
      status: latestAudit ? "complete" : remediationCount > 0 ? "warning" : readiness ? "complete" : "pending",
      statusLabel: latestAudit ? "已审计" : remediationCount > 0 ? `${remediationCount} 条建议` : readiness ? "无待修复" : "待预检",
      detail: latestAudit?.summary || (remediationCount > 0 ? "按修复建议处理后重新预检" : "当前没有结构化修复建议"),
    },
    {
      id: "trial",
      title: "试运行",
      status: trial ? (trial.mainWorkspaceUntouchedBeforeAccept ? "complete" : "warning") : realTrialConfig.value ? "pending" : "pending",
      statusLabel: trial ? formatStatusLabel(trial.status) : realTrialConfig.value ? "等待报告" : "待启动",
      detail: trial
        ? `${formatStrategy(trial.executionStrategy)} · ${trial.filesChanged.length} 个文件 · ${trial.rollbackAvailable ? "可回滚" : "缺少回滚"}`
        : "发起仅提案模式真实工作区试运行",
    },
    {
      id: "release",
      title: "发布门",
      status: release ? (release.ready ? "complete" : "warning") : "pending",
      statusLabel: release ? (release.ready ? "就绪" : "需处理") : "待运行",
      detail: release ? `${releaseGatePassedSteps.value}/${releaseGateTotalSteps.value} 步通过` : "运行快速门或完整发布门",
    },
  ]
})
const enterpriseRunControlSummary = computed(() => {
  const blocked = enterpriseRunControlSteps.value.find((step) => step.status === "blocked")
  if (blocked) return `${blocked.title} 阶段阻断：${blocked.detail}`
  const warning = enterpriseRunControlSteps.value.find((step) => step.status === "warning")
  if (warning) return `${warning.title} 阶段需处理：${warning.detail}`
  const pending = enterpriseRunControlSteps.value.find((step) => step.status === "pending")
  if (pending) return `${pending.title} 阶段待完成：${pending.detail}`
  return "企业运行链路已闭环"
})
const enterpriseRunPrimaryAction = computed<EnterpriseRunPrimaryAction>(() => {
  const missingProjectRoot = !selectedRun.value?.projectRoot
  const runStatus = String(selectedRun.value?.status || selectedRun.value?.runtimeStatus || "").toLowerCase()
  if (["planning", "running", "integrating", "applying", "verifying"].includes(runStatus)) {
    return {
      id: "pause-run",
      label: "暂停任务",
      detail: "保存检查点并暂停长时间运行的智能体任务",
      disabled: false,
      disabledReason: "可执行：暂停当前任务并保留恢复证据",
    }
  }
  if (runStatus === "paused") {
    return {
      id: "resume-run",
      label: "恢复任务",
      detail: "从最近检查点恢复运行",
      disabled: checkpointBusy.value || !latestCheckpoint.value?.canResume,
      disabledReason: checkpointBusy.value ? "恢复操作正在运行" : latestCheckpoint.value?.canResume ? "可执行：从最近检查点恢复" : "当前没有可恢复的检查点",
    }
  }
  if (!orchestratorReadiness.value) {
    return {
      id: "refresh-readiness",
      label: orchestratorReadinessBusy.value ? "刷新中" : "刷新预检",
      detail: "先生成入口级企业预检状态",
      disabled: orchestratorReadinessBusy.value || missingProjectRoot,
      disabledReason: orchestratorReadinessBusy.value ? "预检正在刷新" : missingProjectRoot ? "当前 run 缺少项目根目录" : "可执行：生成入口级企业预检",
    }
  }
  if (orchestratorReadiness.value.status === "blocked" || (orchestratorReadiness.value.remediations?.length || 0) > 0) {
    return {
      id: "apply-defaults",
      label: orchestratorReadinessBusy.value ? "处理中" : "应用安全默认配置",
      detail: "先处理预检阻断或修复建议",
      disabled: orchestratorReadinessBusy.value || missingProjectRoot,
      disabledReason: orchestratorReadinessBusy.value ? "安全配置正在处理" : missingProjectRoot ? "当前 run 缺少项目根目录" : "可执行：写入 Codek workspace 安全默认配置",
    }
  }
  if (!realTrialReport.value) {
    return {
      id: "start-trial",
      label: realTrialBusy.value ? "试运行中" : "发起试运行",
      detail: "生成仅提案模式真实工作区试运行证据",
      disabled: realTrialBusy.value || missingProjectRoot,
      disabledReason: realTrialBusy.value ? "真实工作区试运行正在创建" : missingProjectRoot ? "当前 run 缺少项目根目录" : "可执行：发起仅提案模式真实工作区试运行",
    }
  }
  if (!releaseGateReport.value?.ready) {
    return {
      id: "run-release-gate",
      label: releaseGateBusy.value ? "运行中" : "运行快速门",
      detail: "补齐发布质量门证据",
      disabled: releaseGateBusy.value,
      disabledReason: releaseGateBusy.value ? "发布质量门正在运行" : "可执行：运行 quick 发布质量门",
    }
  }
  return {
    id: "none",
    label: "已闭环",
    detail: "预检、修复、试运行和发布门已形成闭环",
    disabled: true,
    disabledReason: "企业运行链路已闭环，无需继续操作",
  }
})

function upsertRun(run: OrchestratorRun): void {
  const index = runs.value.findIndex((item) => item.id === run.id)
  if (index >= 0) runs.value[index] = run
  else runs.value.unshift(run)
}

async function refresh(options: { keepDiff?: boolean } = {}): Promise<void> {
  runs.value = await listOrchestratorRuns()
  if (selectedRunId.value && !runs.value.some((run) => run.id === selectedRunId.value)) {
    selectedRunId.value = ""
    artifacts.value = []
    recoveryActions.value = []
    checkpoints.value = []
    latestCheckpoint.value = null
    decisionLog.value = []
    taskReport.value = null
    taskReportMarkdown.value = ""
    taskReportSavedPath.value = ""
    commandAuthorization.value = null
    diff.value = null
    orchestratorReadiness.value = null
    orchestratorReadinessPath.value = ""
    orchestratorReadinessAudits.value = []
    orchestratorRunActionAudits.value = []
  }
  if (!selectedRunId.value && runs.value.length > 0) {
    selectedRunId.value = runs.value[0].id
  }
  if (selectedRunId.value) {
    const current = await getOrchestratorRun(selectedRunId.value)
    if (current) {
      upsertRun(current)
    } else {
      selectedRunId.value = ""
      artifacts.value = []
      recoveryActions.value = []
      checkpoints.value = []
      latestCheckpoint.value = null
      decisionLog.value = []
      taskReport.value = null
      taskReportMarkdown.value = ""
      taskReportSavedPath.value = ""
      commandAuthorization.value = null
      diff.value = null
      orchestratorReadiness.value = null
      orchestratorReadinessPath.value = ""
      orchestratorReadinessAudits.value = []
      orchestratorRunActionAudits.value = []
      return
    }
    artifacts.value = await listOrchestratorArtifacts(selectedRunId.value)
    recoveryActions.value = await listRecoveryActions(selectedRunId.value)
    decisionLog.value = await listOrchestratorDecisions(selectedRunId.value)
    commandAuthorization.value = await getRunCommandAuthorization(selectedRunId.value)
    orchestratorRunActionAudits.value = (await listOrchestratorRunActionAudits()).history
    const checkpointResult = await listOrchestratorCheckpoints(selectedRunId.value)
    checkpoints.value = checkpointResult.checkpoints
    latestCheckpoint.value = checkpointResult.latest
    if (!options.keepDiff) diff.value = null
    await refreshOrchestratorReadiness({ silent: true })
  }
  await refreshEvalReport()
}

async function refreshEvalReport(): Promise<void> {
  showEvalSummary.value = true
  const latest = await getLatestEvalReport()
  evalReport.value = latest.report
  evalHistory.value = latest.history
  evalMarkdownPath.value = latest.markdownPath
  const acceptance = await getLatestAcceptanceReport()
  acceptanceReport.value = acceptance.report
  acceptanceHistory.value = acceptance.history
  acceptanceMarkdownPath.value = acceptance.markdownPath
  acceptanceTaskSets.value = acceptance.taskSets
  if (acceptance.report?.taskSet) acceptanceTaskSet.value = acceptance.report.taskSet
  const releaseGate = await getLatestReleaseGateReport()
  releaseGateReport.value = releaseGate.report
  releaseGateJsonPath.value = releaseGate.jsonPath
  if (releaseGate.report?.mode === "quick" || releaseGate.report?.mode === "build" || releaseGate.report?.mode === "full") {
    releaseGateMode.value = releaseGate.report.mode
  }
}

async function selectRun(id: string): Promise<void> {
  selectedRunId.value = id
  await refresh()
}

async function handleRecoveryExecute(actionId: string): Promise<void> {
  if (!selectedRunId.value || recoveryBusy.value) return
  recoveryBusy.value = true
  try {
    const result = await executeRecoveryAction(selectedRunId.value, actionId)
    if (result.run) {
      upsertRun(result.run)
    }
    if (result.artifacts.length) artifacts.value = result.artifacts
    await refresh({ keepDiff: true })
  } finally {
    recoveryBusy.value = false
  }
}

async function handleResumeCheckpoint(): Promise<void> {
  if (!selectedRunId.value || checkpointBusy.value) return
  checkpointBusy.value = true
  try {
    const result = await resumeOrchestratorRun(selectedRunId.value)
    if (result.run) upsertRun(result.run)
    await refresh({ keepDiff: true })
  } finally {
    checkpointBusy.value = false
  }
}

async function handlePermission(decision: "approved" | "rejected"): Promise<void> {
  if (!selectedRunId.value || permissionBusy.value) return
  permissionBusy.value = true
  try {
    const result = await resolveOrchestratorPermission(
      selectedRunId.value,
      decision,
      decision === "approved" ? "用户确认沙箱权限边界" : "用户拒绝沙箱权限请求",
    )
    if (result.run) upsertRun(result.run)
    await refresh({ keepDiff: true })
  } finally {
    permissionBusy.value = false
  }
}

async function handleDecision(decision: IntegrationDecision["status"]): Promise<void> {
  if (!selectedRunId.value || decisionBusy.value) return
  decisionBusy.value = true
  try {
    const result = await decideOrchestratorRun(
      selectedRunId.value,
      decision as "accepted" | "rejected" | "rework_requested" | "rollback",
    )
    if (result.run) {
      upsertRun(result.run)
    }
    if (result.artifacts.length) artifacts.value = result.artifacts
    diff.value = null
    await refresh()
  } finally {
    decisionBusy.value = false
  }
}

async function handleLoadTaskReport(): Promise<void> {
  if (!selectedRunId.value || taskReportBusy.value) return
  taskReportBusy.value = true
  try {
    const result = await getRunTaskReport(selectedRunId.value)
    taskReport.value = result.report
    taskReportMarkdown.value = result.markdown
  } finally {
    taskReportBusy.value = false
  }
}

async function handleSaveTaskReport(): Promise<void> {
  if (!selectedRunId.value || taskReportBusy.value) return
  taskReportBusy.value = true
  try {
    const result = await saveRunTaskReport(selectedRunId.value)
    taskReport.value = result.report
    taskReportMarkdown.value = result.report?.markdown || taskReportMarkdown.value
    taskReportSavedPath.value = result.markdownPath || result.jsonPath || ""
  } finally {
    taskReportBusy.value = false
  }
}

async function loadDiff(): Promise<void> {
  if (!selectedRunId.value || diffBusy.value) return
  diffBusy.value = true
  try {
    diff.value = await getOrchestratorDiff(selectedRunId.value)
  } finally {
    diffBusy.value = false
  }
}

async function handleRunEval(): Promise<void> {
  if (evalBusy.value) return
  evalBusy.value = true
  try {
    const result = await runEvalReport()
    evalReport.value = result.report
    evalHistory.value = result.history
    evalMarkdownPath.value = result.markdownPath
  } finally {
    evalBusy.value = false
  }
}

async function handleRunAcceptance(taskSet?: AcceptanceTaskSetId): Promise<void> {
  if (acceptanceBusy.value) return
  acceptanceBusy.value = true
  try {
    const selectedTaskSet = taskSet || acceptanceTaskSet.value
    acceptanceTaskSet.value = selectedTaskSet
    const result = await runAcceptanceReport(selectedTaskSet)
    acceptanceReport.value = result.report
    acceptanceHistory.value = result.history
    acceptanceMarkdownPath.value = result.markdownPath
    acceptanceTaskSets.value = result.taskSets
  } finally {
    acceptanceBusy.value = false
  }
}

async function handleRunReleaseGate(mode: ReleaseGateMode): Promise<void> {
  if (releaseGateBusy.value) return
  releaseGateBusy.value = true
  releaseGateMode.value = mode
  try {
    const result = await runReleaseGateReport(mode)
    releaseGateReport.value = result.report
    releaseGateJsonPath.value = result.jsonPath
  } finally {
    releaseGateBusy.value = false
  }
}

async function handleEnterprisePrimaryAction(): Promise<void> {
  const action = enterpriseRunPrimaryAction.value
  if (action.disabled) return
  const current = selectedRun.value
  const startedAt = Date.now()
  enterpriseRunActionFeedback.value = {
    status: "running",
    title: "正在执行主操作",
    detail: action.detail,
    at: startedAt,
  }
  try {
    await recordEnterpriseRunAction(action, "started", startedAt, startedAt, action.detail)
    if (action.id === "refresh-readiness") {
      await refreshOrchestratorReadiness({ writeLatest: true })
    } else if (action.id === "apply-defaults") {
      await applyReadinessSafeDefaults()
    } else if (action.id === "start-trial") {
      await handleStartRealWorkspaceTrial()
    } else if (action.id === "run-release-gate") {
      await handleRunReleaseGate("quick")
    } else if (action.id === "pause-run") {
      if (!selectedRunId.value) return
      const result = await pauseOrchestratorRun(selectedRunId.value, "用户暂停了长时间运行的智能体任务")
      if (result.run) upsertRun(result.run)
      await refresh({ keepDiff: true })
    } else if (action.id === "resume-run") {
      await handleResumeCheckpoint()
    }
    enterpriseRunActionFeedback.value = {
      status: "success",
      title: "主操作已完成",
      detail: enterpriseRunActionSuccessDetail(action.id),
      at: Date.now(),
    }
    await recordEnterpriseRunAction(action, "success", startedAt, Date.now(), enterpriseRunActionSuccessDetail(action.id), "", current)
  } catch (error) {
    const message = formatErrorMessage(error)
    enterpriseRunActionFeedback.value = {
      status: "error",
      title: "主操作失败",
      detail: message,
      at: Date.now(),
    }
    await recordEnterpriseRunAction(action, "error", startedAt, Date.now(), "主操作失败", message, current)
  }
}

async function recordEnterpriseRunAction(
  action: EnterpriseRunPrimaryAction,
  status: "started" | "success" | "error",
  startedAt: number,
  finishedAt: number,
  summary: string,
  error = "",
  run = selectedRun.value,
): Promise<void> {
  try {
    const result = await saveOrchestratorRunActionAudit({
      runId: run?.id || "",
      actionId: action.id,
      title: action.label,
      status,
      projectRoot: run?.projectRoot || "",
      startedAt,
      finishedAt,
      summary,
      error,
      metadata: { source: "orchestrator-run-control" },
    })
    orchestratorRunActionAudits.value = result.history
  } catch {
    // 审计失败不能阻断主操作本身，页面反馈仍保留当前动作结果。
  }
}

function enterpriseRunActionSuccessDetail(actionId: EnterpriseRunPrimaryAction["id"]): string {
  if (actionId === "refresh-readiness") return "企业级运行预检已刷新"
  if (actionId === "apply-defaults") return "安全默认配置已应用并重新预检"
  if (actionId === "start-trial") return "仅提案模式真实工作区试运行已发起"
  if (actionId === "run-release-gate") return "快速发布门已运行"
  return "企业运行链路已闭环"
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "未知错误"
  if (typeof error === "string") return error
  return "未知错误"
}

async function handleStartRealWorkspaceTrial(): Promise<void> {
  const current = selectedRun.value
  if (!current?.projectRoot || realTrialBusy.value) return
  const files = current.integrationDecision?.proposedPatch?.filesChanged || []
  const allowedPaths = deriveAllowedPaths(files)
  realTrialBusy.value = true
  try {
    await refreshOrchestratorReadiness({ writeLatest: true })
    const result = await startRealWorkspaceTrial({
      projectRoot: current.projectRoot,
      userInput: current.userInput || "真实工作区受控试运行",
      files,
      settings: {
        "codek.agent.realWorkspaceTrial.allowedPaths": allowedPaths.length ? allowedPaths : ["src"],
        "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
      },
      plan: current.plan || null,
    })
    if (result.run) {
      upsertRun(result.run)
      selectedRunId.value = result.run.id
      taskReport.value = null
      taskReportMarkdown.value = ""
      taskReportSavedPath.value = ""
    }
    await refresh({ keepDiff: true })
  } finally {
    realTrialBusy.value = false
  }
}

async function refreshOrchestratorReadiness(options: { silent?: boolean; writeLatest?: boolean } = {}): Promise<void> {
  const current = selectedRun.value
  if (!current?.projectRoot) {
    orchestratorReadiness.value = null
    orchestratorReadinessPath.value = ""
    orchestratorReadinessAudits.value = []
    return
  }
  if (orchestratorReadinessBusy.value) return
  if (!options.silent) orchestratorReadinessBusy.value = true
  try {
    const result = await checkOrchestratorReadiness({
      projectRoot: current.projectRoot,
      settings: buildRealTrialSettings(current),
      writeLatest: options.writeLatest === true,
    })
    orchestratorReadiness.value = result.report
    orchestratorReadinessPath.value = result.markdownPath || result.jsonPath || ""
    orchestratorReadinessAudits.value = (await listOrchestratorReadinessActionAudits()).history
  } finally {
    if (!options.silent) orchestratorReadinessBusy.value = false
  }
}

async function applyReadinessSafeDefaults(): Promise<void> {
  const current = selectedRun.value
  if (!current?.projectRoot || orchestratorReadinessBusy.value) return
  const allowedPaths = deriveAllowedPaths(current.integrationDecision?.proposedPatch?.filesChanged || [])
  settingsStore.update({
    "codek.agent.realWorkspaceTrial.allowedPaths": allowedPaths.length ? allowedPaths : ["src"],
    "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    "codek.agent.realWorkspaceTrial.allowMainWorkspaceWrites": false,
    "codek.agent.realWorkspaceTrial.allowNetwork": false,
    "codek.agent.realWorkspaceTrial.allowInstall": false,
  }, "workspace")
  const audit = await saveOrchestratorReadinessActionAudit({
    actionId: "apply_safe_defaults",
    title: "应用安全默认配置",
    status: "applied",
    projectRoot: current.projectRoot,
    summary: "写入真实试运行安全默认配置",
    settingKeys: [
      "codek.agent.realWorkspaceTrial.allowedPaths",
      "codek.agent.realWorkspaceTrial.qualityGateCommands",
      "codek.agent.realWorkspaceTrial.allowMainWorkspaceWrites",
      "codek.agent.realWorkspaceTrial.allowNetwork",
      "codek.agent.realWorkspaceTrial.allowInstall",
    ],
    metadata: { source: "orchestrator-readiness-panel" },
  })
  orchestratorReadinessAudits.value = audit.history
  await refreshOrchestratorReadiness({ writeLatest: true })
}

async function handleOpenEvalReport(markdownPath?: string): Promise<void> {
  const target = markdownPath || evalMarkdownPath.value
  if (!target) return
  await openEvalReport(target)
}

async function handleOpenAcceptanceReport(markdownPath?: string): Promise<void> {
  const target = markdownPath || acceptanceMarkdownPath.value
  if (!target) return
  await openEvalReport(target)
}

async function refreshEvents(): Promise<void> {
  if (!selectedRunId.value) return
  const events = await listOrchestratorEvents(selectedRunId.value, latestEventAt.value)
  if (!events.length) return
  const current = selectedRun.value
  if (current) {
    const known = new Set((current.events || []).map((event) => event.id || `${event.type}:${event.createdAt}`))
    const merged = [...(current.events || [])]
    for (const event of events) {
      const key = event.id || `${event.type}:${event.createdAt}`
      if (!known.has(key)) merged.push(event)
    }
    upsertRun({ ...current, events: merged, updatedAt: Math.max(current.updatedAt, latestEventAt.value) })
  }
  await refresh({ keepDiff: true })
}

function handleLiveEvent(event: OrchestratorEvent): void {
  if (!event.runId || event.runId !== selectedRunId.value) return
  const current = selectedRun.value
  if (current) {
    upsertRun({
      ...current,
      events: [...(current.events || []), event],
      updatedAt: Math.max(current.updatedAt, Number(event.createdAt || Date.now())),
    })
  }
  void refresh({ keepDiff: true })
}

function formatStrategy(strategy?: string): string {
  if (strategy === "multi-agent") return "多智能体"
  if (strategy === "single-agent") return "单智能体"
  return strategy || "未知策略"
}

function localizeRunDisplayText(value?: unknown): string {
  return String(value || "")
    .replace(/\bmulti Agent\b/gi, "多智能体")
    .replace(/\bsingle Agent\b/gi, "单智能体")
    .replace(/多\s*Agent/g, "多智能体")
    .replace(/单\s*Agent/g, "单智能体")
    .replace(/Agent\s*runtime/gi, "智能体运行时")
    .replace(/\bAgent\b/g, "智能体")
    .replace(/\bAuto\b/g, "自动")
    .replace(/\bPlan\b/g, "计划")
}

function formatRunStatus(run?: OrchestratorRun | string): string {
  if (typeof run === "object" && run?.runtimeStatusLabel) return run.runtimeStatusLabel
  const status = typeof run === "string" ? run : run?.status
  return formatStatusLabel(status)
}

function formatStatusLabel(status?: string): string {
  if (status === "created") return "已创建"
  if (status === "queued") return "排队中"
  if (status === "planning") return "规划中"
  if (status === "running") return "运行中"
  if (status === "integrating") return "整合中"
  if (status === "applying") return "应用中"
  if (status === "verifying") return "验证中"
  if (status === "waiting_user") return "等待确认"
  if (status === "waiting_permission") return "等待权限确认"
  if (status === "waiting_decision") return "等待变更审批"
  if (status === "blocked") return "已阻断"
  if (status === "recovering") return "恢复中"
  if (status === "completed") return "已完成"
  if (status === "failed") return "失败"
  if (status === "cancelled") return "已取消"
  return status || "未知状态"
}

function readinessStatus(status?: string): EnterpriseRunControlStatus {
  if (status === "ready") return "complete"
  if (status === "degraded") return "warning"
  if (status === "blocked") return "blocked"
  return "pending"
}

function formatRisk(risk?: unknown): string {
  if (risk === "high") return "高风险"
  if (risk === "medium") return "中风险"
  if (risk === "safe") return "低风险"
  if (risk === "normal") return "普通风险"
  if (risk === "low") return "低风险"
  return "未评估"
}

function formatContextTaskType(taskType?: string): string {
  if (!taskType || taskType === "general") return "通用任务"
  if (taskType === "coding") return "编码任务"
  if (taskType === "debugging") return "调试任务"
  if (taskType === "review") return "审查任务"
  if (taskType === "planning") return "规划任务"
  if (taskType === "documentation") return "文档任务"
  return taskType
}

function formatContextRiskLevel(riskLevel?: string): string {
  if (!riskLevel || riskLevel === "normal") return "普通风险"
  return formatRisk(riskLevel)
}

function formatVisibleMode(mode?: string): string {
  if (mode === "ask") return "问答"
  if (mode === "plan") return "规划"
  if (mode === "agent") return "智能体"
  if (mode === "auto") return "自主"
  return mode || "未知模式"
}

function formatDecisionType(type?: string): string {
  if (type === "router") return "路由决策"
  if (type === "permission_block") return "权限阻断"
  if (type === "readiness_block") return "预检阻断"
  if (type === "checkpoint_saved") return "保存检查点"
  if (type === "checkpoint_resumed") return "恢复检查点"
  if (type === "user_decision") return "用户决策"
  if (type === "recovery_action_created") return "创建恢复动作"
  if (type === "recovery_action_executed") return "执行恢复动作"
  return type || "决策"
}

function formatDecisionStatus(status?: string): string {
  if (status === "selected") return "已选择"
  if (status === "blocked") return "已阻断"
  if (status === "resumable") return "可恢复"
  if (status === "snapshot") return "快照"
  if (status === "resumed") return "已恢复"
  if (status === "accepted") return "已接受"
  if (status === "rejected") return "已拒绝"
  if (status === "rework_requested") return "需返工"
  if (status === "rollback") return "已回滚"
  return status || "已记录"
}

function formatDecisionOption(option?: string): string {
  if (option === "single-agent") return "单智能体"
  if (option === "multi-agent") return "多智能体"
  if (option === "accepted") return "接受"
  if (option === "rejected") return "拒绝"
  if (option === "rework_requested") return "返工"
  if (option === "rollback") return "回滚"
  return option || "未记录"
}

function formatPermissionStatus(status?: string): string {
  if (status === "waiting_user") return "等待确认"
  if (status === "approved") return "已允许"
  if (status === "rejected") return "已拒绝"
  return status || "未记录"
}

function formatCommandStatus(status?: string): string {
  if (status === "allowed") return "已允许"
  if (status === "blocked") return "已阻断"
  if (status === "needs_permission") return "需授权"
  return status || "未记录"
}

function formatCommandCapabilities(capabilities?: { network?: boolean; install?: boolean; externalTool?: boolean }): string {
  const labels = []
  if (capabilities?.network) labels.push("网络")
  if (capabilities?.install) labels.push("安装")
  if (capabilities?.externalTool) labels.push("外部工具")
  return labels.length ? labels.join(" / ") : "本地安全"
}

function formatRecoveryRecommendation(action?: string): string {
  if (action === "retry") return "建议重试当前阶段"
  if (action === "ask_user") return "建议先由用户检查结果"
  if (action === "rewind") return "建议回退到较早阶段"
  if (action === "split") return "建议拆分任务"
  if (action === "abort") return "建议终止任务"
  return action || "未记录"
}

function formatReleaseGateMode(mode?: string): string {
  if (mode === "quick") return "快速"
  if (mode === "build") return "构建"
  if (mode === "full") return "完整"
  return mode || "未知"
}

function formatRunActionAuditStatus(status?: string): string {
  if (status === "started") return "已开始"
  if (status === "success") return "成功"
  if (status === "error") return "失败"
  return status || "未知"
}

function formatProjectKind(kind?: string): string {
  if (kind === "smoke-temp") return "smoke 临时项目"
  if (kind === "codek-self") return "Codek 自身开发项目"
  if (kind === "user-real") return "用户真实项目"
  return kind || "未识别项目"
}

function formatWriteMode(mode?: string): string {
  if (mode === "proposed_patch_only") return "仅生成 proposed patch，等待确认"
  if (mode === "requires_explicit_accept") return "显式接受后才写入"
  if (mode === "applying") return "正在写入主工作区"
  if (mode === "applied") return "已写入主工作区"
  if (mode === "blocked_no_write") return "已阻断，未写入主工作区"
  if (mode === "rejected_no_write") return "已拒绝，未写入主工作区"
  if (mode === "rolled_back") return "已回滚到应用前状态"
  return mode || "未记录"
}

function formatList(values?: string[]): string {
  const list = Array.isArray(values) ? values.filter(Boolean) : []
  return list.length ? list.join(", ") : "无"
}

function deriveAllowedPaths(files: string[]): string[] {
  const paths = files
    .map((file) => String(file || "").replace(/\\/g, "/").replace(/^\.\/+/, "").split("/")[0])
    .filter(Boolean)
  return [...new Set(paths)]
}

function buildRealTrialSettings(run: OrchestratorRun): Record<string, unknown> {
  const files = run.integrationDecision?.proposedPatch?.filesChanged || []
  const allowedPaths = deriveAllowedPaths(files)
  const settings = { ...settingsStore.getAll() }
  settings["codek.agent.realWorkspaceTrial.allowedPaths"] = allowedPaths.length
    ? allowedPaths
    : normalizeStringList(settings["codek.agent.realWorkspaceTrial.allowedPaths"], ["src"])
  settings["codek.agent.realWorkspaceTrial.qualityGateCommands"] = normalizeStringList(
    settings["codek.agent.realWorkspaceTrial.qualityGateCommands"],
    ["npm run typecheck"],
  )
  return settings
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item || "").trim()).filter(Boolean)
    return list.length ? list : fallback
  }
  if (typeof value === "string") {
    const list = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
    return list.length ? list : fallback
  }
  return fallback
}

onMounted(() => {
  void refresh()
  unsubscribeEvents = subscribeOrchestratorEvents(handleLiveEvent)
  eventRefreshTimer.value = window.setInterval(() => {
    void refreshEvents()
  }, 2000)
})

onBeforeUnmount(() => {
  if (eventRefreshTimer.value) window.clearInterval(eventRefreshTimer.value)
  unsubscribeEvents?.()
})
</script>

<style scoped>
.orchestrator-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: auto;
  background: var(--bg-panel);
}

.orchestrator-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.panel-title {
  color: var(--text-bright);
  font-size: 14px;
  font-weight: 700;
}

.panel-subtitle,
.empty,
.run-summary {
  color: var(--text-muted);
  font-size: 12px;
}

.orchestrator-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.summary-card span {
  color: var(--text-muted);
  font-size: 10px;
}

.summary-card strong {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refresh-btn,
.run-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  cursor: pointer;
}

.refresh-btn {
  height: 28px;
  padding: 0 10px;
}

.run-list,
.run-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.run-list {
  flex: 0 0 auto;
  max-height: 164px;
  overflow: auto;
  padding-right: 2px;
}

.run-detail {
  min-height: 0;
}

.run-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 0 8px;
}

.run-row.active,
.run-row:hover,
.refresh-btn:hover {
  border-color: var(--accent);
  color: var(--text-bright);
}

.run-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-observable-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
}

.agent-observable-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.agent-observable-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 800;
}

.agent-observable-subtitle,
.agent-observable-next {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.agent-observable-next {
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-secondary);
}

.agent-observable-status,
.agent-observable-badges span {
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  font-size: 11px;
  white-space: nowrap;
}

.agent-observable-status.success,
.agent-observable-badges .success,
.agent-observable-row.success,
.agent-observable-action.success {
  border-color: rgba(34, 197, 94, 0.36);
}

.agent-observable-status.warning,
.agent-observable-badges .warning,
.agent-observable-row.warning,
.agent-observable-action.warning {
  border-color: rgba(245, 158, 11, 0.42);
}

.agent-observable-status.danger,
.agent-observable-badges .danger,
.agent-observable-row.danger,
.agent-observable-action.danger {
  border-color: rgba(239, 68, 68, 0.5);
}

.agent-observable-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-observable-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.agent-observable-grid section {
  min-width: 0;
}

.agent-observable-grid h4 {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.agent-observable-row,
.agent-observable-action {
  display: grid;
  grid-template-columns: minmax(70px, 0.9fr) minmax(64px, 0.7fr);
  gap: 4px 8px;
  align-items: center;
  min-width: 0;
  margin-top: 5px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.agent-observable-row span,
.agent-observable-action span {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-observable-row strong,
.agent-observable-action strong {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-observable-row small,
.agent-observable-action small {
  grid-column: 1 / -1;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-observable-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 6px;
}

.enterprise-control-panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.enterprise-control-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.enterprise-control-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.enterprise-control-subtitle {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.enterprise-control-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.enterprise-control-step {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.enterprise-control-step.complete {
  border-color: rgba(34, 197, 94, 0.35);
}

.enterprise-control-step.warning {
  border-color: rgba(245, 158, 11, 0.45);
}

.enterprise-control-step.blocked {
  border-color: rgba(248, 113, 113, 0.5);
}

.enterprise-control-step span {
  color: var(--text-muted);
  font-size: 11px;
}

.enterprise-control-step strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enterprise-control-step.complete strong {
  color: var(--green);
}

.enterprise-control-step.warning strong {
  color: var(--yellow);
}

.enterprise-control-step.blocked strong {
  color: var(--red);
}

.enterprise-control-step small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enterprise-control-action {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.enterprise-control-action div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.enterprise-control-action span {
  color: var(--text-muted);
  font-size: 11px;
}

.enterprise-control-action small {
  min-width: 0;
  overflow: hidden;
  color: var(--green);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enterprise-control-action small.blocked {
  color: var(--yellow);
}

.enterprise-control-action strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enterprise-control-action button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.enterprise-control-action button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.enterprise-control-action button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.enterprise-control-feedback {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.enterprise-control-feedback span {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.enterprise-control-feedback strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enterprise-control-feedback small {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.enterprise-control-feedback.running {
  border-color: var(--accent);
}

.enterprise-control-feedback.success {
  border-color: var(--green);
}

.enterprise-control-feedback.error {
  border-color: var(--red);
}

.enterprise-control-feedback.error strong {
  color: var(--red);
}

.enterprise-control-audit {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.enterprise-control-audit span {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.enterprise-control-audit strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.decision-audit {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.decision-audit-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}

.decision-audit-grid {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 6px 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.decision-audit-grid strong {
  color: var(--text-secondary);
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
}

.decision-signals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.decision-signals span {
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 7px;
}

.decision-log-panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.decision-log-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.decision-log-head > button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.decision-log-head > button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.decision-log-head > button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.decision-log-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.decision-log-subtitle,
.decision-log-empty,
.decision-log-row {
  color: var(--text-muted);
  font-size: 12px;
}

.decision-log-empty,
.decision-log-row {
  margin-top: 8px;
}

.decision-log-row {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.decision-log-row-head,
.decision-log-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.decision-log-row-head span,
.decision-log-row-head strong {
  color: var(--text-secondary);
}

.decision-log-row-head strong {
  font-weight: 600;
}

.decision-log-reason {
  margin-top: 5px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.task-report-preview {
  margin-top: 8px;
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.task-report-saved {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.task-report-saved strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-weight: 500;
}

.task-report-title {
  position: sticky;
  top: 0;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.task-report-preview pre {
  margin: 0;
  padding: 8px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.decision-log-meta {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.permission-panel {
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.permission-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.permission-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.permission-subtitle,
.permission-reason,
.permission-grid {
  color: var(--text-muted);
  font-size: 12px;
}

.permission-risk {
  color: var(--yellow);
  font-size: 12px;
  white-space: nowrap;
}

.permission-reason {
  margin-top: 8px;
  overflow-wrap: anywhere;
}

.permission-grid {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 6px 10px;
  margin-top: 8px;
}

.permission-grid strong {
  color: var(--text-secondary);
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
}

.permission-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.permission-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
}

.permission-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.permission-actions .danger:hover:not(:disabled) {
  border-color: var(--red);
  color: var(--red);
}

.context-evidence-panel,
.command-auth-panel,
.readiness-panel,
.real-trial-panel,
.delivery-trust-panel,
.release-gate-panel,
.recovery-recommendation {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.command-auth-head,
.context-evidence-head,
.command-auth-row,
.readiness-head,
.real-trial-head,
.delivery-trust-head,
.release-gate-head,
.recovery-recommendation {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.command-auth-title,
.context-evidence-title,
.readiness-title,
.real-trial-title,
.delivery-trust-title,
.release-gate-title,
.recovery-recommendation-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.command-auth-subtitle,
.context-evidence-subtitle,
.command-auth-empty,
.readiness-subtitle,
.readiness-empty,
.readiness-path,
.real-trial-subtitle,
.delivery-trust-subtitle,
.release-gate-subtitle,
.release-gate-warning,
.release-gate-path,
.recovery-recommendation-subtitle,
.recovery-recommendation p {
  color: var(--text-muted);
  font-size: 12px;
}

.command-auth-head > span {
  color: var(--green);
  font-size: 12px;
  white-space: nowrap;
}

.context-evidence-head > span {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.context-evidence-head > span.ready {
  color: var(--green);
}

.context-evidence-head > span.warning {
  color: var(--yellow);
}

.context-evidence-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.context-evidence-grid.secondary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.context-evidence-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.context-evidence-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.context-evidence-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-evidence-source-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.context-evidence-source-row {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.context-evidence-source-row.warning {
  border-color: rgba(245, 158, 11, 0.45);
}

.context-evidence-source-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-evidence-source-row small {
  color: var(--text-muted);
  white-space: nowrap;
}

.context-evidence-empty {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.command-auth-head > span.danger {
  color: var(--red);
}

.readiness-head > span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.readiness-head > span.ready {
  color: var(--green);
}

.readiness-head > span.warning {
  color: var(--yellow);
}

.readiness-head > span.danger {
  color: var(--red);
}

.real-trial-head > span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.real-trial-head > span.ready {
  color: var(--green);
}

.real-trial-head > span.danger {
  color: var(--red);
}

.delivery-trust-head > span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.delivery-trust-head > span.ready {
  color: var(--green);
}

.delivery-trust-head > span.warning {
  color: var(--yellow);
}

.delivery-trust-head > span.danger {
  color: var(--red);
}

.release-gate-head > span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.release-gate-head > span.ready {
  color: var(--green);
}

.release-gate-head > span.danger {
  color: var(--red);
}

.release-gate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.real-trial-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.readiness-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.readiness-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
}

.readiness-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.readiness-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.real-trial-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
}

.real-trial-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.real-trial-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.release-gate-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
}

.release-gate-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

.release-gate-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.release-gate-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.readiness-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.real-trial-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.delivery-trust-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.real-trial-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.delivery-trust-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.readiness-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.real-trial-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.delivery-trust-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.readiness-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.real-trial-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-trust-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readiness-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-gate-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.release-gate-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.release-gate-grid strong {
  color: var(--text-bright);
  font-size: 13px;
}

.delivery-trust-next {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.delivery-trust-next strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-trust-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.delivery-trust-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.delivery-trust-row.risk {
  border-color: rgba(245, 158, 11, 0.45);
}

.delivery-trust-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-trust-row.risk strong {
  color: var(--yellow);
}

.release-gate-steps {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.release-gate-step {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.release-gate-step.failed {
  border-color: rgba(248, 113, 113, 0.5);
}

.release-gate-step span,
.release-gate-step small,
.release-gate-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-gate-step strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.release-gate-step.failed strong {
  color: var(--red);
}

.release-gate-step small {
  grid-column: 1 / -1;
  color: var(--text-muted);
}

.release-gate-warning,
.readiness-path,
.release-gate-path {
  margin-top: 8px;
  overflow-wrap: anywhere;
}

.readiness-check-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.readiness-check-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.readiness-check-row.warning {
  border-color: rgba(245, 158, 11, 0.45);
}

.readiness-check-row.failed {
  border-color: rgba(248, 113, 113, 0.5);
}

.readiness-check-row span,
.readiness-check-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readiness-check-row strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.readiness-check-row.warning strong {
  color: var(--yellow);
}

.readiness-check-row.failed strong {
  color: var(--red);
}

.readiness-check-row.remediation {
  grid-template-columns: minmax(0, 1fr) 48px;
}

.readiness-check-row small {
  grid-column: 1 / -1;
  color: var(--text-muted);
}

.readiness-audit {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.readiness-audit strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-auth-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.command-auth-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.command-auth-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-auth-row strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.command-auth-row em {
  color: var(--text-muted);
  font-style: normal;
}

.command-auth-row small {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
  color: var(--text-muted);
}

.command-auth-row.warning {
  border-color: rgba(245, 158, 11, 0.45);
}

.command-auth-row.danger {
  border-color: rgba(248, 113, 113, 0.5);
}

.command-auth-row.warning strong {
  color: var(--yellow);
}

.command-auth-row.danger strong {
  color: var(--red);
}

.recovery-recommendation {
  border-color: rgba(96, 165, 250, 0.35);
}

.recovery-recommendation p {
  margin: 0;
  max-width: 58%;
  overflow-wrap: anywhere;
}

.checkpoint-panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  padding: 10px;
}

.checkpoint-head,
.checkpoint-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.checkpoint-title {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.checkpoint-subtitle,
.checkpoint-empty,
.checkpoint-row {
  color: var(--text-muted);
  font-size: 12px;
}

.checkpoint-head button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
  color: var(--text-secondary);
  cursor: pointer;
}

.checkpoint-head button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.checkpoint-empty,
.checkpoint-row {
  margin-top: 8px;
}

.checkpoint-row span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
}

.assignment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
</style>
