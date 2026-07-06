export type SshAuthType = "password" | "key"

export interface SshConfig {
  host: string
  port: number
  username: string
  authType: SshAuthType
  keyPath?: string
  password?: string
}

export type RemoteConnectionState = "disconnected" | "connecting" | "connected" | "error"

export interface RemoteConnection {
  id: string
  type: "ssh" | "wsl"
  label: string
  state: RemoteConnectionState
  config: SshConfig
  error?: string
}

export interface RemoteFileStat {
  exists: boolean
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
}

export interface RemoteDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
}

export interface RemoteWatchEvent {
  path: string
  type: "add" | "change" | "unlink"
}

const IPC_CHANNEL_PREFIX = "ssh"

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
  const method = ipc[`${IPC_CHANNEL_PREFIX}:${channel}`]
  if (typeof method !== "function") {
    throw new Error(`IPC method ssh:${channel} not available`)
  }
  return method(...args)
}

export class SshClient {
  private connectionId: string | null = null
  private watchUnsubscribe: (() => void) | null = null

  get id(): string | null {
    return this.connectionId
  }

  async connect(config: SshConfig): Promise<RemoteConnection> {
    const result = await invoke("connect", config as unknown) as RemoteConnection
    this.connectionId = result.id
    return result
  }

  async disconnect(): Promise<void> {
    if (!this.connectionId) return
    await invoke("disconnect", this.connectionId as unknown)
    this.stopFileWatcher()
    this.connectionId = null
  }

  isConnected(): boolean {
    return this.connectionId !== null
  }

  async executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (!this.connectionId) {
      throw new Error("Not connected")
    }
    return invoke("execute", this.connectionId as unknown, command as unknown) as Promise<{
      exitCode: number
      stdout: string
      stderr: string
    }>
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.connectionId) {
      throw new Error("Not connected")
    }
    return invoke("readFile", this.connectionId as unknown, filePath as unknown) as Promise<string>
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    if (!this.connectionId) {
      throw new Error("Not connected")
    }
    return invoke("writeFile", this.connectionId as unknown, filePath as unknown, content as unknown) as Promise<boolean>
  }

  async listDir(dirPath: string): Promise<RemoteDirEntry[]> {
    if (!this.connectionId) {
      throw new Error("Not connected")
    }
    return invoke("listDir", this.connectionId as unknown, dirPath as unknown) as Promise<RemoteDirEntry[]>
  }

  async stat(filePath: string): Promise<RemoteFileStat> {
    if (!this.connectionId) {
      throw new Error("Not connected")
    }
    return invoke("stat", this.connectionId as unknown, filePath as unknown) as Promise<RemoteFileStat>
  }

  startFileWatcher(dirPath: string, callback: (event: RemoteWatchEvent) => void): void {
    this.stopFileWatcher()
    const codek = window.codek as Record<string, unknown> | undefined
    const onEvent = codek?.["ssh:onFileWatchEvent"] as
      | ((cb: (event: RemoteWatchEvent) => void) => () => void)
      | undefined
    if (typeof onEvent === "function") {
      this.watchUnsubscribe = onEvent(callback)
    }
  }

  stopFileWatcher(): void {
    if (this.watchUnsubscribe) {
      this.watchUnsubscribe()
      this.watchUnsubscribe = null
    }
  }
}
