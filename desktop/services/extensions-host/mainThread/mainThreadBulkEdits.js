/**
 * MainThreadBulkEdits — handles workspace edit application from the EH.
 *
 * RPC handlers:
 *   $tryApplyWorkspaceEdit(edit)     — Apply a WorkspaceEdit
 */

const fsp = require("fs/promises")
const path = require("path")

function uriToPath(uri) {
  if (!uri) return null
  if (uri.scheme && uri.scheme !== "file") return null
  let p = uri.fsPath || uri.path || ""
  if (p.startsWith("/") && p[2] === ":") p = p.slice(1)
  return p.replace(/\//g, path.sep)
}

function register(server, options = {}) {
  server.onRpc("$tryApplyWorkspaceEdit", async (args) => {
    const [workspaceEditDto] = args || []
    if (!workspaceEditDto) return false

    const summary = await applyWorkspaceEditDto(workspaceEditDto, options)
    options.onWorkspaceEditSummary?.(summary)
    if (!summary.applied && typeof options.logger?.warn === "function") {
      options.logger.warn("[main-thread:bulkEdits] WorkspaceEdit failed", summary)
    }
    return summary.applied
  })
}

async function applyWorkspaceEditDto(workspaceEditDto, options = {}) {
  const dto = workspaceEditDto?.value || workspaceEditDto || {}
  const edits = Array.isArray(dto.edits) ? dto.edits : []
  const fsAccess = options.fsAccess || createNodeFileSystemAccess()
  const failures = []
  const changedResources = []

  for (const [index, edit] of edits.entries()) {
    try {
      const resource = await applyWorkspaceEditOperation(edit, fsAccess)
      changedResources.push(resource || `edit:${index}`)
    } catch (error) {
      failures.push(createFailureEvidence(edit, error, changedResources))
    }
  }

  return createWorkspaceEditSummary(edits.length, changedResources, failures)
}

async function applyWorkspaceEditOperation(edit, fsAccess) {
  if (!edit || typeof edit !== "object") {
    throw createWorkspaceEditError("apply", "unsupported-edit", "Workspace edit entry must be an object")
  }
  if (edit._type === "file" || edit.newUri || edit.oldUri) {
    return applyFileOperation(edit, fsAccess)
  }
  if (edit.resource) {
    return applyTextEditOperation(edit, fsAccess)
  }
  throw createWorkspaceEditError("apply", "unsupported-edit", "Workspace edit entry is missing file or text edit data")
}

async function applyFileOperation(edit, fsAccess) {
  const oldPath = edit.oldUri ? uriToPath(edit.oldUri) : null
  const newPath = edit.newUri ? uriToPath(edit.newUri) : null

  if (edit.oldUri && edit.newUri) {
    if (!oldPath || !newPath) throw createWorkspaceEditError("rename", "unsupported-uri", "Rename requires file oldUri and newUri")
    await fsAccess.mkdir(path.dirname(newPath), { recursive: true })
    await fsAccess.rename(oldPath, newPath)
    return newPath
  }
  if (edit.oldUri && !edit.newUri) {
    if (!oldPath) throw createWorkspaceEditError("delete", "unsupported-uri", "Delete requires a file oldUri")
    await fsAccess.rm(oldPath, { recursive: true, force: true })
    return oldPath
  }
  if (edit.newUri) {
    if (!newPath) throw createWorkspaceEditError("create", "unsupported-uri", "Create requires a file newUri")
    const content = edit.contents ? Buffer.from(edit.contents) : Buffer.alloc(0)
    await fsAccess.mkdir(path.dirname(newPath), { recursive: true })
    await fsAccess.writeFile(newPath, content)
    return newPath
  }
  throw createWorkspaceEditError("apply", "unsupported-edit", "Unsupported file workspace edit")
}

async function applyTextEditOperation(edit, fsAccess) {
  const filePath = uriToPath(edit.resource)
  if (!filePath) throw createWorkspaceEditError("read", "unsupported-uri", "Text edit requires a file resource", edit.textEdits?.[0]?.range)
  if (!Array.isArray(edit.textEdits)) throw createWorkspaceEditError("apply", "missing-text-edits", "Text edit entry is missing textEdits", undefined, filePath)
  let content
  try {
    content = await fsAccess.readFile(filePath, "utf8")
  } catch (error) {
    throw createWorkspaceEditError("read", "fs-error", error?.message || String(error), edit.textEdits[0]?.range, filePath, getMatchEvidence(edit.textEdits[0]))
  }
  const next = applyTextEdits(String(content), edit.textEdits)
  try {
    await fsAccess.writeFile(filePath, next, "utf8")
  } catch (error) {
    throw createWorkspaceEditError("save", "fs-error", error?.message || String(error), edit.textEdits[0]?.range, filePath, getMatchEvidence(edit.textEdits[0]))
  }
  return filePath
}

function applyTextEdits(content, textEdits) {
  const edits = textEdits.map((edit) => {
    if (!edit?.range) throw createWorkspaceEditError("apply", "invalid-range", "Text edit is missing a range")
    const start = offsetAt(content, edit.range.startLineNumber, edit.range.startColumn)
    const end = offsetAt(content, edit.range.endLineNumber, edit.range.endColumn)
    if (end < start) throw createWorkspaceEditError("apply", "invalid-range", "Text edit range end is before start", edit.range)
    return { start, end, text: edit.text || "", range: edit.range }
  }).sort((left, right) => right.start - left.start || right.end - left.end)

  let next = content
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
  }
  return next
}

