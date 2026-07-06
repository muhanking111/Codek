/*---------------------------------------------------------------------------------------------
 * VS Code source adapter inspired by src/vs/platform/label/common/label.ts
 * and src/vs/base/common/labels.ts.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import { extUriBiasedIgnorePathCase } from "../../../base/common/resources"
import { URI } from "../../../base/common/uri"
import { createDecorator } from "../../instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import {
  globalWorkspaceContextService,
  type IWorkspace,
  type ISingleFolderWorkspaceIdentifier,
  type IWorkspaceContextService,
  type IWorkspaceIdentifier,
} from "../../workspace/common/workspace"

export const ILabelService = createDecorator<ILabelService>("labelService")

export const enum Verbosity {
  SHORT,
  MEDIUM,
  LONG,
}

export interface IFormatterChangeEvent {
  readonly scheme: string
}

export interface ResourceLabelFormatter {
  readonly scheme: string
  readonly authority?: string
  readonly priority?: boolean
  readonly formatting: ResourceLabelFormatting
}

export interface ResourceLabelFormatting {
  readonly label: string
  readonly separator: "/" | "\\" | ""
  readonly tildify?: boolean
  readonly normalizeDriveLetter?: boolean
  readonly workspaceSuffix?: string
  readonly workspaceTooltip?: string
  readonly authorityPrefix?: string
  readonly stripPathStartingSeparator?: boolean
  readonly stripPathSegments?: number
}

export interface ILabelService {
  readonly _serviceBrand: undefined
  getUriLabel(resource: URI, options?: { relative?: boolean; noPrefix?: boolean; separator?: "/" | "\\"; appendWorkspaceSuffix?: boolean }): string
  getUriBasenameLabel(resource: URI): string
  getWorkspaceLabel(workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI | IWorkspace, options?: { verbose: Verbosity }): string
  getHostLabel(scheme: string, authority?: string): string
  getHostTooltip(scheme: string, authority?: string): string | undefined
  getSeparator(scheme: string, authority?: string): "/" | "\\"
  registerFormatter(formatter: ResourceLabelFormatter): IDisposable
  readonly onDidChangeFormatters: Event<IFormatterChangeEvent>
  registerCachedFormatter(formatter: ResourceLabelFormatter): IDisposable
}

export class CodekLabelService implements ILabelService {
  declare readonly _serviceBrand: undefined

  private readonly onDidChangeFormattersEmitter = new Emitter<IFormatterChangeEvent>()
  readonly onDidChangeFormatters = this.onDidChangeFormattersEmitter.event
  private readonly formatters: ResourceLabelFormatter[] = []
  private readonly cachedFormatters: ResourceLabelFormatter[] = []

  constructor(private readonly workspaceContextService: IWorkspaceContextService = globalWorkspaceContextService) {}

  getUriLabel(resource: URI, options: { relative?: boolean; noPrefix?: boolean; separator?: "/" | "\\"; appendWorkspaceSuffix?: boolean } = {}): string {
    const formatter = this.findFormatter(resource)
    const separator = options.separator || formatter?.formatting.separator || (resource.scheme === "file" ? "\\" : "/")
    let label = formatter
      ? this.applyFormatter(resource, formatter)
      : this.defaultUriLabel(resource)

    if (options.relative) {
      const relativeLabel = this.relativeUriLabel(resource, Boolean(options.noPrefix), separator)
      if (relativeLabel !== null) label = relativeLabel
    }

    if (separator) label = label.replace(/[\\/]/g, separator)
    if (options.appendWorkspaceSuffix) {
      const workspaceLabel = this.getWorkspaceLabel(this.workspaceContextService.getWorkspace(), { verbose: Verbosity.SHORT })
      if (workspaceLabel) label = `${label} [${workspaceLabel}]`
    }
    return label
  }

  getUriBasenameLabel(resource: URI): string {
    return basename(resource.path || resource.fsPath || resource.toString())
  }

  getWorkspaceLabel(
    workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI | IWorkspace,
    options: { verbose: Verbosity } = { verbose: Verbosity.MEDIUM },
  ): string {
    if (URI.isUri(workspace)) return options.verbose === Verbosity.LONG ? this.getUriLabel(workspace) : this.getUriBasenameLabel(workspace)
    const candidate = workspace as Partial<IWorkspace & IWorkspaceIdentifier & ISingleFolderWorkspaceIdentifier>
    if (candidate.folders) {
      if (candidate.name && options.verbose !== Verbosity.LONG) return candidate.name
      if (candidate.configuration) return options.verbose === Verbosity.LONG ? this.getUriLabel(candidate.configuration) : this.getUriBasenameLabel(candidate.configuration)
      if (candidate.folders.length === 1) return this.getWorkspaceLabel(candidate.folders[0].uri, options)
      return candidate.name || `${candidate.folders.length} folders`
    }
    if (candidate.configPath) return this.getWorkspaceLabel(candidate.configPath, options)
    if (candidate.uri) return this.getWorkspaceLabel(candidate.uri, options)
    return String(candidate.id || "")
  }

  getHostLabel(scheme: string, authority = ""): string {
    if (!authority) return scheme
    return `${scheme}: ${authority}`
  }

  getHostTooltip(scheme: string, authority = ""): string | undefined {
    return authority ? this.getHostLabel(scheme, authority) : undefined
  }

  getSeparator(scheme: string, authority?: string): "/" | "\\" {
    return this.findFormatter(URI.from({ scheme, authority, path: "/" }))?.formatting.separator || (scheme === "file" ? "\\" : "/")
  }

  registerFormatter(formatter: ResourceLabelFormatter): IDisposable {
    this.formatters.unshift(formatter)
    this.onDidChangeFormattersEmitter.fire({ scheme: formatter.scheme })
    return {
      dispose: () => {
        const index = this.formatters.indexOf(formatter)
        if (index >= 0) {
          this.formatters.splice(index, 1)
          this.onDidChangeFormattersEmitter.fire({ scheme: formatter.scheme })
        }
      },
    }
  }

  registerCachedFormatter(formatter: ResourceLabelFormatter): IDisposable {
    this.cachedFormatters.unshift(formatter)
    this.onDidChangeFormattersEmitter.fire({ scheme: formatter.scheme })
    return { dispose() {} }
  }

  private relativeUriLabel(resource: URI, noPrefix: boolean, separator: "/" | "\\"): string | null {
    const workspace = this.workspaceContextService.getWorkspace()
    const folder = this.workspaceContextService.getWorkspaceFolder(resource)
    if (!folder) return null
    let relativePath = extUriBiasedIgnorePathCase.relativePath(folder.uri, resource) ?? ""
    if (separator) relativePath = relativePath.replace(/[\\/]/g, separator)
    if (workspace.folders.length > 1 && !noPrefix) {
      return relativePath ? `${folder.name} • ${relativePath}` : folder.name
    }
    return relativePath
  }

  private defaultUriLabel(resource: URI): string {
    if (resource.scheme === "file") return normalizeDriveLetter(resource.fsPath || resource.path)
    if (resource.authority) return `${resource.scheme}://${resource.authority}${resource.path}`
    return resource.path || resource.toString()
  }

  private findFormatter(resource: URI): ResourceLabelFormatter | undefined {
    const all = [...this.formatters, ...this.cachedFormatters]
    const matches = all.filter((formatter) => {
      if (formatter.scheme !== resource.scheme) return false
      return !formatter.authority || formatter.authority === resource.authority
    })
    return matches.find((formatter) => formatter.priority) || matches[0]
  }

  private applyFormatter(resource: URI, formatter: ResourceLabelFormatter): string {
    const formatting = formatter.formatting
    let path = resource.path || ""
    if (typeof formatting.stripPathSegments === "number" && formatting.stripPathSegments > 0) {
      const parts = path.split("/").filter(Boolean).slice(formatting.stripPathSegments)
      path = `/${parts.join("/")}`
    }
    if (formatting.stripPathStartingSeparator) path = path.replace(/^\/+/, "")
    let label = formatting.label
      .replace(/\$\{scheme\}/g, resource.scheme)
      .replace(/\$\{authority\}/g, resource.authority)
      .replace(/\$\{path\}/g, path)
    if (formatting.authorityPrefix && resource.authority && !label.startsWith(formatting.authorityPrefix)) {
      label = `${formatting.authorityPrefix}${label}`
    }
    if (formatting.normalizeDriveLetter) label = normalizeDriveLetter(label)
    if (formatting.workspaceSuffix) label = `${label} [${formatting.workspaceSuffix}]`
    return label
  }
}

export const globalLabelService = new CodekLabelService(globalWorkspaceContextService)
registerSingleton(ILabelService, globalLabelService, InstantiationType.Delayed)

function basename(pathValue: string): string {
  const normalized = String(pathValue || "").replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized.split("/").filter(Boolean).pop() || normalized
}

function normalizeDriveLetter(pathValue: string): string {
  if (/^[a-z]:/.test(pathValue)) return `${pathValue[0].toUpperCase()}${pathValue.slice(1)}`
  if (/^\/[a-z]:/.test(pathValue)) return `/${pathValue[1].toUpperCase()}${pathValue.slice(2)}`
  return pathValue
}
