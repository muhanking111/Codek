import { reactive, computed } from "vue"
import type { DapAdapterConfig } from "./dapConfigs"
import {
  DAP_ADAPTER_CONFIGS,
  checkDapInstalled,
  installDapAdapter as runInstall,
  buildLaunchConfigFromAdapter,
} from "./dapConfigs"
import type { InstallStatus } from "../languages/lsp/serverConfigs"
import { getDebugManager } from "./debugManager"

export type DapAdapterRunningStatus =
  | "not_installed"
  | "installed"
  | "running"
  | "stopped"
  | "error"

export interface DapAdapterStatus {
  adapterId: string
  name: string
  status: DapAdapterRunningStatus
  version: string
  installStatus: InstallStatus
}

interface DapAdapterStateEntry {
  adapterId: string
  name: string
  status: DapAdapterRunningStatus
  version: string
  installStatus: InstallStatus
}

const adapterStateMap = reactive<Map<string, DapAdapterStateEntry>>(new Map())

function getOrCreateEntry(config: DapAdapterConfig): DapAdapterStateEntry {
  const existing = adapterStateMap.get(config.id)
  if (existing) return existing

  const entry: DapAdapterStateEntry = {
    adapterId: config.id,
    name: config.name,
    status: "not_installed",
    version: "",
    installStatus: "unknown",
  }
  adapterStateMap.set(config.id, entry)
  return entry
}

export async function checkAdapterInstalled(config: DapAdapterConfig): Promise<boolean> {
  const entry = getOrCreateEntry(config)
  entry.installStatus = "checking"

  const installed = await checkDapInstalled(config)

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

export async function installAdapter(config: DapAdapterConfig): Promise<boolean> {
  const entry = getOrCreateEntry(config)
  entry.installStatus = "installing"

  const success = await runInstall(config)

  if (success) {
    entry.installStatus = "installed"
    entry.status = "installed"
    await checkAdapterInstalled(config)
  } else {
    entry.installStatus = "error"
  }

  return success
}

export async function startDebugFromConfig(
  config: DapAdapterConfig,
  programPath: string,
): Promise<boolean> {
  const entry = getOrCreateEntry(config)

  if (entry.installStatus !== "installed" && entry.installStatus !== "unknown") {
    return false
  }

  const launchConfig = buildLaunchConfigFromAdapter(config, programPath)
  const debugManager = getDebugManager()

  try {
    await debugManager.startSession({
      id: `dap-${config.id}-${Date.now()}`,
      name: config.name,
      type: config.adapterType as "node" | "java" | "python" | "custom",
      command: programPath,
      workingDir: extractWorkingDir(programPath),
    })
    entry.status = "running"
    return true
  } catch {
    entry.status = "error"
    return false
  }
}

export function getAdapterStatus(adapterId: string): DapAdapterStatus | undefined {
  const entry = adapterStateMap.get(adapterId)
  if (!entry) return undefined

  return {
    adapterId: entry.adapterId,
    name: entry.name,
    status: entry.status,
    version: entry.version,
    installStatus: entry.installStatus,
  }
}

export async function checkAllAdapters(): Promise<void> {
  const checks = DAP_ADAPTER_CONFIGS.map((config) => checkAdapterInstalled(config))
  await Promise.allSettled(checks)
}

export const adapterStatusList = computed<DapAdapterStatus[]>(() => {
  const result: DapAdapterStatus[] = []

  for (const config of DAP_ADAPTER_CONFIGS) {
    const entry = adapterStateMap.get(config.id)
    result.push({
      adapterId: config.id,
      name: config.name,
      status: entry?.status ?? "not_installed",
      version: entry?.version ?? "",
      installStatus: entry?.installStatus ?? "unknown",
    })
  }

  return result
})

export function initDapManager(): void {
  for (const config of DAP_ADAPTER_CONFIGS) {
    getOrCreateEntry(config)
  }
}

function extractWorkingDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const slashIndex = normalized.lastIndexOf("/")
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized
}
