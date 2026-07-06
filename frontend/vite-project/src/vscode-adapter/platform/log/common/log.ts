/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/log/common/log.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import { ResourceMap } from "../../../base/common/map"
import { URI } from "../../../base/common/uri"
import { createDecorator } from "../../instantiation/common/instantiation"
import type { IEnvironmentService } from "../../environment/common/environment"

export const ILogService = createDecorator<ILogService>("logService")
export const ILoggerService = createDecorator<ILoggerService>("loggerService")

export enum LogLevel {
  Off,
  Trace,
  Debug,
  Info,
  Warning,
  Error,
}

export const DEFAULT_LOG_LEVEL = LogLevel.Info

export interface ILogger extends IDisposable {
  readonly onDidChangeLogLevel: Event<LogLevel>
  getLevel(): LogLevel
  setLevel(level: LogLevel): void
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string | Error, ...args: unknown[]): void
  flush(): void
}

export interface ILogService extends ILogger {
  readonly _serviceBrand: undefined
}

export interface ILoggerResource {
  readonly resource: URI
  readonly id: string
  readonly name?: string
  readonly logLevel?: LogLevel
  readonly hidden?: boolean
  readonly when?: string
  readonly extensionId?: string
  readonly group?: LoggerGroup
}

export interface LoggerGroup {
  readonly id: string
  readonly name: string
}

export interface ILoggerOptions {
  readonly id?: string
  readonly name?: string
  readonly logLevel?: LogLevel | "always"
  readonly hidden?: boolean
  readonly when?: string
  readonly extensionId?: string
  readonly group?: LoggerGroup
}

export interface DidChangeLoggersEvent {
  readonly added: Iterable<ILoggerResource>
  readonly removed: Iterable<ILoggerResource>
}

export interface ILoggerService {
  readonly _serviceBrand: undefined
  createLogger(resource: URI, options?: ILoggerOptions): ILogger
  createLogger(id: string, options?: Omit<ILoggerOptions, "id">): ILogger
  getLogger(resourceOrId: URI | string): ILogger | undefined
  readonly onDidChangeLogLevel: Event<LogLevel | [URI, LogLevel]>
  readonly onDidChangeVisibility: Event<[URI, boolean]>
  readonly onDidChangeLoggers: Event<DidChangeLoggersEvent>
  setLogLevel(level: LogLevel): void
  setLogLevel(resource: URI, level: LogLevel): void
  getLogLevel(resource?: URI): LogLevel
  registerLogger(resource: ILoggerResource): void
  deregisterLogger(idOrResource: URI | string): void
  getRegisteredLoggers(): Iterable<ILoggerResource>
  getRegisteredLogger(resource: URI): ILoggerResource | undefined
  setVisibility(resourceOrId: URI | string, visible: boolean): void
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "number" && value >= LogLevel.Off && value <= LogLevel.Error
}

export function canLog(loggerLevel: LogLevel, messageLevel: LogLevel): boolean {
  return loggerLevel !== LogLevel.Off && loggerLevel <= messageLevel
}

export function log(logger: ILogger, level: LogLevel, message: string): void {
  switch (level) {
    case LogLevel.Trace:
      logger.trace(message)
      break
    case LogLevel.Debug:
      logger.debug(message)
      break
    case LogLevel.Info:
      logger.info(message)
      break
    case LogLevel.Warning:
      logger.warn(message)
      break
    case LogLevel.Error:
      logger.error(message)
      break
    case LogLevel.Off:
      break
  }
}

export function parseLogLevel(logLevel: string): LogLevel | undefined {
  switch (logLevel.trim().toLowerCase()) {
    case "trace":
      return LogLevel.Trace
    case "debug":
      return LogLevel.Debug
    case "info":
      return LogLevel.Info
    case "warn":
      return LogLevel.Warning
    case "error":
    case "critical":
      return LogLevel.Error
    case "off":
      return LogLevel.Off
    default:
      return undefined
  }
}

export function LogLevelToString(logLevel: LogLevel): string {
  switch (logLevel) {
    case LogLevel.Trace:
      return "trace"
    case LogLevel.Debug:
      return "debug"
    case LogLevel.Info:
      return "info"
    case LogLevel.Warning:
      return "warn"
    case LogLevel.Error:
      return "error"
    case LogLevel.Off:
      return "off"
  }
}

export function getLogLevel(environmentService: Pick<IEnvironmentService, "verbose" | "logLevel">): LogLevel {
  if (environmentService.verbose) return LogLevel.Trace
  if (typeof environmentService.logLevel === "string") {
    const parsed = parseLogLevel(environmentService.logLevel.toLowerCase())
    if (parsed !== undefined) return parsed
  }
  return DEFAULT_LOG_LEVEL
}

