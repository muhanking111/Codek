import type { RemoteDirEntry } from "./sshClient"

export interface WslDistribution {
  name: string
  state: "Running" | "Stopped"
  version: number
  isDefault: boolean
}

const WSL_IPC_PREFIX = "wsl"

function getIpc(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  const codek = (typeof window !== "undefined" ? window.codek : null) as
    | Record<string, (...args: unknown[]) => Promise<unknown>>
    | undefined
  return codek ?? null
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const ipc = getIpc()
  if (!ipc) {
    throw new Error("Electron IPC unavailable: window.codek not found")
  }
  const method = ipc[`${WSL_IPC_PREFIX}:${channel}`]
  if (typeof method !== "function") {
    throw new Error(`IPC method wsl:${channel} not available`)
  }
  return method(...args)
}

export class WslClient {
  private activeDistribution: string | null = null

  get distribution(): string | null {
    return this.activeDistribution
  }

  async listDistributions(): Promise<WslDistribution[]> {
    const result = await invoke("list") as WslDistribution[]
    return result
  }

  async connect(distribution: string): Promise<void> {
    await invoke("connect", distribution as unknown)
    this.activeDistribution = distribution
  }

  async disconnect(): Promise<void> {
    this.activeDistribution = null
  }

  async executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (!this.activeDistribution) {
      throw new Error("No WSL distribution connected")
    }
    return invoke("execute", this.activeDistribution as unknown, command as unknown) as Promise<{
      exitCode: number
      stdout: string
      stderr: string
    }>
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.activeDistribution) {
      throw new Error("No WSL distribution connected")
    }
    return invoke("readFile", this.activeDistribution as unknown, filePath as unknown) as Promise<string>
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    if (!this.activeDistribution) {
      throw new Error("No WSL distribution connected")
    }
    return invoke("writeFile", this.activeDistribution as unknown, filePath as unknown, content as unknown) as Promise<boolean>
  }

  async listDir(dirPath: string): Promise<RemoteDirEntry[]> {
    if (!this.activeDistribution) {
      throw new Error("No WSL distribution connected")
    }
    return invoke("listDir", this.activeDistribution as unknown, dirPath as unknown) as Promise<RemoteDirEntry[]>
  }

  translatePath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, "/")
    const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)/)
    if (!driveMatch) return windowsPath
    const driveLetter = driveMatch[1].toLowerCase()
    const rest = driveMatch[2]
    return `/mnt/${driveLetter}/${rest}`
  }

  fromWslPath(wslPath: string): string {
    const mntMatch = wslPath.match(/^\/mnt\/([a-z])\/(.*)/)
    if (!mntMatch) return wslPath
    const driveLetter = mntMatch[1].toUpperCase()
    const rest = mntMatch[2]
    return `${driveLetter}:\\${rest.replace(/\//g, "\\")}`
  }
}
