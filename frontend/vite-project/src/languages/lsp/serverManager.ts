import { reactive, computed } from "vue"
import type { LspServerConfig } from "./serverConfigs"
import {
  LSP_SERVER_CONFIGS,
  checkServerInstalled,
  installServer as runInstall,
  toLspServerRuntimeConfig,
} from "./serverConfigs"
import type { InstallStatus } from "./serverConfigs"
import { languageServerManager } from "./manager"

export type LspServerRunningStatus =
  | "not_installed"
  | "installed"
  | "running"
  | "stopped"
  | "error"

export interface LspServerStatus {
  serverId: string
  name: string
  status: LspServerRunningStatus
  version: string
  installStatus: InstallStatus
}

interface LspServerStateEntry {
  serverId: string
  name: string
  status: LspServerRunningStatus
  version: string
  installStatus: InstallStatus
}

const serverStateMap = reactive<Map<string, LspServerStateEntry>>(new Map())

function getOrCreateEntry(config: LspServerConfig): LspServerStateEntry {
  const existing = serverStateMap.get(config.id)
  if (existing) return existing

  const entry: LspServerStateEntry = {
    serverId: config.id,
    name: config.name,
    status: "not_installed",
    version: "",
    installStatus: "unknown",
  }
  serverStateMap.set(config.id, entry)
  return entry
}

export async function checkServerInstalledStatus(config: LspServerConfig): Promise<boolean> {
  const entry = getOrCreateEntry(config)
  entry.installStatus = "checking"

  const installed = await checkServerInstalled(config)

  if (installed) {
    entry.installStatus = "installed"
    entry.status = entry.status === "not_installed" ? "installed" : entry.status

    if (window.codek?.runCommand) {
      try {
        const result = await window.codek.runCommand(config.installCheck)
        if (result.exitCode === 0 && result.stdout) {
          entry.version = result.stdout.trim()
        }
      } catch {
        // version detection is non-critical
      }
    }
  } else {
    entry.installStatus = "not-installed"
    entry.status = "not_installed"
  }

  return installed
}

export async function installServerFromConfig(config: LspServerConfig): Promise<boolean> {
  const entry = getOrCreateEntry(config)
  entry.installStatus = "installing"

  const success = await runInstall(config)

  if (success) {
    entry.installStatus = "installed"
    entry.status = "installed"
    await checkServerInstalledStatus(config)
  } else {
    entry.installStatus = "error"
  }

  return success
}

export async function startServerFromConfig(config: LspServerConfig): Promise<boolean> {
  const entry = getOrCreateEntry(config)

  if (entry.installStatus !== "installed" && entry.installStatus !== "unknown") {
    return false
  }

  const runtimeConfig = toLspServerRuntimeConfig(config)

  try {
    await languageServerManager.startServer(runtimeConfig)
    entry.status = "running"
    return true
  } catch {
    entry.status = "error"
    return false
  }
}

export async function stopServerFromConfig(serverId: string): Promise<void> {
  const entry = serverStateMap.get(serverId)
  if (!entry || entry.status !== "running") return

  try {
    await languageServerManager.stopServer(serverId)
    entry.status = "stopped"
  } catch {
    entry.status = "error"
  }
}

export function getServerStatus(serverId: string): LspServerStatus | undefined {
  const entry = serverStateMap.get(serverId)
  if (!entry) return undefined

  return {
    serverId: entry.serverId,
    name: entry.name,
    status: entry.status,
    version: entry.version,
    installStatus: entry.installStatus,
  }
}

export async function checkAllServers(): Promise<void> {
  const checks = LSP_SERVER_CONFIGS.map((config) => checkServerInstalledStatus(config))
  await Promise.allSettled(checks)
}

export const serverStatusList = computed<LspServerStatus[]>(() => {
  const result: LspServerStatus[] = []

  for (const config of LSP_SERVER_CONFIGS) {
    const entry = serverStateMap.get(config.id)
    result.push({
      serverId: config.id,
      name: config.name,
      status: entry?.status ?? "not_installed",
      version: entry?.version ?? "",
      installStatus: entry?.installStatus ?? "unknown",
    })
  }

  return result
})

export function initServerManager(): void {
  for (const config of LSP_SERVER_CONFIGS) {
    getOrCreateEntry(config)
  }
}
