import type { ContextEvidence } from "../ai/contextEvidence"

export interface OrchestratorRun {
  id: string
  goalId?: string | null
  projectRoot: string
  status: string
  runtimeStatus?: string
  runtimeStatusLabel?: string
  runtimeReason?: string
  projectKind?: "smoke-temp" | "codek-self" | "user-real" | string
  projectKindLabel?: string
  writeMode?: "proposed_patch_only" | "applying" | "applied" | "blocked_no_write" | "rejected_no_write" | "rolled_back" | string
  writeModeLabel?: string
  visibleMode: "ask" | "plan" | "agent" | "auto"
  executionStrategy: "single-agent" | "multi-agent"
  strategyReason?: string
  strategySignals?: Record<string, unknown>
  userInput?: string
  contextEvidence?: ContextEvidence | null
  blockingReason?: string
  summary?: string
  plan?: unknown
  assignments: AgentAssignment[]
  integrationDecision?: IntegrationDecision | null
  events?: OrchestratorEvent[]
  decisionLog?: DecisionAuditEntry[]
  permissionRequest?: PermissionRequest | null
  recoveryRecommendation?: RecoveryRecommendation | null
  memoryHits?: AgentMemoryHit[]
  realWorkspaceTrial?: RealWorkspaceTrialConfig | null
  createdAt: number
  updatedAt: number
}

export interface PermissionRequest {
  id: string
  runId: string
  status: "waiting_user" | "approved" | "rejected" | string
  risk: string
  readPaths: string[]
  writePaths: string[]
  commandAllowlist: string[]
  network: boolean
  install: boolean
  externalTool: boolean
  destructive: boolean
  reason: string
  createdAt: number
  decidedAt?: number | null
  decisionReason?: string
}

export interface DeliveryTrustSummary {
  score: number
  status: "trusted" | "review" | "blocked" | string
  statusLabel: string
  nextAction: string
  evidence: string[]
  risks: string[]
  failedChecks?: Array<{ id?: string; label?: string }>
  summary?: string
}

export interface LongTaskEvidenceChain {
  version?: number
  ready?: boolean
  attachmentContext?: {
    status?: string
    summary?: string
    files?: string[]
  }
  router?: {
    executionStrategy?: string
    expectedStrategy?: string
    matchedExpected?: boolean
    reason?: string
  }
  planTree?: {
    phaseCount?: number
    assignmentCount?: number
  }
  workspace?: {
    isolated?: boolean
    projectRoot?: string
    workspaceRoots?: string[]
  }
  diff?: {
    filesChanged?: string[]
    patchCount?: number
    beforeAcceptSnapshot?: Record<string, { sha256?: string; size?: number; exists?: boolean }>
    afterAcceptSnapshot?: Record<string, { sha256?: string; size?: number; exists?: boolean }>
    changedAfterAccept?: string[]
  }
  decision?: {
    beforeAcceptStatus?: string
    afterAcceptStatus?: string
    decisionStatus?: string
    userDecision?: string
  }
  qualityGate?: {
    status?: string
    command?: string
    passed?: boolean
  }
}

