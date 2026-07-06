const {
  commandRequiresExternalTool,
  commandRequiresInstall,
  commandRequiresNetwork,
  isCommandAllowed,
  validateCommandPermissions,
} = require("./permissionPolicy")

function summarizeCommandAuthorization(run = {}, commands = run.qualityGateCommands || []) {
  const permission = run.permissionRequest || null
  const validation = validateCommandPermissions(run, commands)
  const violationsByCommand = new Map()
  for (const violation of validation.violations || []) {
    const current = violationsByCommand.get(violation.command) || []
    current.push(violation.reason)
    violationsByCommand.set(violation.command, current)
  }
  const items = (commands || []).map((command) => {
    const normalized = String(command || "").trim().replace(/\s+/g, " ")
    const reasons = violationsByCommand.get(normalized) || []
    const safeOrAllowed = isCommandAllowed(normalized, permission?.status === "approved" ? permission : {})
    const needsNetwork = commandRequiresNetwork(normalized)
    const needsInstall = commandRequiresInstall(normalized)
    const needsExternalTool = commandRequiresExternalTool(normalized)
    const status = reasons.length
      ? "blocked"
      : safeOrAllowed
        ? "allowed"
        : "needs_permission"
    return {
      command: normalized,
      status,
      reasons,
      capabilities: {
        network: needsNetwork,
        install: needsInstall,
        externalTool: needsExternalTool,
      },
      source: safeOrAllowed && !permission ? "safe_default" : permission?.status === "approved" ? "permission_request" : "unknown",
    }
  })
  return {
    ok: validation.ok,
    total: items.length,
    allowed: items.filter((item) => item.status === "allowed").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    needsPermission: items.filter((item) => item.status === "needs_permission").length,
    commands: items,
  }
}

module.exports = {
  summarizeCommandAuthorization,
}
