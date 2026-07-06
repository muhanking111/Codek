import { reactive } from "vue"
import { SshClient } from "./sshClient"
import type { SshConfig, RemoteConnection, RemoteDirEntry, RemoteFileStat, RemoteWatchEvent } from "./sshClient"
import { WslClient } from "./wslClient"
import type { WslDistribution } from "./wslClient"

export type RemoteType = "ssh" | "wsl"

export interface SavedConnection {
  id: string
  type: RemoteType
  label: string
  sshConfig?: SshConfig
  wslDistribution?: string
}

const STORAGE_KEY = "codek.remote.saved-connections"

function generateId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadSavedConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedConnection[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistSavedConnections(connections: SavedConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
  } catch {
    // storage full or unavailable
  }
}

interface RemoteManagerState {
  activeConnection: RemoteConnection | null
  savedConnections: SavedConnection[]
  isConnecting: boolean
}

export class RemoteManager {
  private sshClient = new SshClient()
  private wslClient = new WslClient()
  private state = reactive<RemoteManagerState>({
    activeConnection: null,
    savedConnections: loadSavedConnections(),
    isConnecting: false,
  })

  get activeConnection(): RemoteConnection | null {
    return this.state.activeConnection
  }

  get savedConnections(): SavedConnection[] {
    return this.state.savedConnections
  }

  get isConnecting(): boolean {
    return this.state.isConnecting
  }

  isRemote(): boolean {
    return this.state.activeConnection !== null
  }

  async connect(type: "ssh", config: SshConfig): Promise<RemoteConnection>
  async connect(type: "wsl", distribution: string): Promise<RemoteConnection>
  async connect(type: RemoteType, configOrDist: SshConfig | string): Promise<RemoteConnection> {
    if (this.state.activeConnection) {
      await this.disconnect()
    }

    this.state.isConnecting = true

    try {
      if (type === "ssh") {
        const config = configOrDist as SshConfig
        const connection = await this.sshClient.connect(config)
        this.state.activeConnection = connection
        return connection
      }

      const distribution = configOrDist as string
      await this.wslClient.connect(distribution)
      const connection: RemoteConnection = {
        id: generateId(),
        type: "wsl",
        label: `WSL: ${distribution}`,
        state: "connected",
        config: {
          host: "wsl",
          port: 0,
          username: "",
          authType: "password",
        },
      }
      this.state.activeConnection = connection
      return connection
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Connection failed"
      this.state.activeConnection = null
      throw new Error(msg)
    } finally {
      this.state.isConnecting = false
    }
  }

  async disconnect(): Promise<void> {
    if (this.state.activeConnection?.type === "ssh") {
      await this.sshClient.disconnect()
    } else {
      await this.wslClient.disconnect()
    }
    this.state.activeConnection = null
  }

  async executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (!this.state.activeConnection) {
      throw new Error("No active remote connection")
    }
    if (this.state.activeConnection.type === "ssh") {
      return this.sshClient.executeCommand(command)
    }
    return this.wslClient.executeCommand(command)
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.state.activeConnection) {
      throw new Error("No active remote connection")
    }
    if (this.state.activeConnection.type === "ssh") {
      return this.sshClient.readFile(filePath)
    }
    return this.wslClient.readFile(filePath)
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    if (!this.state.activeConnection) {
      throw new Error("No active remote connection")
    }
    if (this.state.activeConnection.type === "ssh") {
      return this.sshClient.writeFile(filePath, content)
    }
    return this.wslClient.writeFile(filePath, content)
  }

  async listDir(dirPath: string): Promise<RemoteDirEntry[]> {
    if (!this.state.activeConnection) {
      throw new Error("No active remote connection")
    }
    if (this.state.activeConnection.type === "ssh") {
      return this.sshClient.listDir(dirPath)
    }
    return this.wslClient.listDir(dirPath)
  }

  async stat(filePath: string): Promise<RemoteFileStat> {
    if (!this.state.activeConnection) {
      throw new Error("No active remote connection")
    }
    if (this.state.activeConnection.type === "ssh") {
      return this.sshClient.stat(filePath)
    }
    const cmd = `stat -c '%F %s %Y' "${filePath}" 2>/dev/null || echo "not_found"`
    const result = await this.wslClient.executeCommand(cmd)
    if (result.exitCode !== 0 || result.stdout.trim() === "not_found") {
      return { exists: false, isDirectory: false, isFile: false, size: 0, mtimeMs: 0 }
    }
    const parts = result.stdout.trim().split(" ")
    const isDirectory = parts[0] === "directory"
    return {
      exists: true,
      isDirectory,
      isFile: !isDirectory,
      size: Number(parts[1]) || 0,
      mtimeMs: Number(parts[2]) * 1000 || 0,
    }
  }

  startFileWatcher(dirPath: string, callback: (event: RemoteWatchEvent) => void): void {
    if (this.state.activeConnection?.type === "ssh") {
      this.sshClient.startFileWatcher(dirPath, callback)
    }
  }

  stopFileWatcher(): void {
    this.sshClient.stopFileWatcher()
  }

  listSavedConnections(): SavedConnection[] {
    return [...this.state.savedConnections]
  }

  saveConnection(connection: Omit<SavedConnection, "id">): SavedConnection {
    const entry: SavedConnection = { ...connection, id: generateId() }
    this.state.savedConnections = [...this.state.savedConnections, entry]
    persistSavedConnections(this.state.savedConnections)
    return entry
  }

  removeConnection(id: string): void {
    this.state.savedConnections = this.state.savedConnections.filter((c) => c.id !== id)
    persistSavedConnections(this.state.savedConnections)
  }

  async listWslDistributions(): Promise<WslDistribution[]> {
    return this.wslClient.listDistributions()
  }

  translateWslPath(windowsPath: string): string {
    return this.wslClient.translatePath(windowsPath)
  }

  fromWslPath(wslPath: string): string {
    return this.wslClient.fromWslPath(wslPath)
  }
}

let managerInstance: RemoteManager | null = null

export function getRemoteManager(): RemoteManager {
  if (!managerInstance) {
    managerInstance = new RemoteManager()
  }
  return managerInstance
}

export function resetRemoteManager(): void {
  if (managerInstance) {
    void managerInstance.disconnect()
  }
  managerInstance = null
}