export interface DecisionAuditEntry {
  id: string
  runId: string
  type: string
  title?: string
  reason?: string
  inputSignals?: Record<string, unknown> | null
  options?: string[]
  selectedOption?: string
  risk?: string | null
  userConfirmed?: boolean
  status?: string
  blockingReason?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface OrchestratorTask {
  id: string
  runId: string
  title: string
  status: string
  runtimeStatus?: string
  runtimeStatusLabel?: string
  runtimeReason?: string
  visibleMode: "ask" | "plan" | "agent" | "auto"
  executionStrategy: "single-agent" | "multi-agent"
  routerDecision: {
    visibleMode: "ask" | "plan" | "agent" | "auto"
    executionStrategy: "single-agent" | "multi-agent"
    reason?: string
    signals?: Record<string, unknown>
  }
  requiresConfirmation: boolean
  blockingReason?: string
  createdAt: number
  updatedAt: number
}

export interface TaskCenterItem {
  id: string
  kind: "goal" | "orchestrator"
  title: string
  status: string
  runtimeStatus?: string
  runtimeStatusLabel?: string
  runtimeReason?: string
  stage?: string
  projectRoot?: string
  goalId?: string | null
  runId?: string | null
  executionStrategy?: string
  routerDecision?: OrchestratorTask["routerDecision"] | null
  blockingReason?: string
  recentEvent?: string
  nextAction?: string
  createdAt?: number
  updatedAt?: number
}

export interface TaskCenterSummary {
  total: number
  running: number
  blocked: number
  completed: number
}

export interface CreateOrchestratorTaskInput {
  message: string
  mode: "agent" | "auto"
  projectRoot?: string
  files?: string[]
  attachments?: Array<Record<string, unknown>>
  contextEvidence?: ContextEvidence | null
  contextSummary?: string
  permissionLevel?: "all" | "safe" | null
}

export interface RealWorkspaceTrialConfig {
  projectRoot?: string
  enabled?: boolean
  writeMode?: "proposed_patch_only" | "requires_explicit_accept" | string
  allowMainWorkspaceWrites?: boolean
  allowedPaths?: string[]
  requiresExplicitAllowedPaths?: boolean
  qualityGateCommands?: string[]
  blockedQualityGateCommands?: string[]
  maxAssignments?: number
  maxDurationMs?: number
  allowNetwork?: boolean
  allowInstall?: boolean
  allowExternalTool?: boolean
}

export interface RealWorkspaceTrialReport {
  runId?: string | null
  workspaceRoot: string
  status: string
  visibleMode: string
  executionStrategy: string
  routerReason?: string
  routerSignals?: Record<string, unknown>
  writeMode: string
  allowMainWorkspaceWrites: boolean
  allowedPaths: string[]
  qualityGateCommands: string[]
  blockedQualityGateCommands: string[]
  commandCapabilities?: Array<{
    command: string
    network: boolean
    install: boolean
  }>
  decisionId?: string | null
  decisionStatus?: string | null
  filesChanged: string[]
  mainWorkspaceUntouchedBeforeAccept: boolean
  rollbackAvailable: boolean
  permissionRequests: Array<Record<string, unknown>>
  recoveryActions: Array<Record<string, unknown>>
  reportKind: "real-workspace-trial" | string
}

export interface StartRealWorkspaceTrialInput {
  projectRoot: string
  userInput: string
  files?: string[]
  settings?: Record<string, unknown>
  config?: Partial<RealWorkspaceTrialConfig>
  plan?: unknown
  goal?: string
  risk?: string
  workspaceIsolation?: "auto" | string
}

export interface RealWorkspaceTrialHistoryItem {
  runId: string
  createdAt: number
  updatedAt: number
  finalStatus: string
  executionStrategy: string
  filesChanged: string[]
  jsonPath: string
  markdownPath: string
}

export interface OrchestratorReadinessCheck {
  id: string
  title: string
  status: "passed" | "warning" | "failed" | string
  statusLabel: string
  detail: string
  nextAction?: string
  data?: Record<string, unknown>
}

export interface OrchestratorReadinessRemediation {
  id: string
  checkIds?: string[]
  title: string
  detail: string
  scope: string
  risk: "safe" | "medium" | "high" | string
  canApplyInUi: boolean
  auditEvent?: string
  settingKeys?: string[]
  command?: string
}

export interface OrchestratorReadinessActionAudit {
  id: string
  createdAt: number
  actionId: string
  title: string
  status: string
  projectRoot: string
  summary: string
  settingKeys: string[]
  metadata?: Record<string, unknown>
}

export interface OrchestratorRunActionAudit {
  id: string
  createdAt: number
  startedAt: number
  finishedAt: number
  durationMs: number
  runId: string
  actionId: string
  title: string
  status: "started" | "success" | "error" | string
  projectRoot: string
  summary: string
  error: string
  metadata?: Record<string, unknown>
}

export interface AgentEvidenceWorkbenchStage {
  stage: "plan" | "execution" | "tests" | "failure-diagnostics" | "real-ui" | "workspace-diff" | "approval" | "rollback" | string
  title: string
  status: "ready" | "degraded" | "blocked" | "missing" | string
  ready: boolean
  available: boolean
  summary: string
  evidenceRefs: string[]
  nextAction: string
}

export interface AgentEvidenceWorkbenchReport {
  schemaVersion: number
  source: "releaseEvidence" | string
  timestamp: number
  workspace: {
    root: string
    protected: boolean
    isolation: string
  }
  correlationId: string
  commands: Array<{
    command: string
    source: string
    status: string
    exitCode: number | null
    timedOut?: boolean
    artifactIds: string[]
    outputProjectionIds?: string[]
    problemProjectionIds?: string[]
    taskRunIds?: string[]
  }>
  runStateSchema?: {
    states: string[]
    transitions: Record<string, string[]>
  }
  runs?: Array<{
    id: string
    state: string
    stateLabel?: string
    plannedAt?: number | null
    assignedAt?: number | null
    startedAt?: number | null
    updatedAt?: number | null
    completedAt?: number | null
    plan: {
      summary: string
      goal?: string
      steps: Array<{ id: string; title: string; status: string }>
      contextRefs?: string[]
    }
    phases: Array<{
      id: string
      title: string
      status: string
      ready: boolean
      evidenceRefs: string[]
      nextAction: string
    }>
    changedFiles: string[]
    diffSummary: {
      filesChanged: number
      files: string[]
      summary: string
      source: string
    }
    validationCommands: Array<{
      command: string
      status: string
      exitCode: number | null
      source: string
      timedOut?: boolean
    }>
    failureReasons: Array<{
      id: string
      stage: string
      severity: string
      detail: string
    }>
    rollbackRecommendation: {
      available: boolean
      action: string
      detail: string
      driftBlocked: boolean
    }
    costSummary: {
      available: boolean
      totalRequests: number
      inputTokens: number
      outputTokens: number
      totalTokens: number
      estimatedCostUsd: number
      currency: string
      estimated: boolean
      placeholder: boolean
    }
  }>
  artifacts: Array<{
    id: string
    kind: string
    label: string
    path: string
    source: string
  }>
  failureCauses: Array<{
    id: string
    severity: "info" | "warning" | "error" | string
    title: string
    detail: string
    source: string
    stage: string
  }>
  nextActions: Array<{
    id: string
    label: string
    surface: string
    stage: string
    priority: "high" | "medium" | "normal" | string
    commandId: string
  }>
  roleProfiles?: {
    available: boolean
    ready: boolean
    status: string
    statusLabel: string
    requiredTrialCount: number
    trialCount: number
    completeTrials: number
    runtimeIntegrationRecommended: boolean
    recommendation: string
    decisionReason: string
    runtimeContract: {
      attachToExistingOrchestratorRun: boolean
      attachToAssignment: boolean
      attachToEventArtifactEvidence: boolean
      noSecondStateSource: boolean
    }
    trials: Array<{
      id: string
      taskId: string
      runId: string
      assignmentId: string
      role: string
      profileId: string
      profileSource: string
      selectionReason: string
      permissionScope: {
        readPaths: string[]
        writePaths: string[]
        allowedTools: string[]
        commandAllowlist: string[]
        network: boolean
        install: boolean
        externalTool: boolean
        destructive: boolean
      }
      validationAdvice: string[]
      benefit: string
      noise: string
      runtimeFit: string
      worthRuntimeIntegration: boolean
      evidenceRefs: string[]
    }>
  }
  projections?: {
    taskRuns?: Array<{
      id: string
      stage: string
      name: string
      status: string
      command: string
      exitCode: number | null
      durationMs?: number | null
      outputProjectionIds?: string[]
      problemProjectionIds?: string[]
      artifactIds?: string[]
      rerunCommandId?: string
    }>
    outputs?: Array<{
      id: string
      stage: string
      channelName: string
      source: string
      status: string
      entryCount?: number
      warnCount?: number
      errorCount?: number
      preview?: string
      artifactIds?: string[]
      commandIds?: string[]
    }>
    problems?: Array<{
      id: string
      stage: string
      source: string
      status: string
      total?: number
      errorCount?: number
      warningCount?: number
      files?: string[]
      sourceNames?: string[]
      outputProjectionIds?: string[]
      taskRunIds?: string[]
    }>
    debug?: Array<{
      id: string
      stage: string
      source: string
      status: string
      sessionId?: string
      activeConfigName?: string
      breakpointCount?: number
      consoleEntryCount?: number
      outputProjectionIds?: string[]
    }>
    approvalBoundaries?: Array<{
      id: string
      stage: string
      status: string
      risk?: string
      reason?: string
      commandIds?: string[]
      protected?: boolean
    }>
    failureDiagnosis?: Array<{
      id: string
      stage: string
      status: string
      title: string
      detail?: string
      failureCauseIds?: string[]
      nextActionIds?: string[]
      taskRunIds?: string[]
      outputProjectionIds?: string[]
      problemProjectionIds?: string[]
      debugProjectionIds?: string[]
      approvalBoundaryIds?: string[]
      workspaceChangeRefs?: string[]
      rerunCommandIds?: string[]
    }>
    exportSnapshot?: {
      id?: string
      path?: string
      markdownPath?: string
      redacted?: boolean
      includes?: string[]
    }
  }
  progress: Array<{
    id: string
    title: string
    message: string
    stage: string
    status: string
    correlationId: string
    total: number
    worked: number
    location: "window" | "notification" | string
    cancellable: boolean
    aggregateStatus?: string
    ariaLabel?: string
    cancelCommandId?: string
  }>
  notifications: Array<{
    id: string
    severity: "info" | "warning" | "error" | string
    message: string
    source: string
    correlationId: string
    lifecycle: {
      state: "active" | "dismissed" | "updated" | string
      sticky: boolean
      updatedAt: number
      dismissible: boolean
    }
    dedupeKey?: string
    dismissCommandId?: string
    focusTarget?: string
    ariaLabel?: string
    actions: Array<{ id: string; label: string; surface: string }>
  }>
  phaseStatusSchema?: {
    stageIds: string[]
    statuses: string[]
  }
  phaseLifecycle?: Array<{
    id: string
    stage: string
    phaseName: string
    threadId: string
    status: string
    validation?: {
      status?: string
      result?: string
      command?: string
      detail?: string
      evidenceRefs?: string[]
      checkedAt?: number | null
    }
    failureRecovery?: {
      status?: string
      action?: string
      detail?: string
      retryable?: boolean
      recoveredAt?: number | null
    }
    evidenceRefs?: string[]
    updatedAt?: number
  }>
}

export interface AgentEvidenceWorkbenchSummary {
  schemaVersion: number
  available: boolean
  ready: boolean
  status: "ready" | "degraded" | "missing" | string
  statusLabel: string
  stageStatusSchema: {
    stageIds: string[]
    statuses: Array<"ready" | "degraded" | "blocked" | "missing" | string>
  }
  stageCount: number
  readyStages: number
  availableStages: number
  timeline: AgentEvidenceWorkbenchStage[]
  testing: {
    taskRuns: number
    passed: number
    failed: number
    blocked: number
    running: number
    skipped: number
    problemDiagnostics: number
    qualityGateStatus: string
    qualityGateCommands: number
    qualityGateFailures: number
    latestTask: string
  }
  failure: {
    blockingGaps: number
    highGaps: number
    mediumGaps: number
    taskRunIssues: number
    qualityGateFailures: number
    problemDiagnostics: number
    latestBlockingGap: {
      id: string
      title: string
      status: string
      severity: string
    } | null
  }
  scm: {
    fileCount: number
    files: string[]
    mainWorkspaceProtected: boolean
    rollbackAvailable: boolean
    pendingBatchBlocked: boolean
    pendingHunkBlocked: boolean
    reviewDisplayBlocked: boolean
  }
  approval: {
    permissionStatus: string
    permissionRisk: string
    permissionApproved: boolean
    writePathCount: number
    commandAllowlistCount: number
    commandAuthorizationBlocked: number
    commandAuthorizationNeedsPermission: number
    agentReviewBlocked: boolean
    operationLogVisible: boolean
  }
  rollback: {
    rollbackAvailable: boolean
    mainWorkspaceProtected: boolean
    agentRollbackDriftBlocked: boolean
    operationLogVisible: boolean
  }
  agentRoleTrials?: AgentEvidenceWorkbenchReport["roleProfiles"]
  report?: AgentEvidenceWorkbenchReport
  surface?: {
    schemaVersion: number
    scm: {
      providerLabel: string
      fileCount: number
      resourceGroupCount: number
      rollbackAvailable: boolean
      rollbackRisk: string
      files: string[]
      commandIds?: string[]
      resourceCommandCount?: number
    }
    testing: {
      state: string
      total: number
      passed: number
      failed: number
      blocked: number
      skipped: number
      diagnostics: number
      qualityGateFailures: number
      latestTask: string
      rerunCommandId?: string
      failureDetails?: string[]
      resourceLinks?: string[]
    }
    timeline: {
      source: string
      itemCount: number
      blocked: number
      degraded: number
      missing: number
      commandIds?: string[]
      linkedResourceCount?: number
    }
    progress: {
      active: number
      blocked: number
      degraded: number
      missing: number
      nextActions: string[]
      aggregateStatuses?: string[]
      cancelCommandId?: string
      ariaLabels?: string[]
    }
    notifications: {
      total: number
      errors: number
      warnings: number
      messages: string[]
      dedupeKeys?: string[]
      dismissCommandId?: string
      focusTargets?: string[]
    }
    actions: Array<{
      id: string
      label: string
      surface: string
      enabled: boolean
    }>
  }
  sourceEvidence: string[]
}

export interface ReleaseEvidenceSummary {
  reportKind: "release-evidence" | string
  createdAt: number
  ready: boolean
  status: "ready" | "degraded" | "missing" | string
  statusLabel: string
  summary: {
    total: number
    available: number
    ready: number
    missing: number
  }
  gaps?: Array<{
    id: string
    title: string
    severity: "high" | "medium" | "low" | "info" | string
    status: "missing" | "not_ready" | string
    reason: string
    action: string
  }>
  nextActions?: Array<{
    id: string
    title: string
    severity: "high" | "medium" | "low" | "info" | string
    action: string
  }>
  evidence?: Record<string, unknown> & {
    llmUsage?: {
      available: boolean
      ready: boolean
      statusLabel: string
      totalRequests: number
      inputTokens: number
      outputTokens: number
      totalTokens: number
      providerUsageRequests: number
      estimatedUsageRequests: number
      estimatedCostUsd?: number
      costCurrency?: string
      costEstimated?: boolean
      pricedRequests?: number
      unpricedRequests?: number
      unpricedModels?: Array<{ provider?: string; model?: string; requests?: number }>
    }
    codebaseContext?: {
      available: boolean
      ready: boolean
      status: "ready" | "degraded" | "missing" | string
      statusLabel: string
      runId: string
      updatedAt?: number
      sources: number
      mentions: number
      attachments: number
      rules: number
      workspaceSources: number
      warnings: number
      truncatedSources: number
      overflowChars: number
      estimatedChars: number
      contextBlockChars: number
      workspaceContextChars: number
      taskType: string
      riskLevel: string
      mentionTypes?: Record<string, number>
      workspaceSourceTypes?: Record<string, number>
      indexStatus: {
        enabled: boolean
        state: string
        indexedFiles: number
        indexableFiles: number
        excludedFiles: number
        workspaceRoots: number
        freshness: string
        updatedAt: number | null
      }
    }
    sandboxSecurity?: {
      available: boolean
      ready: boolean
      status: "ready" | "blocked" | "missing" | string
      statusLabel: string
      runId: string
      updatedAt?: number | null
      assignmentCount: number
      isolatedAssignments: number
      mainWorkspaceAssignments: number
      workspaceIsolationTypes?: Record<string, number>
      permissionStatus: string
      permissionRisk: string
      permissionApproved: boolean
      permissionRejected: boolean
      writePathCount: number
      commandAllowlistCount: number
      networkAllowed: boolean
      installAllowed: boolean
      externalToolAllowed: boolean
      destructiveAllowed: boolean
      qualityGateStatus: string
      qualityGateCommands: number
      qualityGateFailures: number
      commandAuthorizationBlocked: number
      commandAuthorizationNeedsPermission: number
      patchPermissionViolations: number
      rollbackAvailable: boolean
      violations?: Array<{ id: string; severity?: string }>
    }
    taskRuns?: {
      available: boolean
      ready: boolean
      status: "ready" | "degraded" | "missing" | string
      statusLabel: string
      total: number
      passed: number
      failed: number
      blocked: number
      running: number
      skipped: number
      latest?: {
        id: string
        name: string
        status: string
        durationMs: number | null
      } | null
      runs?: Array<{
        id: string
        name: string
        status: string
        stepCount: number
        passedSteps: number
        failedSteps: number
        skippedSteps: number
        runningSteps: number
        maxDependencyDepth: number
        hasParallelSteps: boolean
      }>
    }
    axEnterpriseGate?: {
      available: boolean
      ready: boolean
      status: "ready" | "blocked" | "missing" | string
      statusLabel: string
      readyCount: number
      total: number
      blocked: number
      missing: number
    }
    agentEvidenceWorkbench?: AgentEvidenceWorkbenchSummary
  }
  paths?: Record<string, string>
  markdownPath?: string
  jsonPath?: string
}

export interface ReleaseEvidenceHistoryItem {
  createdAt: number
  status: string
  statusLabel: string
  ready: boolean
  summary: ReleaseEvidenceSummary["summary"]
  jsonPath: string
  markdownPath: string
}

export interface OrchestratorReadinessReport {
  reportKind: "orchestrator-readiness" | string
  createdAt: number
  status: "ready" | "degraded" | "blocked" | string
  statusLabel: string
  ready: boolean
  projectRoot: string
  realWorkspaceTrial: RealWorkspaceTrialConfig
  summary: {
    total: number
    passed: number
    warning: number
    failed: number
    blocked?: number
  }
  checks: OrchestratorReadinessCheck[]
  remediations?: OrchestratorReadinessRemediation[]
  nextAction: string
}

export interface OrchestratorReadinessHistoryItem {
  createdAt: number
  status: string
  statusLabel: string
  ready: boolean
  projectRoot: string
  summary: OrchestratorReadinessReport["summary"]
  nextAction: string
  jsonPath: string
  markdownPath: string
}

export interface CheckOrchestratorReadinessInput {
  projectRoot?: string
  settings?: Record<string, unknown>
  config?: Partial<RealWorkspaceTrialConfig>
  reportDir?: string
  writeLatest?: boolean
}

export interface SaveReadinessActionAuditInput {
  actionId: string
  title: string
  status?: string
  projectRoot?: string
  summary?: string
  settingKeys?: string[]
  metadata?: Record<string, unknown>
  reportDir?: string
}

export interface SaveRunActionAuditInput {
  runId?: string
  actionId: string
  title: string
  status: "started" | "success" | "error" | string
  projectRoot?: string
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  summary?: string
  error?: string
  metadata?: Record<string, unknown>
  reportDir?: string
}

export interface OrchestratorEvent {
  id?: string
  runId?: string
  type?: string
  status?: string
  phaseId?: string
  error?: string
  createdAt?: number
  [key: string]: unknown
}

export interface AgentAssignment {
  id: string
  phaseId: string
  role: string
  status: string
  workspaceId?: string | null
  sandboxId?: string | null
  sandboxMode?: string
  allowedTools?: string[]
  readPaths?: string[]
  writePaths?: string[]
  lockedFiles?: string[]
  requiresConsensus?: boolean
  consensusWith?: string[]
  consensusForStepId?: string
}

export interface AgentMemoryHit {
  id: string
  type: string
  source?: string
  agentRole?: string
  content: string
}

export interface AgentArtifact {
  id: string
  runId: string
  assignmentId?: string | null
  type: string
  path?: string | null
  content: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface RecoveryAction {
  id: string
  runId: string
  assignmentId?: string | null
  phaseId?: string | null
  action: "retry" | "rewind" | "split" | "ask_user" | "abort"
  status: string
  reason: string
  payload?: Record<string, unknown>
  createdAt: number
  completedAt?: number | null
}

export interface OrchestratorCheckpoint {
  id: string
  runId: string
  stage: string
  summary?: string
  artifactIds?: string[]
  recoveryActionIds?: string[]
  canResume: boolean
  createdAt: number
  [key: string]: unknown
}

export interface RecoveryRecommendation {
  action: string
  reason: string
  createdAt?: number
}

export interface CommandAuthorizationSummary {
  ok: boolean
  total: number
  allowed: number
  blocked: number
  needsPermission: number
  commands: Array<{
    command: string
    status: "allowed" | "blocked" | "needs_permission" | string
    reasons: string[]
    capabilities: {
      network: boolean
      install: boolean
      externalTool: boolean
    }
    source: string
  }>
}

export interface RunTaskReport {
  runId: string
  userGoal: string
  finalStatus: string
  finalStatusLabel: string
  runtimeReason?: string
  nextAction?: string
  projectRoot: string
  projectKind?: string
  projectKindLabel?: string
  writeMode?: string
  writeModeLabel?: string
  router: {
    visibleMode: string
    executionStrategy: string
    reason?: string
    signals?: Record<string, unknown>
  }
  fileScope: string[]
  realWorkspaceTrial?: RealWorkspaceTrialReport | null
  markdown: string
}

export interface IntegrationDecision {
  id: string
  runId: string
  status: string
  conflicts: Array<{ file: string; assignments: string[] }>
  proposedPatch: ProposedPatch
  qualityGate?: {
    status: string
    summary: string
    commandResults?: Array<{ command: string; exitCode: number; stdout?: string; stderr?: string; durationMs?: number }>
  } | null
  applyResult?: { status: string; filesChanged?: string[]; appliedAt?: number } | null
  rollbackResult?: { status: string; filesChanged?: string[]; restoredAt?: number } | null
  reason: string
}

export interface ProposedPatch {
  summary: string
  filesChanged: string[]
  patches?: Array<{ artifactId?: string; assignmentId?: string | null; filesChanged: string[]; content: string }>
  summaryDetails?: {
    totalFiles: number
    totalAdditions: number
    totalDeletions: number
    permissionViolationCount: number
    files: Array<{
      file: string
      assignmentIds: string[]
      artifactIds: string[]
      additions: number
      deletions: number
      risk: string
      permission: string
    }>
  }
}

export interface EvalReportSummary {
  createdAt?: number
  total: number
  passed: number
  failed: number
  results?: Array<Record<string, unknown>>
  runMetrics?: Record<string, unknown> | null
  strategyComparison?: EvalStrategyComparison | null
  realRunComparison?: EvalRealRunComparison | null
  routerCalibration?: EvalRouterCalibration | null
  routerShadowEval?: EvalRouterShadowEval | null
}

export interface EvalStrategyComparison {
  total: number
  recommendedSingleAgent: number
  recommendedMultiAgent: number
  routerAgreement: number
  routerAgreementRate: number
  averageSingleScore: number
  averageMultiScore: number
  averageRecommendedScore: number
  averageSuccessProbability: number
  averageEstimatedDurationMs: number
  averageConflictRisk: number
  averageQualityGateRisk: number
}

export interface EvalRealRunComparison {
  totalTasks: number
  totalRuns: number
  completedRuns: number
  singleAgentWins: number
  multiAgentWins: number
  averageDurationMs: number
  totalQualityGateFailures: number
  totalConflicts: number
}

export interface EvalRouterCalibration {
  total: number
  recommendationAligned: number
  routerAligned: number
  misaligned: number
  qualityGateFailureTasks: number
  conflictTasks: number
  suggestions: Record<string, number>
}

export interface EvalRouterShadowEval {
  total: number
  currentAligned: number
  candidateAligned: number
  currentMisaligned: number
  candidateMisaligned: number
  improved: number
  regressed: number
  switched: number
  recommendation: string
  config: Record<string, number | string | boolean>
}

export interface EvalReportHistoryItem {
  id: string
  createdAt: number
  total: number
  passed: number
  failed: number
  successRate: number
  strategyComparison?: EvalStrategyComparison | null
  realRunComparison?: EvalRealRunComparison | null
  routerCalibration?: EvalRouterCalibration | null
  routerShadowEval?: EvalRouterShadowEval | null
  jsonPath: string
  markdownPath: string
}

export interface AcceptanceScenarioSummary {
  id: string
  label: string
  category?: string
  passed: boolean
  strategy: string
  fixtureType: string
  status: string
  qualityGateStatus: string
  conflictCount: number
  patchArtifactCount: number
  filesChanged: string[]
  checks?: Array<{ id: string; label: string; passed: boolean; details?: Record<string, unknown> }>
}

export type AcceptanceTaskSetId = "standard" | "quick" | "risk"

export interface AcceptanceTaskSetOption {
  id: AcceptanceTaskSetId
  label: string
  description: string
}

export interface AcceptanceComparisonSummary {
  taskSet: AcceptanceTaskSetId
  ready: boolean
  successRate: number
  scenarioPassRate: number
  blocked: number
  qualityGateFailures: number
  conflictScenarios: number
  mainFlow?: {
    strategy?: string | null
    phaseCount?: number
    assignmentCount?: number
    filesChanged?: string[]
  } | null
}

export interface AcceptanceReportSummary {
  createdAt?: number
  finishedAt?: number
  durationMs?: number
  taskSet?: AcceptanceTaskSetId
  taskSetLabel?: string
  total: number
  passed: number
  failed: number
  ready: boolean
  comparison?: AcceptanceComparisonSummary
  routerData?: {
    totalSamples: number
    recommendation: string
    calibration?: EvalRouterCalibration
    shadow?: EvalRouterShadowEval
  }
  longTask?: {
    ready: boolean
    routerDecision?: { executionStrategy?: string; reason?: string; signals?: Record<string, unknown> }
    run?: {
      id?: string
      status?: string
      phaseCount?: number
      assignmentCount?: number
      filesChanged?: string[]
      strategyReason?: string
      projectRoot?: string
    }
    deliveryTrust?: DeliveryTrustSummary
    evidenceChain?: LongTaskEvidenceChain
    checks?: Array<{ id: string; label: string; passed: boolean; details?: Record<string, unknown> }>
  } | null
  matrix?: {
    total: number
    passed: number
    failed: number
    scenarios: AcceptanceScenarioSummary[]
  }
  run?: Record<string, unknown>
  recovery?: Record<string, unknown>
  checks?: Array<{ id: string; label: string; passed: boolean; details?: Record<string, unknown> }>
}

export interface AcceptanceReportHistoryItem {
  id: string
  createdAt: number
  finishedAt?: number
  durationMs: number
  taskSet?: AcceptanceTaskSetId
  total: number
  passed: number
  failed: number
  ready: boolean
  successRate: number
  matrix: {
    total: number
    passed: number
    failed: number
  }
  jsonPath: string
  markdownPath: string
}

export type ReleaseGateMode = "quick" | "build" | "full"

export interface ReleaseGateStep {
  id: string
  label: string
  command: string
  exitCode: number
  passed: boolean
  durationMs: number
  error?: string
}

export interface ReleaseGateReport {
  createdAt?: number
  mode: ReleaseGateMode | string
  ready: boolean
  durationMs: number
  plannedSteps: string[]
  steps: ReleaseGateStep[]
  warnings?: Array<{ id?: string; severity?: string; note?: string }>
  jsonPath?: string
}

export interface ReleaseCiCheck {
  id: string
  label: string
  passed: boolean
  detail?: string
}

export interface ReleaseCiWarning {
  id: string
  label: string
  detail?: string
  severity?: string
}

export interface ReleaseCiCheckReport {
  ok: boolean
  workflowPath: string
  releaseEvidence: {
    ok: boolean
    evidencePath: string
    exists: boolean
    createdAt?: number
    ageMs?: number
    maxAgeMs?: number
    fresh?: boolean
    checks: ReleaseCiCheck[]
    warnings: ReleaseCiWarning[]
  }
  checks: ReleaseCiCheck[]
  warnings: ReleaseCiWarning[]
}

interface CodekApi {
  api: (method: string, path: string, body?: unknown) => Promise<unknown>
  openExternal?: (target: string) => Promise<unknown>
  openEvalReport?: (target: string) => Promise<unknown>
  agentLoop?: {
    onEvent?: (callback: (payload: OrchestratorEvent) => void) => () => void
  }
}

function codek(): CodekApi | null {
  return (window as unknown as { codek?: CodekApi }).codek || null
}

function envelope<T>(value: unknown): T {
  const outer = value as { data?: unknown } | null
  return ((outer && outer.data) || value) as T
}

export async function listOrchestratorRuns(): Promise<OrchestratorRun[]> {
  const bridge = codek()
  if (!bridge) return []
  const result = envelope<{ runs?: OrchestratorRun[] }>(await bridge.api("GET", "/api/orchestrator/runs"))
  return result.runs || []
}

export async function createOrchestratorTask(input: CreateOrchestratorTaskInput): Promise<{
  task: OrchestratorTask | null
  run: OrchestratorRun | null
}> {
  const bridge = codek()
  if (!bridge) return { task: null, run: null }
  const result = envelope<{ task?: OrchestratorTask; run?: OrchestratorRun }>(
    await bridge.api("POST", "/api/orchestrator/tasks", input),
  )
  return {
    task: result.task || null,
    run: result.run || null,
  }
}

export async function startRealWorkspaceTrial(input: StartRealWorkspaceTrialInput): Promise<{ run: OrchestratorRun | null }> {
  const bridge = codek()
  if (!bridge) return { run: null }
  const result = envelope<{ run?: OrchestratorRun }>(
    await bridge.api("POST", "/api/orchestrator/real-workspace-trial/run", input),
  )
  return { run: result.run || null }
}

export async function getLatestRealWorkspaceTrialReport(): Promise<{
  report: RunTaskReport | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: RealWorkspaceTrialHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: RunTaskReport | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: RealWorkspaceTrialHistoryItem[]
  }>(await bridge.api("GET", "/api/orchestrator/real-workspace-trial/latest"))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function checkOrchestratorReadiness(
  input: CheckOrchestratorReadinessInput,
): Promise<{
  report: OrchestratorReadinessReport | null
  jsonPath: string
  markdownPath: string
  history: OrchestratorReadinessHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: OrchestratorReadinessReport | null
    jsonPath?: string
    markdownPath?: string
    history?: OrchestratorReadinessHistoryItem[]
  }>(
    await bridge.api("POST", "/api/orchestrator/readiness/check", input),
  )
  return {
    report: result.report || null,
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function getLatestOrchestratorReadinessReport(): Promise<{
  report: OrchestratorReadinessReport | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: OrchestratorReadinessHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: OrchestratorReadinessReport | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: OrchestratorReadinessHistoryItem[]
  }>(await bridge.api("GET", "/api/orchestrator/readiness/latest"))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function saveOrchestratorReadinessActionAudit(
  input: SaveReadinessActionAuditInput,
): Promise<{
  entry: OrchestratorReadinessActionAudit | null
  auditPath: string
  history: OrchestratorReadinessActionAudit[]
}> {
  const bridge = codek()
  if (!bridge) return { entry: null, auditPath: "", history: [] }
  const result = envelope<{
    entry?: OrchestratorReadinessActionAudit | null
    auditPath?: string
    history?: OrchestratorReadinessActionAudit[]
  }>(
    await bridge.api("POST", "/api/orchestrator/readiness/actions/audit", input),
  )
  return {
    entry: result.entry || null,
    auditPath: result.auditPath || "",
    history: result.history || [],
  }
}

export async function listOrchestratorReadinessActionAudits(): Promise<{
  history: OrchestratorReadinessActionAudit[]
}> {
  const bridge = codek()
  if (!bridge) return { history: [] }
  const result = envelope<{ history?: OrchestratorReadinessActionAudit[] }>(
    await bridge.api("GET", "/api/orchestrator/readiness/actions/audit"),
  )
  return { history: result.history || [] }
}

export async function saveOrchestratorRunActionAudit(
  input: SaveRunActionAuditInput,
): Promise<{
  entry: OrchestratorRunActionAudit | null
  auditPath: string
  history: OrchestratorRunActionAudit[]
}> {
  const bridge = codek()
  if (!bridge) return { entry: null, auditPath: "", history: [] }
  const result = envelope<{
    entry?: OrchestratorRunActionAudit | null
    auditPath?: string
    history?: OrchestratorRunActionAudit[]
  }>(
    await bridge.api("POST", "/api/orchestrator/run-actions/audit", input),
  )
  return {
    entry: result.entry || null,
    auditPath: result.auditPath || "",
    history: result.history || [],
  }
}

export async function listOrchestratorRunActionAudits(): Promise<{
  history: OrchestratorRunActionAudit[]
}> {
  const bridge = codek()
  if (!bridge) return { history: [] }
  const result = envelope<{ history?: OrchestratorRunActionAudit[] }>(
    await bridge.api("GET", "/api/orchestrator/run-actions/audit"),
  )
  return { history: result.history || [] }
}

export async function listOrchestratorTasks(): Promise<OrchestratorTask[]> {
  const bridge = codek()
  if (!bridge) return []
  const result = envelope<{ tasks?: OrchestratorTask[] }>(await bridge.api("GET", "/api/orchestrator/tasks"))
  return result.tasks || []
}

export async function listTaskCenter(): Promise<{ tasks: TaskCenterItem[]; summary: TaskCenterSummary }> {
  const bridge = codek()
  if (!bridge) return { tasks: [], summary: { total: 0, running: 0, blocked: 0, completed: 0 } }
  const result = envelope<{ tasks?: TaskCenterItem[]; summary?: TaskCenterSummary }>(
    await bridge.api("GET", "/api/tasks/center"),
  )
  return {
    tasks: result.tasks || [],
    summary: result.summary || { total: 0, running: 0, blocked: 0, completed: 0 },
  }
}

export async function getOrchestratorRun(id: string): Promise<OrchestratorRun | null> {
  const bridge = codek()
  if (!bridge || !id) return null
  try {
    const result = envelope<{ run?: OrchestratorRun }>(await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(id)}`))
    return result.run || null
  } catch {
    return null
  }
}

export async function listOrchestratorArtifacts(runId: string): Promise<AgentArtifact[]> {
  const bridge = codek()
  if (!bridge || !runId) return []
  const result = envelope<{ artifacts?: AgentArtifact[] }>(await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/artifacts`))
  return result.artifacts || []
}

export async function listOrchestratorEvents(runId: string, since = 0): Promise<OrchestratorEvent[]> {
  const bridge = codek()
  if (!bridge || !runId) return []
  const suffix = since > 0 ? `?since=${encodeURIComponent(String(since))}` : ""
  const result = envelope<{ events?: OrchestratorEvent[] }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/events${suffix}`),
  )
  return result.events || []
}

export async function listOrchestratorDecisions(runId: string): Promise<DecisionAuditEntry[]> {
  const bridge = codek()
  if (!bridge || !runId) return []
  const result = envelope<{ decisions?: DecisionAuditEntry[] }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/decisions`),
  )
  return result.decisions || []
}

