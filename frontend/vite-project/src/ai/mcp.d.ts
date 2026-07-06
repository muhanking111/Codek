export interface McpServerRuntimeConfig {
  serverName?: string
  name?: string
  type?: "stdio" | "http" | "sse" | string
  transport?: "stdio" | "http" | string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  serverUrl?: string
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface McpToolDefinition {
  name: string
  description?: string
  arguments?: Record<string, unknown>
  serverName?: string
  qualifiedName?: string
  execute?: (args: Record<string, unknown>) => Promise<unknown>
}

export class McpClient {
  readonly serverName: string
  configureMcpServer(config: McpServerRuntimeConfig): void
  connect(command?: string, args?: string[], options?: McpServerRuntimeConfig): Promise<void>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  getToolDefinitions(): McpToolDefinition[]
  disconnect(): Promise<void>
}

export function createMcpToolAdapter(mcpClient: McpClient): McpToolDefinition[]
export function configureMcpServer(config: McpServerRuntimeConfig): McpClient
export function registerMcpServer(config: McpServerRuntimeConfig, options?: { profileScoped?: boolean }): McpClient
export function listConfiguredMcpServers(): Array<{
  serverName: string
  initialized: boolean
  config: McpServerRuntimeConfig | null
  tools: McpToolDefinition[]
  profileScoped: boolean
}>
export function clearProfileMcpServers(): Promise<void>
export function applyProfileMcpServers(servers?: McpServerRuntimeConfig[]): Promise<Array<{
  serverName: string
  initialized: boolean
  config: McpServerRuntimeConfig | null
  tools: McpToolDefinition[]
  profileScoped: boolean
}>>
export function connectMcpServer(serverName: string): Promise<McpClient>
export function ensureMcpServerConnected(serverName: string): Promise<McpClient>
export function callMcpTool(serverName: string, toolName: string, args?: Record<string, unknown>): Promise<unknown>
export function listMcpTools(): Promise<McpToolDefinition[]>
