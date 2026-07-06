import { evaluateWhenClause, type ContextKeyState } from "./contextKeys"
import { scoreCommandPaletteMatch } from "../vscode-adapter/platform/commands/common/commandScoring"
import { VscodeCommandsRegistry, type CommandMetadata, type Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"

export type CommandSource = "codek" | "vscode" | "extension" | "agent"

export interface CommandDescriptor<TArgs extends unknown[] = unknown[]> {
  id: string
  title: string
  category?: string
  source?: CommandSource
  when?: string
  precondition?: string
  metadata?: CommandMetadata | null
  handler?: (...args: TArgs) => void | Promise<void>
}

const commandRegistry = new VscodeCommandsRegistry<CommandDescriptor>()
const commandErrors: CommandExecutionError[] = []

export interface ICommandService {
  readonly _serviceBrand: undefined
  executeCommand(id: string, ...args: unknown[]): Promise<boolean>
  executeCommandWithContext(id: string, context: ContextKeyState, ...args: unknown[]): Promise<boolean>
  getCommand(id: string): CommandDescriptor | null
  getCommands(context?: ContextKeyState): CommandDescriptor[]
}

export const ICommandService = createDecorator<ICommandService>("commandService")

export interface CommandExecutionError {
  id: string
  message: string
  error: unknown
}

export function registerCommand(command: CommandDescriptor): Disposable {
  return commandRegistry.registerCommand({ ...command, source: command.source || "codek" })
}

export function registerCommandAlias(oldId: string, newId: string): Disposable {
  return commandRegistry.registerCommandAlias(oldId, newId, (id, targetId) => ({
    id,
    title: targetId,
    source: "vscode",
    handler: async (...args: unknown[]) => {
      await executeCommand(targetId, args)
    },
  }))
}

export function unregisterCommand(id: string): void {
  commandRegistry.unregisterCommand(id)
}

export function clearCommands(): void {
  commandRegistry.clear()
  commandErrors.length = 0
}

export function getCommand(id: string): CommandDescriptor | null {
  return commandRegistry.getCommand(id)
}

export function getCommands(context: ContextKeyState = {}): CommandDescriptor[] {
  return commandRegistry.getCommands().filter((command) => isCommandVisible(command, context))
}

export async function executeCommand(id: string, args: unknown[] = [], context: ContextKeyState = {}): Promise<boolean> {
  const command = commandRegistry.getCommand(id)
  if (!command || !isCommandEnabled(command, context) || !command.handler) return false
  try {
    await command.handler(...args)
    return true
  } catch (error) {
    commandErrors.push({
      id,
      error,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export function scoreCommand(command: CommandDescriptor, query: string): number {
  return scoreCommandPaletteMatch(command, query)
}

export function searchCommands(query: string, context: ContextKeyState = {}): CommandDescriptor[] {
  return getCommands(context)
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title))
    .map((entry) => entry.command)
}

export function isCommandVisible(command: CommandDescriptor, context: ContextKeyState = {}): boolean {
  return evaluateWhenClause(command.when, context)
}

export function isCommandEnabled(command: CommandDescriptor, context: ContextKeyState = {}): boolean {
  return isCommandVisible(command, context) && evaluateWhenClause(command.precondition, context)
}

export function getCommandRegistrationDiagnostics(id: string) {
  return commandRegistry.getDiagnostics(id)
}

export function getCommandExecutionErrors(): CommandExecutionError[] {
  return [...commandErrors]
}

export class CommandService implements ICommandService {
  declare readonly _serviceBrand: undefined

  executeCommand(id: string, ...args: unknown[]): Promise<boolean> {
    return executeCommand(id, args)
  }

  executeCommandWithContext(id: string, context: ContextKeyState, ...args: unknown[]): Promise<boolean> {
    return executeCommand(id, args, context)
  }

  getCommand(id: string): CommandDescriptor | null {
    return getCommand(id)
  }

  getCommands(context: ContextKeyState = {}): CommandDescriptor[] {
    return getCommands(context)
  }
}

export const globalCommandService = new CommandService()
registerSingleton(ICommandService, globalCommandService, InstantiationType.Delayed)
