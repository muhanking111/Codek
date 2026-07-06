export type ContainerStatus = "created" | "running" | "paused" | "restarting" | "removing" | "exited" | "dead"

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: ContainerStatus
  ports: string
  created: number
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: number
  created: number
}

export interface DockerComposeService {
  name: string
  image: string
  state: string
  ports: string
}

export interface DockerComposeProject {
  name: string
  path: string
  services: DockerComposeService[]
}

export interface DockerfileInstruction {
  instruction: string
  arguments: string
  line: number
}

const IPC_PREFIX = "docker"

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
  const method = ipc[`${IPC_PREFIX}:${channel}`]
  if (typeof method !== "function") {
    throw new Error(`IPC method docker:${channel} not available`)
  }
  return method(...args)
}

export class DockerClient {
  async listContainers(all = false): Promise<DockerContainer[]> {
    return invoke("listContainers", all as unknown) as Promise<DockerContainer[]>
  }

  async listImages(): Promise<DockerImage[]> {
    return invoke("listImages") as Promise<DockerImage[]>
  }

  async startContainer(id: string): Promise<boolean> {
    return invoke("startContainer", id as unknown) as Promise<boolean>
  }

  async stopContainer(id: string): Promise<boolean> {
    return invoke("stopContainer", id as unknown) as Promise<boolean>
  }

  async restartContainer(id: string): Promise<boolean> {
    return invoke("restartContainer", id as unknown) as Promise<boolean>
  }

  async removeContainer(id: string): Promise<boolean> {
    return invoke("removeContainer", id as unknown) as Promise<boolean>
  }

  async containerLogs(id: string, tail = 100): Promise<string> {
    return invoke("containerLogs", id as unknown, tail as unknown) as Promise<string>
  }

  async execInContainer(id: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return invoke("execInContainer", id as unknown, command as unknown) as Promise<{
      exitCode: number
      stdout: string
      stderr: string
    }>
  }

  async composeUp(composePath: string): Promise<boolean> {
    return invoke("composeUp", composePath as unknown) as Promise<boolean>
  }

  async composeDown(composePath: string): Promise<boolean> {
    return invoke("composeDown", composePath as unknown) as Promise<boolean>
  }

  async composePs(composePath: string): Promise<DockerComposeService[]> {
    return invoke("composePs", composePath as unknown) as Promise<DockerComposeService[]>
  }

  async parseDockerfile(filePath: string): Promise<DockerfileInstruction[]> {
    return invoke("parseDockerfile", filePath as unknown) as Promise<DockerfileInstruction[]>
  }
}

let clientInstance: DockerClient | null = null

export function getDockerClient(): DockerClient {
  if (!clientInstance) {
    clientInstance = new DockerClient()
  }
  return clientInstance
}