function offsetAt(content, lineNumber = 1, column = 1) {
  const lineStarts = computeLineStarts(content)
  const lineIndex = Math.max(0, Number(lineNumber) - 1)
  if (lineIndex >= lineStarts.length) throw createWorkspaceEditError("apply", "invalid-range", `Line ${lineNumber} is outside the document`)
  const nextLineStart = lineStarts[lineIndex + 1] ?? content.length + 1
  const lineEnd = content.charCodeAt(nextLineStart - 2) === 13
    ? nextLineStart - 2
    : content.charCodeAt(nextLineStart - 1) === 10
      ? nextLineStart - 1
      : nextLineStart - 1
  const offset = lineStarts[lineIndex] + Math.max(0, Number(column) - 1)
  if (offset > lineEnd) throw createWorkspaceEditError("apply", "invalid-range", `Column ${column} is outside the line`)
  return offset
}

function computeLineStarts(content) {
  const starts = [0]
  for (let index = 0; index < content.length; index++) {
    const char = content.charCodeAt(index)
    if (char === 13) {
      if (content.charCodeAt(index + 1) === 10) index++
      starts.push(index + 1)
    } else if (char === 10) {
      starts.push(index + 1)
    }
  }
  return starts
}

function createWorkspaceEditSummary(totalEdits, changedResources, failures) {
  const uniqueChangedResources = [...new Set(changedResources)]
  const applied = failures.length === 0 && totalEdits === changedResources.length
  return {
    applied,
    totalEdits,
    successCount: changedResources.length,
    failureCount: failures.length,
    changedResources: uniqueChangedResources,
    failures,
    rollbackRisk: uniqueChangedResources.length && failures.length ? "partial-write" : uniqueChangedResources.length ? "workspace-diff" : "none",
    rollbackDescription: describeRollbackRisk(uniqueChangedResources, failures),
  }
}

function createFailureEvidence(edit, error, changedResources) {
  const range = error?.range || edit?.textEdits?.[0]?.range
  const resource = error?.resource || uriToPath(edit?.resource) || uriToPath(edit?.newUri) || uriToPath(edit?.oldUri) || null
  return {
    resource,
    range,
    match: error?.match || getMatchEvidence(edit?.textEdits?.[0]),
    operation: error?.operation || "apply",
    reason: error?.reason || "unknown",
    message: error?.message || String(error),
    rollbackRisk: changedResources.length ? "partial-write" : "none",
  }
}

function createWorkspaceEditError(operation, reason, message, range, resource, match) {
  const error = new Error(message)
  error.operation = operation
  error.reason = reason
  error.range = range
  error.resource = resource
  error.match = match
  return error
}

function getMatchEvidence(edit) {
  const metadata = edit?.metadata || {}
  const value = metadata.match || metadata.preview || metadata.originalText
  return typeof value === "string" && value ? value : undefined
}

function describeRollbackRisk(changedResources, failures) {
  if (changedResources.length && failures.length) {
    return `Partial WorkspaceEdit write; inspect workspace diff before continuing. Written: ${changedResources.join(", ")}; failed: ${failures.map((failure) => failure.resource || "unknown").join(", ")}.`
  }
  if (changedResources.length) return "WorkspaceEdit wrote workspace resources; use workspace diff to roll back per resource."
  return "WorkspaceEdit did not write workspace resources; no rollback needed."
}

function createNodeFileSystemAccess() {
  return {
    mkdir: (...args) => fsp.mkdir(...args),
    rename: (...args) => fsp.rename(...args),
    rm: (...args) => fsp.rm(...args),
    readFile: (...args) => fsp.readFile(...args),
    writeFile: (...args) => fsp.writeFile(...args),
  }
}

module.exports = {
  applyTextEdits,
  applyWorkspaceEditDto,
  register,
  uriToPath,
}