export class NullLogger implements ILogger {
  private readonly onDidChangeLogLevelEmitter = new Emitter<LogLevel>()
  readonly onDidChangeLogLevel = this.onDidChangeLogLevelEmitter.event
  private level = LogLevel.Info

  getLevel(): LogLevel {
    return this.level
  }

  setLevel(level: LogLevel): void {
    if (this.level === level) return
    this.level = level
    this.onDidChangeLogLevelEmitter.fire(level)
  }

  trace(_message: string, ..._args: unknown[]): void {}
  debug(_message: string, ..._args: unknown[]): void {}
  info(_message: string, ..._args: unknown[]): void {}
  warn(_message: string, ..._args: unknown[]): void {}
  error(_message: string | Error, ..._args: unknown[]): void {}
  flush(): void {}

  dispose(): void {
    this.onDidChangeLogLevelEmitter.dispose()
  }
}

export class NullLogService extends NullLogger implements ILogService {
  declare readonly _serviceBrand: undefined
}

type LoggerEntry = { logger: ILogger | undefined; info: ILoggerResource }

function sanitizeLoggerId(id: string): string {
  const sanitized = id.replace(/[\\/:\*\?"<>\|]/g, "")
  return sanitized || "codek"
}

function resourceKey(resource: URI): string {
  return resource.toString()
}

export abstract class AbstractLoggerService implements ILoggerService {
  declare readonly _serviceBrand: undefined

  private readonly loggers = new ResourceMap<LoggerEntry>(resourceKey)
  private readonly onDidChangeLogLevelEmitter = new Emitter<LogLevel | [URI, LogLevel]>()
  private readonly onDidChangeVisibilityEmitter = new Emitter<[URI, boolean]>()
  private readonly onDidChangeLoggersEmitter = new Emitter<DidChangeLoggersEvent>()

  readonly onDidChangeLogLevel = this.onDidChangeLogLevelEmitter.event
  readonly onDidChangeVisibility = this.onDidChangeVisibilityEmitter.event
  readonly onDidChangeLoggers = this.onDidChangeLoggersEmitter.event

  protected constructor(
    private defaultLogLevel: LogLevel,
    private readonly logsHome: URI,
    loggerResources: Iterable<ILoggerResource> = [],
  ) {
    for (const loggerResource of loggerResources) {
      this.loggers.set(loggerResource.resource, { logger: undefined, info: loggerResource })
    }
  }

  createLogger(resource: URI, options?: ILoggerOptions): ILogger
  createLogger(id: string, options?: Omit<ILoggerOptions, "id">): ILogger
  createLogger(resourceOrId: URI | string, options: ILoggerOptions = {}): ILogger {
    const resource = this.toResource(resourceOrId)
    const id = typeof resourceOrId === "string" ? resourceOrId : options.id ?? resource.toString()
    const existing = this.loggers.get(resource)
    if (existing?.logger) return existing.logger

    const logLevel = options.logLevel === "always" ? LogLevel.Trace : options.logLevel
    const logger = this.doCreateLogger(resource, logLevel ?? this.getLogLevel(resource), { ...options, id })
    const info: ILoggerResource = {
      resource,
      id,
      name: options.name,
      logLevel,
      hidden: options.hidden,
      when: options.when,
      extensionId: options.extensionId,
      group: options.group,
    }
    this.registerLogger(info)
    this.loggers.set(resource, { logger, info })
    return logger
  }

  getLogger(resourceOrId: URI | string): ILogger | undefined {
    return this.getLoggerEntry(resourceOrId)?.logger
  }

  setLogLevel(level: LogLevel): void
  setLogLevel(resource: URI, level: LogLevel): void
  setLogLevel(levelOrResource: LogLevel | URI, level?: LogLevel): void {
    if (URI.isUri(levelOrResource)) {
      if (level === undefined) return
      const entry = this.loggers.get(levelOrResource)
      if (!entry || entry.info.logLevel === level) return
      const info = { ...entry.info, logLevel: level === this.defaultLogLevel ? undefined : level }
      entry.logger?.setLevel(level)
      this.loggers.set(levelOrResource, { ...entry, info })
      this.onDidChangeLogLevelEmitter.fire([levelOrResource, level])
      return
    }

    if (this.defaultLogLevel === levelOrResource) return
    this.defaultLogLevel = levelOrResource
    for (const [resource, entry] of this.loggers.entries()) {
      if (entry.info.logLevel === undefined) {
        entry.logger?.setLevel(this.defaultLogLevel)
        this.loggers.set(resource, entry)
      }
    }
    this.onDidChangeLogLevelEmitter.fire(this.defaultLogLevel)
  }

  getLogLevel(resource?: URI): LogLevel {
    if (resource) return this.loggers.get(resource)?.info.logLevel ?? this.defaultLogLevel
    return this.defaultLogLevel
  }

  registerLogger(resource: ILoggerResource): void {
    const existing = this.loggers.get(resource.resource)
    if (existing) {
      this.loggers.set(resource.resource, { ...existing, info: { ...existing.info, ...resource } })
      return
    }
    this.loggers.set(resource.resource, { logger: undefined, info: resource })
    this.onDidChangeLoggersEmitter.fire({ added: [resource], removed: [] })
  }

  deregisterLogger(idOrResource: URI | string): void {
    const entry = this.getLoggerEntry(idOrResource)
    if (!entry) return
    entry.logger?.dispose()
    this.loggers.delete(entry.info.resource)
    this.onDidChangeLoggersEmitter.fire({ added: [], removed: [entry.info] })
  }

  *getRegisteredLoggers(): Iterable<ILoggerResource> {
    for (const entry of this.loggers.values()) yield entry.info
  }

  getRegisteredLogger(resource: URI): ILoggerResource | undefined {
    return this.loggers.get(resource)?.info
  }

  setVisibility(resourceOrId: URI | string, visible: boolean): void {
    const entry = this.getLoggerEntry(resourceOrId)
    if (!entry || entry.info.hidden === !visible) return
    const info = { ...entry.info, hidden: !visible }
    this.loggers.set(info.resource, { ...entry, info })
    this.onDidChangeVisibilityEmitter.fire([info.resource, visible])
  }

  dispose(): void {
    for (const entry of this.loggers.values()) entry.logger?.dispose()
    this.loggers.clear()
    this.onDidChangeLogLevelEmitter.dispose()
    this.onDidChangeVisibilityEmitter.dispose()
    this.onDidChangeLoggersEmitter.dispose()
  }

  protected toResource(resourceOrId: URI | string): URI {
    return typeof resourceOrId === "string" ? URI.joinPath(this.logsHome, `${sanitizeLoggerId(resourceOrId)}.log`) : resourceOrId
  }

  private getLoggerEntry(resourceOrId: URI | string): LoggerEntry | undefined {
    if (typeof resourceOrId !== "string") return this.loggers.get(resourceOrId)
    const resource = this.toResource(resourceOrId)
    return this.loggers.get(resource) ?? Array.from(this.loggers.values()).find((entry) => entry.info.id === resourceOrId)
  }

  protected abstract doCreateLogger(resource: URI, logLevel: LogLevel, options: ILoggerOptions): ILogger
}

export class CodekLoggerService extends AbstractLoggerService {
  constructor(
    logLevel: LogLevel = DEFAULT_LOG_LEVEL,
    logsHome: URI = URI.parse("log:///codek"),
    private readonly sink: Pick<Console, "debug" | "error" | "info" | "warn"> = console,
  ) {
    super(logLevel, logsHome)
  }

  protected doCreateLogger(_resource: URI, logLevel: LogLevel, options: ILoggerOptions): ILogger {
    return new ConsoleLogger(options.logLevel === "always" ? LogLevel.Trace : logLevel, this.sink)
  }
}

export class NullLoggerService extends AbstractLoggerService {
  constructor(logLevel: LogLevel = LogLevel.Off, logsHome: URI = URI.parse("log:///codek")) {
    super(logLevel, logsHome)
  }

  protected doCreateLogger(_resource: URI, logLevel: LogLevel): ILogger {
    const logger = new NullLogger()
    logger.setLevel(logLevel)
    return logger
  }
}

export function createLoggerFromOldEntryProxy(loggerService: ILoggerService, id: string, name?: string, logLevel?: LogLevel | "always"): ILogger {
  return loggerService.createLogger(id, { name, logLevel })
}

export class ConsoleLogger extends NullLogger {
  constructor(level: LogLevel = DEFAULT_LOG_LEVEL, private readonly sink: Pick<Console, "debug" | "error" | "info" | "warn"> = console) {
    super()
    this.setLevel(level)
  }

  override trace(message: string, ...args: unknown[]): void {
    if (canLog(this.getLevel(), LogLevel.Trace)) this.sink.debug(message, ...args)
  }

  override debug(message: string, ...args: unknown[]): void {
    if (canLog(this.getLevel(), LogLevel.Debug)) this.sink.debug(message, ...args)
  }

  override info(message: string, ...args: unknown[]): void {
    if (canLog(this.getLevel(), LogLevel.Info)) this.sink.info(message, ...args)
  }

  override warn(message: string, ...args: unknown[]): void {
    if (canLog(this.getLevel(), LogLevel.Warning)) this.sink.warn(message, ...args)
  }

  override error(message: string | Error, ...args: unknown[]): void {
    if (canLog(this.getLevel(), LogLevel.Error)) this.sink.error(message, ...args)
  }
}
