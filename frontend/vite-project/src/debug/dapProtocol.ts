export interface ProtocolMessage {
  seq: number
  type: "request" | "response" | "event"
}

export interface Request extends ProtocolMessage {
  type: "request"
  command: string
  arguments?: Record<string, unknown>
}

export interface Response extends ProtocolMessage {
  type: "response"
  request_seq: number
  success: boolean
  command: string
  message?: string
  body?: Record<string, unknown>
}

export interface Event extends ProtocolMessage {
  type: "event"
  event: string
  body?: Record<string, unknown>
}

export type StoppedReason =
  | "step"
  | "breakpoint"
  | "exception"
  | "pause"
  | "entry"
  | "goto"
  | "function breakpoint"
  | "data breakpoint"
  | "instruction breakpoint"

export type SteppingGranularity = "statement" | "line" | "instruction"

export type BreakpointReason = "changed" | "new" | "removed"

export type ThreadReason = "started" | "exited"

export type OutputCategory =
  | "console"
  | "important"
  | "stdout"
  | "stderr"
  | "telemetry"

export type BreakMode = "never" | "always" | "unhandled" | "userHandled"

export interface Source {
  name?: string
  path?: string
  sourceReference?: number
  presentationHint?: "normal" | "emphasize" | "deemphasize"
  origin?: string
  adapterData?: unknown
}

