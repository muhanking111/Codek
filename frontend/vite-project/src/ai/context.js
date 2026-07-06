import { buildIndex, getIndexStatus } from "./indexer"
import { getOpenFiles, readProjectFile, workspace } from "../workspace/manager"
import { getFileDiagnostics, getFileOutline, getProjectSymbols, getSymbolReferences } from "../workspace/analysisState"

const DEFAULT_MODEL_WINDOW_CHARS = 64_000
const DEFAULT_RESPONSE_RESERVE_CHARS = 8_000

function clip(value, limit = 240) {
  const text = String(value ?? "")
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function sourceName(filePath) {
  return String(filePath || "").split(/[\\/]/).pop() || String(filePath || "")
}

function evidenceSource(source) {
  return {
    type: clip(source.type, 80),
    label: clip(source.label, 240),
    path: source.path ? clip(source.path, 500) : undefined,
    detail: source.detail ? clip(source.detail, 500) : undefined,
    count: Number.isFinite(source.count) ? source.count : undefined,
    contentLength: Number.isFinite(source.contentLength) ? source.contentLength : 0,
    truncated: source.truncated === true,
  }
}

function inferTaskType(query) {
  const text = String(query || "").toLowerCase()
  if (/(fix|bug|error|报错|修复|失败|crash)/.test(text)) return "fix"
  if (/(refactor|重构|优化|拆分|性能)/.test(text)) return "refactor"
  if (/(test|测试|验证|smoke|e2e)/.test(text)) return "test"
  if (/(plan|设计|方案|计划)/.test(text)) return "plan"
  return "general"
}

function inferRiskLevel(query, diagnostics) {
  const text = String(query || "").toLowerCase()
  if (/(delete|remove|rm |迁移|权限|安全|支付|认证|登录|sandbox|release|发布|删除)/.test(text)) return "high"
  if (Array.isArray(diagnostics) && diagnostics.some((item) => item?.severity === "error")) return "medium"
  return "normal"
}

function buildBudgetPolicy(options, estimatedChars, diagnostics) {
  const modelWindowChars = Math.max(4_000, Number(options.modelWindowChars || DEFAULT_MODEL_WINDOW_CHARS))
  const reservedResponseChars = Math.max(1_000, Number(options.reservedResponseChars || DEFAULT_RESPONSE_RESERVE_CHARS))
  const availableContextChars = Math.max(1_000, modelWindowChars - reservedResponseChars)
  return {
    modelWindowChars,
    reservedResponseChars,
    availableContextChars,
    taskType: options.taskType || inferTaskType(options.query),
    riskLevel: options.riskLevel || inferRiskLevel(options.query, diagnostics),
    allocation: {
      workspace: Math.floor(availableContextChars * 0.56),
      mentions: Math.floor(availableContextChars * 0.18),
      attachments: Math.floor(availableContextChars * 0.14),
      rules: Math.floor(availableContextChars * 0.08),
      diagnostics: Math.floor(availableContextChars * 0.04),
    },
    overflowChars: Math.max(0, estimatedChars - availableContextChars),
  }
}

function buildWorkspaceEvidence(workspaceSources, contextText, options = {}, diagnostics = []) {
  const sources = workspaceSources.map(evidenceSource)
  const workspaceContextChars = sources.reduce((sum, item) => sum + (item.contentLength || 0), 0)
  const estimatedChars = contextText.length + workspaceContextChars
  return {
    version: 1,
    mentions: [],
    attachments: [],
    rules: [],
    workspaceSources: sources,
    indexStatus: getIndexStatus(),
    warnings: [],
    budget: {
      totalSources: sources.length,
      estimatedChars,
      contextBlockChars: contextText.length,
      attachmentTextChars: 0,
      ruleChars: 0,
      workspaceContextChars,
      truncatedSources: sources.filter((item) => item.truncated).length,
      warningCount: 0,
      policy: buildBudgetPolicy(options, estimatedChars, diagnostics),
    },
  }
}

function finiteNumber(value, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function truncateTextBlock(text, limit, label) {
  const value = String(text || "")
  const max = Math.max(0, finiteNumber(limit, value.length))
  if (value.length <= max) return { text: value, truncated: false, overflowChars: 0 }

  const notice = `\n\n[Codek ${label} context truncated: kept ${max}/${value.length} chars.]`
  if (max <= notice.length) {
    return {
      text: notice.slice(0, max),
      truncated: true,
      overflowChars: Math.max(0, value.length - max),
    }
  }

  return {
    text: `${value.slice(0, max - notice.length)}${notice}`,
    truncated: true,
    overflowChars: Math.max(0, value.length - max),
  }
}

function markAllTruncated(items) {
  return Array.isArray(items) ? items.map((item) => ({ ...item, truncated: true })) : []
}

function sumContentLength(items) {
  return Array.isArray(items)
    ? items.reduce((sum, item) => sum + finiteNumber(item?.contentLength), 0)
    : 0
}

function countTruncated(items) {
  return Array.isArray(items)
    ? items.filter((item) => item?.truncated === true).length
    : 0
}

function joinContextBlocks(blocks) {
  return blocks
    .map((block) => String(block || "").trim())
    .filter(Boolean)
    .join("\n\n")
}

export function enforceStructuredContextBudget(input = {}) {
  const evidence = input.evidence
  if (!evidence?.budget?.policy) {
    return {
      ...input,
      text: joinContextBlocks([
        input.rulesText,
        input.mentionsText,
        input.attachmentText,
        input.workspaceText,
        input.userText,
      ]),
      evidence,
    }
  }

  const policy = evidence.budget.policy
  const allocation = policy.allocation || {}
  const blocks = {
    mentions: truncateTextBlock(input.mentionsText, allocation.mentions, "mentions"),
    attachments: truncateTextBlock(input.attachmentText, allocation.attachments, "attachments"),
    rules: truncateTextBlock(input.rulesText, allocation.rules, "rules"),
    workspace: truncateTextBlock(input.workspaceText, allocation.workspace, "workspace"),
  }
  const warnings = Array.isArray(evidence.warnings) ? [...evidence.warnings] : []
  let nextMentions = Array.isArray(evidence.mentions) ? evidence.mentions : []
  let nextAttachments = Array.isArray(evidence.attachments) ? evidence.attachments : []
  let nextRules = Array.isArray(evidence.rules) ? evidence.rules : []
  let nextWorkspaceSources = Array.isArray(evidence.workspaceSources) ? evidence.workspaceSources : []
  let overflowChars = finiteNumber(policy.overflowChars)

  for (const [key, block] of Object.entries(blocks)) {
    if (!block.truncated) continue
    overflowChars += block.overflowChars
    warnings.push(`${key} context truncated by budget policy (${block.overflowChars} chars over ${key} allocation)`)
    if (key === "mentions") nextMentions = markAllTruncated(nextMentions)
    if (key === "attachments") nextAttachments = markAllTruncated(nextAttachments)
    if (key === "rules") nextRules = markAllTruncated(nextRules)
    if (key === "workspace") nextWorkspaceSources = markAllTruncated(nextWorkspaceSources)
  }

  const contextBlockChars = blocks.mentions.text.length
  const attachmentTextChars = blocks.attachments.text.length
  const ruleChars = blocks.rules.text.length
  const workspaceContextChars = blocks.workspace.text.length || sumContentLength(nextWorkspaceSources)
  const truncatedSources =
    countTruncated(nextMentions)
    + countTruncated(nextAttachments)
    + countTruncated(nextRules)
    + countTruncated(nextWorkspaceSources)
  const nextWarnings = warnings.slice(0, 20)
  const nextEvidence = {
    ...evidence,
    mentions: nextMentions,
    attachments: nextAttachments,
    rules: nextRules,
    workspaceSources: nextWorkspaceSources,
    warnings: nextWarnings,
    budget: {
      ...evidence.budget,
      contextBlockChars,
      attachmentTextChars,
      ruleChars,
      workspaceContextChars,
      estimatedChars: contextBlockChars + attachmentTextChars + ruleChars + workspaceContextChars,
      truncatedSources,
      warningCount: nextWarnings.length,
      policy: {
        ...policy,
        overflowChars,
      },
    },
  }

  return {
    ...input,
    mentionsText: blocks.mentions.text,
    attachmentText: blocks.attachments.text,
    rulesText: blocks.rules.text,
    workspaceText: blocks.workspace.text,
    text: joinContextBlocks([
      blocks.rules.text,
      blocks.mentions.text,
      blocks.attachments.text,
      blocks.workspace.text,
      input.userText,
    ]),
    evidence: nextEvidence,
  }
}

export function enforceContextBudget(text, evidence) {
  if (!evidence?.budget?.policy) return { text, evidence }
  const policy = evidence.budget.policy
  const workspaceLimit = Math.max(1_000, Number(policy.allocation?.workspace || policy.availableContextChars || text.length))
  if (text.length <= workspaceLimit) return { text, evidence }

  const notice = `\n\n[Codek context budget truncated workspace summary: kept ${workspaceLimit}/${text.length} chars. Use tools for exact reads before writing.]`
  const keptChars = Math.max(0, workspaceLimit - notice.length)
  const truncatedText = `${text.slice(0, keptChars)}${notice}`
  const overflowChars = Math.max(0, text.length - truncatedText.length)
  const previousContextBlockChars = Number(evidence.budget.contextBlockChars || text.length)
  const nextBudget = {
    ...evidence.budget,
    contextBlockChars: truncatedText.length,
    estimatedChars: Math.max(0, Number(evidence.budget.estimatedChars || 0) - previousContextBlockChars + truncatedText.length),
    truncatedSources: Number(evidence.budget.truncatedSources || 0) + 1,
    warningCount: Number(evidence.budget.warningCount || 0) + 1,
    policy: {
      ...policy,
      overflowChars: Math.max(Number(policy.overflowChars || 0), overflowChars),
    },
  }
  return {
    text: truncatedText,
    evidence: {
      ...evidence,
      warnings: [
        ...(Array.isArray(evidence.warnings) ? evidence.warnings : []),
        `workspace context truncated by budget policy (${overflowChars} chars over workspace allocation)`,
      ].slice(0, 20),
      budget: nextBudget,
    },
  }
}

export async function buildContextWithEvidence(options = {}) {
  const activeFile = options.activeFile || workspace.activeFile
  const selection = options.selection || ""
  const query = options.query || ""
  const openFiles = (options.openFiles?.length ? options.openFiles : getOpenFiles()).slice(-8)
  const activeOutline = Array.isArray(options.activeOutline) ? options.activeOutline : []
  const activeDiagnostics = Array.isArray(options.activeDiagnostics) ? options.activeDiagnostics : []
  const selectedSymbol = options.selectedSymbol || ""
  const index = await buildIndex()
  const { retrieveRelevantFiles } = await import("./retriever.js")
  const relevantFiles = await retrieveRelevantFiles(query, {
    index,
    activeFile,
    maxResults: options.maxFiles || 4,
  })

  const sections = []
  const workspaceSources = []
  sections.push(`PROJECT ROOT: ${workspace.projectRoot || "not selected"}`)
  workspaceSources.push(evidenceSource({
    type: "project-root",
    label: workspace.projectRoot ? "Project Root" : "Project Root Missing",
    path: workspace.projectRoot || "",
  }))

  sections.push(`OPEN FILES: ${openFiles.length ? openFiles.join(", ") : "none"}`)
  for (const file of openFiles) {
    workspaceSources.push(evidenceSource({
      type: "open-file",
      label: sourceName(file),
      path: file,
    }))
  }

  sections.push(`ACTIVE FILE: ${activeFile || "none"}`)
  if (activeFile) {
    workspaceSources.push(evidenceSource({
      type: "active-file",
      label: sourceName(activeFile),
      path: activeFile,
    }))
  }

  if (selection) {
    const clipped = selection.slice(0, 2_000)
    sections.push(`CURRENT SELECTION:\n${clipped}`)
    workspaceSources.push(evidenceSource({
      type: "selection",
      label: "Current Selection",
      path: activeFile || undefined,
      contentLength: clipped.length,
      truncated: selection.length > clipped.length,
    }))
  }

  if (activeFile) {
    const activeContent = await readProjectFile(activeFile)
    if (activeContent) {
      const clipped = activeContent.slice(0, 4_000)
      sections.push(`ACTIVE FILE CONTENT:\n${clipped}`)
      workspaceSources.push(evidenceSource({
        type: "active-file-content",
        label: sourceName(activeFile),
        path: activeFile,
        contentLength: clipped.length,
        truncated: activeContent.length > clipped.length,
      }))
    }

    const outline = activeOutline.length ? activeOutline : getFileOutline(activeFile)
    if (outline.length) {
      sections.push(
        `ACTIVE FILE OUTLINE:\n${outline
          .slice(0, 40)
          .map((symbol) => `${symbol.kind} ${symbol.name} @ ${symbol.line}:${symbol.column}`)
          .join("\n")}`,
      )
      workspaceSources.push(evidenceSource({
        type: "outline",
        label: "Active File Outline",
        path: activeFile,
        count: outline.length,
      }))
    }

    const diagnostics = activeDiagnostics.length ? activeDiagnostics : getFileDiagnostics(activeFile)
    if (diagnostics.length) {
      sections.push(
        `ACTIVE FILE DIAGNOSTICS:\n${diagnostics
          .slice(0, 20)
          .map((diagnostic) => `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`)
          .join("\n")}`,
      )
      workspaceSources.push(evidenceSource({
        type: "diagnostics",
        label: "Active File Diagnostics",
        path: activeFile,
        count: diagnostics.length,
      }))
    }
  }

  if (selectedSymbol) {
    const references = getSymbolReferences(selectedSymbol)
    sections.push(`SELECTED SYMBOL: ${selectedSymbol}`)
    if (references.total) {
      sections.push(`SELECTED SYMBOL REFERENCES: ${references.total}`)
    }
    workspaceSources.push(evidenceSource({
      type: "selected-symbol",
      label: selectedSymbol,
      count: references.total || 0,
    }))
  }

  const projectSymbols = getProjectSymbols(query).slice(0, 20)
  if (projectSymbols.length) {
    sections.push(
      `PROJECT SYMBOL MATCHES:\n${projectSymbols
        .map((symbol) => `${symbol.kind} ${symbol.name} @ ${symbol.path}:${symbol.line}`)
        .join("\n")}`,
    )
    workspaceSources.push(evidenceSource({
      type: "project-symbols",
      label: "Project Symbol Matches",
      count: projectSymbols.length,
    }))
  }

  if (relevantFiles.length) {
    const contextBlocks = []

    for (const file of relevantFiles) {
      if (file.path === activeFile) continue

      const content = await readProjectFile(file.path)
      if (!content) continue
      const snippet = file.snippet || content.slice(0, 1_200)

      contextBlocks.push(
        [
          `FILE: ${file.path}`,
          Array.isArray(file.symbols) && file.symbols.length ? `SYMBOLS: ${file.symbols.join(", ")}` : "",
          `SNIPPET:\n${snippet}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      workspaceSources.push(evidenceSource({
        type: "related-file",
        label: sourceName(file.path),
        path: file.path,
        detail: Array.isArray(file.symbols) && file.symbols.length ? `${file.symbols.length} symbols` : undefined,
        contentLength: snippet.length,
        truncated: !file.snippet && content.length > snippet.length,
      }))
    }

    if (contextBlocks.length) {
      sections.push(`RELATED FILES:\n${contextBlocks.join("\n\n")}`)
    }
  }

  const indexStatus = getIndexStatus()
  workspaceSources.push(evidenceSource({
    type: "index-status",
    label: indexStatus.state === "indexing" ? "Codebase Indexing" : "Codebase Index",
    detail: `${indexStatus.freshness}; indexed ${indexStatus.indexedFiles}/${indexStatus.indexableFiles}; excluded ${indexStatus.excludedFiles}; roots ${indexStatus.workspaceRoots}`,
    count: indexStatus.indexedFiles,
    truncated: indexStatus.freshness === "stale",
  }))

  sections.push("Use tools for exact reads before writing. Prefer focused patches over full-file rewrites.")
  const text = sections.join("\n\n")
  return enforceContextBudget(
    text,
    buildWorkspaceEvidence(workspaceSources, text, options, activeDiagnostics),
  )
}

export async function buildContext(options = {}) {
  const result = await buildContextWithEvidence(options)
  return result.text
}