export async function getRunTaskReport(runId: string): Promise<{ report: RunTaskReport | null; markdown: string }> {
  const bridge = codek()
  if (!bridge || !runId) return { report: null, markdown: "" }
  const result = envelope<{ report?: RunTaskReport; markdown?: string }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/report`),
  )
  return {
    report: result.report || null,
    markdown: result.markdown || result.report?.markdown || "",
  }
}

export async function saveRunTaskReport(runId: string, reportDir?: string): Promise<{
  report: RunTaskReport | null
  markdownPath: string
  jsonPath: string
}> {
  const bridge = codek()
  if (!bridge || !runId) return { report: null, markdownPath: "", jsonPath: "" }
  const result = envelope<{ report?: RunTaskReport; markdownPath?: string; jsonPath?: string }>(
    await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/report/save`, { reportDir }),
  )
  return {
    report: result.report || null,
    markdownPath: result.markdownPath || "",
    jsonPath: result.jsonPath || "",
  }
}

export async function getRunCommandAuthorization(runId: string): Promise<CommandAuthorizationSummary | null> {
  const bridge = codek()
  if (!bridge || !runId) return null
  try {
    const result = envelope<{ authorization?: CommandAuthorizationSummary }>(
      await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/command-authorization`),
    )
    return result.authorization || null
  } catch {
    return null
  }
}

export async function listOrchestratorCheckpoints(runId: string): Promise<{
  checkpoints: OrchestratorCheckpoint[]
  latest: OrchestratorCheckpoint | null
}> {
  const bridge = codek()
  if (!bridge || !runId) return { checkpoints: [], latest: null }
  const result = envelope<{ checkpoints?: OrchestratorCheckpoint[]; latest?: OrchestratorCheckpoint | null }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/checkpoints`),
  )
  return {
    checkpoints: result.checkpoints || [],
    latest: result.latest || null,
  }
}

