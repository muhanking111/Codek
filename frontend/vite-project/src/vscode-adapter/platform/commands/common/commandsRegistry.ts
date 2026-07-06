// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\platform\commands\common\commands.ts
//
// Codek keeps its localized command descriptors and existing execute API. This
// adapter ports the important CommandsRegistry semantics: an id can have a stack
// of registrations, the newest registration wins, and disposing it restores the
// previous one instead of deleting the command outright.

export interface Disposable {
  dispose(): void
}

export type CommandArgumentConstraint =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "function"
  | ((value: unknown) => boolean)

export interface CommandArgumentMetadata {
  name: string
  isOptional?: boolean
  constraint?: CommandArgumentConstraint
  description?: string
}

export interface CommandMetadata {
  description?: string | { value: string }
  args?: readonly CommandArgumentMetadata[]
  returns?: string
}

export interface CommandRegistryEvent<TCommand> {
  type: "register" | "unregister"
  id: string
  command: TCommand | null
}

export interface CommandRegistrationDiagnostics<TCommand> {
  id: string
  active: TCommand | null
  stackDepth: number
  duplicateCount: number
}

type Listener<TCommand> = (event: CommandRegistryEvent<TCommand>) => void

export class VscodeCommandsRegistry<TCommand extends {
  id: string
  handler?: (...args: unknown[]) => unknown
  metadata?: CommandMetadata | null
}> {
  private readonly commands = new Map<string, TCommand[]>()
  private readonly listeners = new Set<Listener<TCommand>>()

  onDidChange(listener: Listener<TCommand>): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  registerCommand(command: TCommand): Disposable {
    if (!command.id.trim()) throw new Error("Command id is required")

    const registeredCommand = withValidatedHandler(command)
    const stack = this.commands.get(command.id) ?? []
    stack.unshift(registeredCommand)
    this.commands.set(command.id, stack)
    this.emit({ type: "register", id: command.id, command: registeredCommand })

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const currentStack = this.commands.get(command.id)
        if (!currentStack) return
        const index = currentStack.indexOf(registeredCommand)
        if (index !== -1) currentStack.splice(index, 1)
        if (currentStack.length === 0) {
          this.commands.delete(command.id)
          this.emit({ type: "unregister", id: command.id, command: null })
          return
        }
        this.emit({ type: "register", id: command.id, command: currentStack[0] })
      },
    }
  }

  registerCommandAlias(oldId: string, newId: string, createAlias: (oldId: string, newId: string) => TCommand): Disposable {
    if (!oldId.trim() || !newId.trim()) throw new Error("Command id is required")
    return this.registerCommand(createAlias(oldId, newId))
  }

  unregisterCommand(id: string): void {
    const stack = this.commands.get(id)
    if (!stack?.length) return
    stack.shift()
    if (stack.length === 0) {
      this.commands.delete(id)
      this.emit({ type: "unregister", id, command: null })
      return
    }
    this.emit({ type: "register", id, command: stack[0] })
  }

  clear(): void {
    if (this.commands.size === 0) return
    const ids = Array.from(this.commands.keys())
    this.commands.clear()
    for (const id of ids) this.emit({ type: "unregister", id, command: null })
  }

  getCommand(id: string): TCommand | null {
    return this.commands.get(id)?.[0] ?? null
  }

  getCommands(): TCommand[] {
    return Array.from(this.commands.values(), (stack) => stack[0]).filter(Boolean)
  }

  getDiagnostics(id: string): CommandRegistrationDiagnostics<TCommand> {
    const stack = this.commands.get(id) ?? []
    return {
      id,
      active: stack[0] ?? null,
      stackDepth: stack.length,
      duplicateCount: Math.max(0, stack.length - 1),
    }
  }

  private emit(event: CommandRegistryEvent<TCommand>): void {
    for (const listener of this.listeners) listener(event)
  }
}

function withValidatedHandler<TCommand extends {
  id: string
  handler?: (...args: unknown[]) => unknown
  metadata?: CommandMetadata | null
}>(command: TCommand): TCommand {
  if (!command.handler || !command.metadata?.args?.length) return command

  const actualHandler = command.handler
  command.handler = (...args: unknown[]) => {
    validateArguments(command.id, command.metadata?.args ?? [], args)
    return actualHandler(...args)
  }
  return command
}

function validateArguments(commandId: string, metadata: readonly CommandArgumentMetadata[], args: unknown[]): void {
  for (let index = 0; index < metadata.length; index += 1) {
    const arg = metadata[index]
    const value = args[index]
    if (value === undefined || value === null) {
      if (arg.isOptional) continue
      throw new TypeError(`Invalid argument '${arg.name}' for command '${commandId}'`)
    }
    if (!arg.constraint) continue
    if (!matchesConstraint(value, arg.constraint)) {
      throw new TypeError(`Invalid argument '${arg.name}' for command '${commandId}'`)
    }
  }
}

function matchesConstraint(value: unknown, constraint: CommandArgumentConstraint): boolean {
  if (typeof constraint === "function") return constraint(value)
  if (constraint === "array") return Array.isArray(value)
  if (constraint === "object") return typeof value === "object" && value !== null && !Array.isArray(value)
  return typeof value === constraint
}