export interface Breakpoint {
  id?: number
  verified: boolean
  message?: string
  source?: Source
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface SourceBreakpoint {
  line: number
  column?: number
  condition?: string
  hitCondition?: string
  logMessage?: string
}

export interface FunctionBreakpoint {
  name: string
  condition?: string
  hitCondition?: string
}

export interface StackFrame {
  id: number
  name: string
  source?: Source
  line: number
  column: number
  endLine?: number
  endColumn?: number
  canRestart?: boolean
  presentationHint?: "normal" | "label" | "subtle"
  moduleId?: number | string
}

export interface Thread {
  id: number
  name: string
}

export interface Scope {
  name: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  expensive: boolean
  source?: Source
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  evaluateName?: string
  memoryReference?: string
  presentationHint?: VariablePresentationHint
}

export interface VariablePresentationHint {
  kind?: string
  attributes?: string[]
  visibility?: "public" | "private" | "protected" | "internal" | "final"
  lazy?: boolean
}

export interface ExceptionBreakpointsFilter {
  filter: string
  label: string
  description?: string
  default?: boolean
  supportsCondition?: boolean
  conditionDescription?: string
}

export interface ColumnDescriptor {
  attributeName: string
  label: string
  format?: string
  type?: "string" | "number" | "boolean" | "unixTimestampUTC"
  width?: number
}

export type ChecksumAlgorithm = "MD5" | "SHA1" | "SHA256" | "timestamp"

export interface Capabilities {
  supportsConfigurationDoneRequest?: boolean
  supportsFunctionBreakpoints?: boolean
  supportsConditionalBreakpoints?: boolean
  supportsHitConditionalBreakpoints?: boolean
  supportsEvaluateForHovers?: boolean
  supportsStepBack?: boolean
  supportsSetVariable?: boolean
  supportsRestartFrame?: boolean
  supportsGotoTargetsRequest?: boolean
  supportsStepInTargetsRequest?: boolean
  supportsCompletionsRequest?: boolean
  supportsModulesRequest?: boolean
  supportsRestartRequest?: boolean
  supportsExceptionOptions?: boolean
  supportsValueFormattingOptions?: boolean
  supportsExceptionInfoRequest?: boolean
  supportTerminateDebuggee?: boolean
  supportsDelayedStackTraceLoading?: boolean
  supportsLoadedSourcesRequest?: boolean
  supportsLogPoints?: boolean
  supportsTerminateThreadsRequest?: boolean
  supportsSetExpression?: boolean
  supportsTerminateRequest?: boolean
  supportsDataBreakpoints?: boolean
  supportsReadMemoryRequest?: boolean
  supportsWriteMemoryRequest?: boolean
  supportsDisassembleRequest?: boolean
  supportsCancelRequest?: boolean
  supportsBreakpointLocationsRequest?: boolean
  supportsClipboardContext?: boolean
  supportsSteppingGranularity?: boolean
  supportsInstructionBreakpoints?: boolean
  supportsExceptionFilterOptions?: boolean
  supportsSingleThreadExecutionRequests?: boolean
  exceptionBreakpointFilters?: ExceptionBreakpointsFilter[]
  completionTriggerCharacters?: string[]
  additionalModuleColumns?: ColumnDescriptor[]
  supportedChecksumAlgorithms?: ChecksumAlgorithm[]
}

export interface InitializeRequestArguments {
  clientID?: string
  clientName?: string
  adapterID: string
  pathFormat?: "none" | "file" | "uri"
  linesStartAt1?: boolean
  columnsStartAt1?: boolean
  supportsVariableType?: boolean
  supportsVariablePaging?: boolean
  supportsRunInTerminalRequest?: boolean
  supportsMemoryReferences?: boolean
  supportsProgressReporting?: boolean
  supportsInvalidatedEvent?: boolean
  supportsMemoryEvent?: boolean
  supportsArgsCanBeInterpretedByShell?: boolean
  supportsStartsDebuggingRequest?: boolean
  locale?: string
}

export interface LaunchRequestArguments {
  noDebug?: boolean
  [key: string]: unknown
}

export interface AttachRequestArguments {
  [key: string]: unknown
}

export interface DisconnectArguments {
  restart?: boolean
  terminateDebuggee?: boolean
  suspendDebuggee?: boolean
}

export interface TerminateArguments {
  restart?: boolean
}

export interface SetBreakpointsArguments {
  source: Source
  breakpoints?: SourceBreakpoint[]
  lines?: number[]
  sourceModified?: boolean
}

export interface SetBreakpointsResponseBody {
  breakpoints: Breakpoint[]
}

export interface SetFunctionBreakpointsArguments {
  breakpoints: FunctionBreakpoint[]
}

export interface SetFunctionBreakpointsResponseBody {
  breakpoints: Breakpoint[]
}

export interface SetExceptionBreakpointsArguments {
  filters: string[]
  filterOptions?: ExceptionFilterOptions[]
  exceptionOptions?: ExceptionOptions[]
}

export interface ExceptionFilterOptions {
  filterId: string
  condition?: string
}

export interface ExceptionOptions {
  path?: ExceptionPathSegment[]
  breakMode: BreakMode
}

export interface ExceptionPathSegment {
  negate?: boolean
  names: string[]
}

export interface ContinueArguments {
  threadId: number
  singleThread?: boolean
}

export interface ContinueResponseBody {
  allThreadsContinued?: boolean
}

export interface NextArguments {
  threadId: number
  singleThread?: boolean
  granularity?: SteppingGranularity
}

export interface StepInArguments {
  threadId: number
  singleThread?: boolean
  targetId?: number
  granularity?: SteppingGranularity
}

export interface StepOutArguments {
  threadId: number
  singleThread?: boolean
  granularity?: SteppingGranularity
}

export interface PauseArguments {
  threadId: number
}

export interface StackFrameFormat {
  parameters?: boolean
  parameterTypes?: boolean
  parameterNames?: boolean
  parameterValues?: boolean
  line?: boolean
  module?: boolean
  includeAll?: boolean
}

export interface StackTraceArguments {
  threadId: number
  startFrame?: number
  levels?: number
  format?: StackFrameFormat
}

export interface StackTraceResponseBody {
  stackFrames: StackFrame[]
  totalFrames?: number
}

export interface ScopesArguments {
  frameId: number
}

export interface ScopesResponseBody {
  scopes: Scope[]
}

export interface ValueFormat {
  hex?: boolean
}

export interface VariablesArguments {
  variablesReference: number
  filter?: "named" | "indexed"
  start?: number
  count?: number
  format?: ValueFormat
}

export interface VariablesResponseBody {
  variables: Variable[]
}

export interface EvaluateArguments {
  expression: string
  frameId?: number
  context?: "watch" | "repl" | "hover" | "clipboard" | "variables"
  format?: ValueFormat
}

export interface EvaluateResponseBody {
  result: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  memoryReference?: string
  presentationHint?: VariablePresentationHint
}

export interface SetVariableArguments {
  variablesReference: number
  name: string
  value: string
  format?: ValueFormat
}

export interface SetVariableResponseBody {
  value: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
}

export interface Module {
  id: number | string
  name: string
  path?: string
  isOptimized?: boolean
  isUserCode?: boolean
  version?: string
  symbolStatus?: string
  symbolFilePath?: string
  dateTimeStamp?: string
  addressRange?: string
}

export type InitializedEventBody = Record<string, never>

export interface StoppedEventBody {
  reason: StoppedReason
  description?: string
  threadId?: number
  preserveFocusHint?: boolean
  text?: string
  allThreadsStopped?: boolean
  hitBreakpointIds?: number[]
}

export interface ContinuedEventBody {
  threadId: number
  allThreadsContinued?: boolean
}

export interface TerminatedEventBody {
  restart?: boolean
}

export interface ExitedEventBody {
  exitCode: number
}

export interface ThreadEventBody {
  reason: ThreadReason
  threadId: number
}

export interface BreakpointEventBody {
  reason: BreakpointReason
  breakpoint: Breakpoint
}

export interface OutputEventBody {
  category?: OutputCategory
  output: string
  group?: "start" | "startCollapsed" | "end"
  variablesReference?: number
  source?: Source
  line?: number
  column?: number
  data?: unknown
}

export interface ModuleEventBody {
  reason: "new" | "changed" | "removed"
  module: Module
}

export type DapCommand =
  | "initialize"
  | "launch"
  | "attach"
  | "disconnect"
  | "terminate"
  | "setBreakpoints"
  | "setFunctionBreakpoints"
  | "setExceptionBreakpoints"
  | "configurationDone"
  | "continue"
  | "next"
  | "stepIn"
  | "stepOut"
  | "pause"
  | "threads"
  | "stackTrace"
  | "scopes"
  | "variables"
  | "evaluate"
  | "setVariable"

export interface DapRequestMap {
  initialize: { args: InitializeRequestArguments; result: Capabilities }
  launch: { args: LaunchRequestArguments; result: void }
  attach: { args: AttachRequestArguments; result: void }
  disconnect: { args: DisconnectArguments; result: void }
  terminate: { args: TerminateArguments; result: void }
  setBreakpoints: { args: SetBreakpointsArguments; result: SetBreakpointsResponseBody }
  setFunctionBreakpoints: { args: SetFunctionBreakpointsArguments; result: SetFunctionBreakpointsResponseBody }
  setExceptionBreakpoints: { args: SetExceptionBreakpointsArguments; result: void }
  configurationDone: { args: void; result: void }
  continue: { args: ContinueArguments; result: ContinueResponseBody }
  next: { args: NextArguments; result: void }
  stepIn: { args: StepInArguments; result: void }
  stepOut: { args: StepOutArguments; result: void }
  pause: { args: PauseArguments; result: void }
  threads: { args: void; result: ThreadsResponseBody }
  stackTrace: { args: StackTraceArguments; result: StackTraceResponseBody }
  scopes: { args: ScopesArguments; result: ScopesResponseBody }
  variables: { args: VariablesArguments; result: VariablesResponseBody }
  evaluate: { args: EvaluateArguments; result: EvaluateResponseBody }
  setVariable: { args: SetVariableArguments; result: SetVariableResponseBody }
}

export interface ThreadsResponseBody {
  threads: Thread[]
}

export type DapEventType =
  | "initialized"
  | "stopped"
  | "continued"
  | "terminated"
  | "exited"
  | "thread"
  | "breakpoint"
  | "output"
  | "module"

export interface DapEventMap {
  initialized: InitializedEventBody
  stopped: StoppedEventBody
  continued: ContinuedEventBody
  terminated: TerminatedEventBody
  exited: ExitedEventBody
  thread: ThreadEventBody
  breakpoint: BreakpointEventBody
  output: OutputEventBody
  module: ModuleEventBody
}