export async function resumeOrchestratorRun(runId: string): Promise<{
  run: OrchestratorRun | null
  checkpoint: OrchestratorCheckpoint | null
  resumed: boolean
  reason?: string
}> {
  const bridge = codek()
  if (!bridge || !runId) return { run: null, checkpoint: null, resumed: false }
  const result = envelope<{
    run?: OrchestratorRun
    checkpoint?: OrchestratorCheckpoint | null
    resumed?: boolean
    reason?: string
  }>(await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/resume`, {}))
  return {
    run: result.run || null,
    checkpoint: result.checkpoint || null,
    resumed: result.resumed === true,
    reason: result.reason,
  }
}

export async function pauseOrchestratorRun(runId: string, reason = ""): Promise<{
  run: OrchestratorRun | null
  checkpoint: OrchestratorCheckpoint | null
  paused: boolean
  previousStatus?: string
}> {
  const bridge = codek()
  if (!bridge || !runId) return { run: null, checkpoint: null, paused: false }
  const result = envelope<{
    run?: OrchestratorRun
    checkpoint?: OrchestratorCheckpoint | null
    paused?: boolean
    previousStatus?: string
  }>(await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/pause`, { reason }))
  return {
    run: result.run || null,
    checkpoint: result.checkpoint || null,
    paused: result.paused === true,
    previousStatus: result.previousStatus,
  }
}

