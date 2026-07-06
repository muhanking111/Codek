import { executeSandbox } from '../sandbox/sandboxClient'
import type { OperationRisk } from './agentCore'

export interface ToolDefinition {
  name: string
  description: string
  risk: OperationRisk
  parameters: Record<string, { type: string; description: string; required?: boolean }>
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  projectRoot?: string
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, content: string) => Promise<void>
  deleteFile?: (path: string) => Promise<void>
  runCommand?: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  searchCode?: (query: string) => Promise<Array<{ file: string; line: number; content: string }>>
}

export const AGENT_TOOLS: Record<string, ToolDefinition> = {
  read_file: {
    name: 'read_file',
    description: 'Read content from a file',
    risk: 'safe',
    parameters: {
      path: { type: 'string', description: 'File path relative to project root', required: true },
    },
    async execute(args, context) {
      const path = args.path as string
      if (!context.readFile) throw new Error('readFile not available in context')
      return { content: await context.readFile(path) }
    },
  },

  write_file: {
    name: 'write_file',
    description: 'Create or modify a file',
    risk: 'medium',
    parameters: {
      path: { type: 'string', description: 'File path', required: true },
      content: { type: 'string', description: 'File content', required: true },
    },
    async execute(args, context) {
      const path = args.path as string
      const content = args.content as string
      if (!context.writeFile) throw new Error('writeFile not available in context')
      await context.writeFile(path, content)
      return { success: true, path }
    },
  },

  delete_file: {
    name: 'delete_file',
    description: 'Delete a file (HIGH-RISK)',
    risk: 'high',
    parameters: {
      path: { type: 'string', description: 'File path to delete', required: true },
    },
    async execute(args, context) {
      const path = args.path as string
      if (!context.deleteFile) throw new Error('deleteFile not available in context')
      await context.deleteFile(path)
      return { success: true, deleted: path }
    },
  },

  execute_code: {
    name: 'execute_code',
    description: 'Run code in isolated sandbox',
    risk: 'safe',
    parameters: {
      language: { type: 'string', description: 'Programming language (js, python, java, ts)', required: true },
      code: { type: 'string', description: 'Code to execute', required: true },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    async execute(args) {
      const language = args.language as string
      const code = args.code as string
      const timeoutMs = (args.timeout as number) || 30000

      const result = await executeSandbox({
        language,
        code,
        timeoutMs,
      })

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
      }
    },
  },

  run_tests: {
    name: 'run_tests',
    description: 'Execute test suite',
    risk: 'safe',
    parameters: {
      testFile: { type: 'string', description: 'Test file path' },
      framework: { type: 'string', description: 'Test framework (jest, mocha, pytest, junit)' },
    },
    async execute(args, context) {
      const framework = (args.framework as string) || 'jest'
      const testFile = args.testFile as string

      if (!context.runCommand) throw new Error('runCommand not available in context')

      const command = framework === 'jest'
        ? `npx jest ${testFile || ''}`
        : framework === 'pytest'
        ? `pytest ${testFile || ''}`
        : framework === 'junit'
        ? `mvn test ${testFile ? `-Dtest=${testFile}` : ''}`
        : `npm test`

      const result = await context.runCommand(command)

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
      }
    },
  },

  search_code: {
    name: 'search_code',
    description: 'Search for code patterns in the project',
    risk: 'safe',
    parameters: {
      query: { type: 'string', description: 'Search query (regex supported)', required: true },
      filePattern: { type: 'string', description: 'File pattern to search in (e.g., *.ts)' },
    },
    async execute(args, context) {
      const query = args.query as string
      if (!context.searchCode) throw new Error('searchCode not available in context')
      const results = await context.searchCode(query)
      return { matches: results, count: results.length }
    },
  },

  git_commit: {
    name: 'git_commit',
    description: 'Commit changes to git',
    risk: 'medium',
    parameters: {
      message: { type: 'string', description: 'Commit message', required: true },
      files: { type: 'array', description: 'Files to stage (empty = all changes)' },
    },
    async execute(args, context) {
      if (!context.runCommand) throw new Error('runCommand not available in context')

      const message = args.message as string
      const files = (args.files as string[]) || []

      if (files.length > 0) {
        await context.runCommand(`git add ${files.join(' ')}`)
      } else {
        await context.runCommand('git add -A')
      }

      const result = await context.runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`)

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
      }
    },
  },

  run_command: {
    name: 'run_command',
    description: 'Execute shell command (HIGH-RISK)',
    risk: 'high',
    parameters: {
      command: { type: 'string', description: 'Shell command to execute', required: true },
    },
    async execute(args, context) {
      const command = args.command as string
      if (!context.runCommand) throw new Error('runCommand not available in context')

      const result = await context.runCommand(command)

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    },
  },

  network_request: {
    name: 'network_request',
    description: 'Make HTTP request (MEDIUM-RISK)',
    risk: 'medium',
    parameters: {
      url: { type: 'string', description: 'Request URL', required: true },
      method: { type: 'string', description: 'HTTP method (GET, POST, etc.)' },
      body: { type: 'object', description: 'Request body' },
      headers: { type: 'object', description: 'Request headers' },
    },
    async execute(args) {
      const url = args.url as string
      const method = (args.method as string) || 'GET'
      const body = args.body as Record<string, unknown> | undefined
      const headers = (args.headers as Record<string, string>) || {}

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
      })

      const text = await response.text()
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
      }
    },
  },
}

export function getTool(name: string): ToolDefinition | undefined {
  return AGENT_TOOLS[name]
}

export function getAllTools(): ToolDefinition[] {
  return Object.values(AGENT_TOOLS)
}
