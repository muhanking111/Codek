const os = require("node:os")
const path = require("node:path")

const PROJECT_KIND_LABELS = Object.freeze({
  "smoke-temp": "smoke 临时项目",
  "codek-self": "Codek 自身开发项目",
  "user-real": "用户真实项目",
})

const WRITE_MODE_LABELS = Object.freeze({
  proposed_patch_only: "仅生成 proposed patch，等待确认",
  applying: "正在写入主工作区",
  applied: "已写入主工作区",
  blocked_no_write: "已阻断，未写入主工作区",
  rejected_no_write: "已拒绝，未写入主工作区",
  rolled_back: "已回滚到应用前状态",
})

function normalizeRoot(value) {
  return path.resolve(value || process.cwd())
}

function isInside(root, parent) {
  const resolvedRoot = normalizeRoot(root)
  const resolvedParent = normalizeRoot(parent)
  return resolvedRoot === resolvedParent || resolvedRoot.startsWith(resolvedParent + path.sep)
}

function classifyProjectRoot(projectRoot, options = {}) {
  const root = normalizeRoot(projectRoot)
  const tempRoot = normalizeRoot(options.tempRoot || os.tmpdir())
  const codekRoot = normalizeRoot(options.codekRoot || process.cwd())
  const kind = isInside(root, tempRoot)
    ? "smoke-temp"
    : isInside(root, codekRoot)
      ? "codek-self"
      : "user-real"
  return {
    projectKind: kind,
    projectKindLabel: PROJECT_KIND_LABELS[kind],
    projectRoot: root,
  }
}

function inferWriteMode(run = {}) {
  if (run.writeMode) return run.writeMode
  const decision = run.integrationDecision || null
  if (decision?.status === "rolled_back") return "rolled_back"
  if (decision?.applyResult?.status === "applied" && run.status === "completed") return "applied"
  if (run.status === "applying" || run.status === "verifying") return "applying"
  if (run.status === "cancelled") return "rejected_no_write"
  if (run.status === "waiting_user" && decision?.status === "rework_requested") return "blocked_no_write"
  if (decision?.status === "pending") return "proposed_patch_only"
  return "proposed_patch_only"
}

function withProjectScope(run = {}) {
  const project = classifyProjectRoot(run.projectRoot)
  const writeMode = inferWriteMode(run)
  return {
    ...run,
    projectKind: run.projectKind || project.projectKind,
    projectKindLabel: run.projectKindLabel || project.projectKindLabel,
    writeMode,
    writeModeLabel: WRITE_MODE_LABELS[writeMode] || writeMode,
  }
}

module.exports = {
  PROJECT_KIND_LABELS,
  WRITE_MODE_LABELS,
  classifyProjectRoot,
  inferWriteMode,
  withProjectScope,
}