export async function resolveOrchestratorPermission(
  runId: string,
  decision: "approved" | "rejected",
  reason = "",
): Promise<{ run: OrchestratorRun | null }> {
  const bridge = codek()
  if (!bridge || !runId) return { run: null }
  const result = envelope<{ run?: OrchestratorRun }>(
    await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/permission`, { decision, reason }),
  )
  return { run: result.run || null }
}

export async function getOrchestratorDiff(runId: string): Promise<ProposedPatch | null> {
  const bridge = codek()
  if (!bridge || !runId) return null
  const result = envelope<{ diff?: ProposedPatch }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/diff`),
  )
  return result.diff || null
}

export async function getLatestEvalReport(): Promise<{
  report: EvalReportSummary | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: EvalReportHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: EvalReportSummary | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: EvalReportHistoryItem[]
  }>(await bridge.api("GET", "/api/orchestrator/evals/latest"))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function runEvalReport(): Promise<{
  report: EvalReportSummary | null
  jsonPath: string
  markdownPath: string
  history: EvalReportHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: EvalReportSummary
    jsonPath?: string
    markdownPath?: string
    history?: EvalReportHistoryItem[]
  }>(await bridge.api("POST", "/api/orchestrator/evals/run", {}))
  return {
    report: result.report || null,
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function getLatestAcceptanceReport(): Promise<{
  report: AcceptanceReportSummary | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: AcceptanceReportHistoryItem[]
  taskSets: AcceptanceTaskSetOption[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [], taskSets: [] }
  const result = envelope<{
    report?: AcceptanceReportSummary | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: AcceptanceReportHistoryItem[]
    taskSets?: AcceptanceTaskSetOption[]
  }>(await bridge.api("GET", "/api/orchestrator/acceptance/latest"))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
    taskSets: result.taskSets || [],
  }
}

