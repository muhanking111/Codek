/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/environment/common/environment.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { URI } from "../../../base/common/uri"
import { createDecorator, refineServiceDecorator } from "../../instantiation/common/instantiation"

export interface IDebugParams {
  port: number | null
  break: boolean
}

export interface IExtensionHostDebugParams extends IDebugParams {
  debugId?: string
  env?: Record<string, string>
}

export type ExtensionKind = "ui" | "workspace" | "web"

export interface IEnvironmentService {
  readonly _serviceBrand: undefined
  stateResource: URI
  userRoamingDataHome: URI
  keyboardLayoutResource: URI
  argvResource: URI
  untitledWorkspacesHome: URI
  workspaceStorageHome: URI
  localHistoryHome: URI
  cacheHome: URI
  appSharedDataHome: URI
  userDataSyncHome: URI
  sync: "on" | "off" | undefined
  continueOn?: string
  editSessionId?: string
  debugExtensionHost: IExtensionHostDebugParams
  isExtensionDevelopment: boolean
  disableExtensions: boolean | string[]
  skipBuiltinExtensions?: readonly string[]
  enableExtensions?: readonly string[]
  extensionDevelopmentLocationURI?: URI[]
  extensionDevelopmentKind?: ExtensionKind[]
  extensionTestsLocationURI?: URI
  logsHome: URI
  logLevel?: string
  extensionLogLevel?: [string, string][]
  verbose: boolean
  isBuilt: boolean
  disableTelemetry: boolean
  disableExperiments: boolean
  serviceMachineIdResource: URI
  agentSessionsWorkspace?: URI
  policyFile?: URI
}

export interface INativeEnvironmentService extends IEnvironmentService {
  args: Record<string, unknown>
  appRoot: string
  userHome: URI
  appSettingsHome: URI
  tmpDir: URI
  userDataPath: string
  extensionsPath: string
  extensionsDownloadLocation: URI
  builtinExtensionsPath: string
  useInMemorySecretStorage?: boolean
  crossOriginIsolated?: boolean
  exportPolicyData?: string
  exportDefaultKeybindings?: string
}

export const IEnvironmentService = createDecorator<IEnvironmentService>("environmentService")
export const INativeEnvironmentService = refineServiceDecorator<IEnvironmentService, INativeEnvironmentService>(IEnvironmentService)

export interface ICodekEnvironmentServiceOptions {
  codekHome?: URI | string
  workspaceHome?: URI | string
  isBuilt?: boolean
  disableTelemetry?: boolean
}

function toUri(value: URI | string): URI {
  return typeof value === "string" ? URI.file(value) : value
}

export const defaultCodekEnvironmentHome = URI.file("D:\\Workspace\\.codek")

export function createCodekEnvironmentService(
  overrides: Partial<IEnvironmentService> = {},
  options: ICodekEnvironmentServiceOptions = {},
): IEnvironmentService {
  const codekHome = toUri(options.codekHome ?? defaultCodekEnvironmentHome)
  const workspaceHome = options.workspaceHome ? toUri(options.workspaceHome) : codekHome
  return {
    _serviceBrand: undefined,
    stateResource: URI.joinPath(codekHome, "state.json"),
    userRoamingDataHome: URI.joinPath(codekHome, "user"),
    keyboardLayoutResource: URI.joinPath(codekHome, "keyboardLayout.json"),
    argvResource: URI.joinPath(codekHome, "argv.json"),
    untitledWorkspacesHome: URI.joinPath(codekHome, "workspaces", "untitled"),
    workspaceStorageHome: URI.joinPath(codekHome, "workspaceStorage"),
    localHistoryHome: URI.joinPath(codekHome, "history"),
    cacheHome: URI.joinPath(codekHome, "cache"),
    appSharedDataHome: URI.joinPath(codekHome, "shared"),
    userDataSyncHome: URI.joinPath(codekHome, "sync"),
    sync: undefined,
    debugExtensionHost: { port: null, break: false },
    isExtensionDevelopment: false,
    disableExtensions: false,
    logsHome: URI.joinPath(codekHome, "logs"),
    verbose: false,
    isBuilt: options.isBuilt ?? false,
    disableTelemetry: options.disableTelemetry ?? true,
    disableExperiments: true,
    serviceMachineIdResource: URI.joinPath(codekHome, "machineid"),
    agentSessionsWorkspace: URI.joinPath(workspaceHome, "agentSessions"),
    ...overrides,
  }
}
