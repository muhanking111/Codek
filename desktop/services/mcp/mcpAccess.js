const { EventEmitter } = require("events")
const { onDidChangeUserSettings, readUserSettings } = require("../settings")

const MCP_ACCESS_CONFIG = "chat.mcp.access"
const MCP_ACCESS_VALUES = Object.freeze(["none", "registry", "all"])
const MCP_ACCESS_DEFAULT = "all"

function normalizeMcpAccessValue(value) {
  return MCP_ACCESS_VALUES.includes(value) ? value : MCP_ACCESS_DEFAULT
}

function getMcpAccessValue(settings = readUserSettings()) {
  return normalizeMcpAccessValue(settings?.[MCP_ACCESS_CONFIG])
}

function isMcpAccessAllowed(settings) {
  return getMcpAccessValue(settings) !== "none"
}

function getMcpAccessDeniedMessage() {
  return `Model Context Protocol servers are disabled by ${MCP_ACCESS_CONFIG}=none.`
}

class AllowedMcpServersService {
  constructor({ settingsReader = readUserSettings, settingsEvents = { onDidChangeUserSettings } } = {}) {
    this.settingsReader = settingsReader
    this.events = new EventEmitter()
    this.disposable = null
    const subscribe = settingsEvents?.onDidChangeUserSettings || onDidChangeUserSettings
    if (typeof subscribe === "function") {
      this.disposable = subscribe((event = {}) => {
        if (!Array.isArray(event.changedKeys) || event.changedKeys.includes(MCP_ACCESS_CONFIG)) {
          this.events.emit("change")
        }
      })
    }
  }

  get access() {
    return getMcpAccessValue(this.settingsReader())
  }

  onDidChangeAllowedMcpServers(listener) {
    this.events.on("change", listener)
    return {
      dispose: () => this.events.off("change", listener),
    }
  }

  isAllowed(_mcpServer) {
    if (this.access !== "none") return true
    return {
      value: getMcpAccessDeniedMessage(),
      settingsCommand: "workbench.action.openSettings",
      settingsQuery: `@id:${MCP_ACCESS_CONFIG}`,
    }
  }

  dispose() {
    this.disposable?.dispose?.()
    this.events.removeAllListeners()
  }
}

const allowedMcpServersService = new AllowedMcpServersService()

module.exports = {
  AllowedMcpServersService,
  MCP_ACCESS_CONFIG,
  MCP_ACCESS_DEFAULT,
  MCP_ACCESS_VALUES,
  allowedMcpServersService,
  getMcpAccessDeniedMessage,
  getMcpAccessValue,
  isMcpAccessAllowed,
  normalizeMcpAccessValue,
}