export async function runAcceptanceReport(taskSet?: AcceptanceTaskSetId): Promise<{
  report: AcceptanceReportSummary | null
  jsonPath: string
  markdownPath: string
  history: AcceptanceReportHistoryItem[]
  taskSets: AcceptanceTaskSetOption[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, jsonPath: "", markdownPath: "", history: [], taskSets: [] }
  const result = envelope<{
    report?: AcceptanceReportSummary
    jsonPath?: string
    markdownPath?: string
    history?: AcceptanceReportHistoryItem[]
    taskSets?: AcceptanceTaskSetOption[]
  }>(await bridge.api("POST", "/api/orchestrator/acceptance/run", { taskSet }))
  return {
    report: result.report || null,
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
    taskSets: result.taskSets || [],
  }
}

export async function getLatestReleaseGateReport(): Promise<{
  report: ReleaseGateReport | null
  jsonPath: string
}> {
  const bridge = codek()
  if (!bridge) return { report: null, jsonPath: "" }
  const result = envelope<{ report?: ReleaseGateReport | null; jsonPath?: string }>(
    await bridge.api("GET", "/api/orchestrator/release-gate/latest"),
  )
  return {
    report: result.report || null,
    jsonPath: result.jsonPath || result.report?.jsonPath || "",
  }
}

export async function getReleaseCiCheckReport(): Promise<ReleaseCiCheckReport | null> {
  const bridge = codek()
  if (!bridge) return null
  return envelope<ReleaseCiCheckReport>(await bridge.api("GET", "/api/orchestrator/release-ci/check"))
}

export async function getLatestReleaseEvidenceSummary(): Promise<{
  report: ReleaseEvidenceSummary | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: ReleaseEvidenceHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: ReleaseEvidenceSummary | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: ReleaseEvidenceHistoryItem[]
  }>(await bridge.api("GET", "/api/orchestrator/release-evidence/latest"))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function exportReleaseEvidenceSummary(): Promise<{
  report: ReleaseEvidenceSummary | null
  markdown: string
  jsonPath: string
  markdownPath: string
  history: ReleaseEvidenceHistoryItem[]
}> {
  const bridge = codek()
  if (!bridge) return { report: null, markdown: "", jsonPath: "", markdownPath: "", history: [] }
  const result = envelope<{
    report?: ReleaseEvidenceSummary | null
    markdown?: string
    jsonPath?: string
    markdownPath?: string
    history?: ReleaseEvidenceHistoryItem[]
  }>(await bridge.api("POST", "/api/orchestrator/release-evidence/export", {}))
  return {
    report: result.report || null,
    markdown: result.markdown || "",
    jsonPath: result.jsonPath || "",
    markdownPath: result.markdownPath || "",
    history: result.history || [],
  }
}

export async function runReleaseGateReport(mode: ReleaseGateMode = "quick"): Promise<{
  report: ReleaseGateReport | null
  jsonPath: string
}> {
  const bridge = codek()
  if (!bridge) return { report: null, jsonPath: "" }
  const result = envelope<{ report?: ReleaseGateReport | null; jsonPath?: string }>(
    await bridge.api("POST", "/api/orchestrator/release-gate/run", { mode }),
  )
  return {
    report: result.report || null,
    jsonPath: result.jsonPath || result.report?.jsonPath || "",
  }
}

export async function openEvalReport(markdownPath: string): Promise<void> {
  const bridge = codek()
  if (!bridge || !markdownPath) return
  if (bridge.openEvalReport) {
    await bridge.openEvalReport(markdownPath)
    return
  }
  if (!bridge.openExternal) return
  await bridge.openExternal(markdownPath)
}

export function subscribeOrchestratorEvents(callback: (event: OrchestratorEvent) => void): () => void {
  const bridge = codek()
  return bridge?.agentLoop?.onEvent?.(callback) || (() => {})
}

export async function decideOrchestratorRun(
  runId: string,
  decision: "accepted" | "rejected" | "rework_requested" | "rollback",
  reason = "",
): Promise<{ decision: IntegrationDecision | null; run: OrchestratorRun | null; artifacts: AgentArtifact[] }> {
  const bridge = codek()
  if (!bridge || !runId) return { decision: null, run: null, artifacts: [] }
  const result = envelope<{ decision?: IntegrationDecision }>(
    await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/decision`, { decision, reason }),
  )
  const rich = result as { decision?: IntegrationDecision; run?: OrchestratorRun; artifacts?: AgentArtifact[] }
  return {
    decision: rich.decision || null,
    run: rich.run || null,
    artifacts: rich.artifacts || [],
  }
}

export async function listRecoveryActions(runId: string): Promise<RecoveryAction[]> {
  const bridge = codek()
  if (!bridge || !runId) return []
  const result = envelope<{ actions?: RecoveryAction[] }>(
    await bridge.api("GET", `/api/orchestrator/runs/${encodeURIComponent(runId)}/recovery-actions`),
  )
  return result.actions || []
}

export async function executeRecoveryAction(
  runId: string,
  actionId: string,
): Promise<{ action: RecoveryAction | null; run: OrchestratorRun | null; artifacts: AgentArtifact[] }> {
  const bridge = codek()
  if (!bridge || !runId || !actionId) return { action: null, run: null, artifacts: [] }
  const result = envelope<{ action?: RecoveryAction; run?: OrchestratorRun; artifacts?: AgentArtifact[] }>(
    await bridge.api("POST", `/api/orchestrator/runs/${encodeURIComponent(runId)}/recovery-actions/${encodeURIComponent(actionId)}/execute`, {}),
  )
  return {
    action: result.action || null,
    run: result.run || null,
    artifacts: result.artifacts || [],
  }
}
