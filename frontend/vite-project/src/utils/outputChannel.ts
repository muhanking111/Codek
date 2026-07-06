import {
  CodekOutputChannel as OutputChannel,
  globalOutputLogTelemetryService,
  type OutputChannelListener as ChannelListener,
  type OutputEntryLevel as LogLevel,
  type OutputLogEntry as LogEntry,
} from "../workbench/outputLogTelemetryService"

function getOutputChannel(name: string): OutputChannel {
  return globalOutputLogTelemetryService.getOutputChannel(name)
}

function getAllChannelNames(): string[] {
  return globalOutputLogTelemetryService.getAllChannelNames()
}

function getChannel(name: string): OutputChannel | undefined {
  return globalOutputLogTelemetryService.getChannel(name)
}

export type { LogLevel, LogEntry, ChannelListener }
export { OutputChannel, getOutputChannel, getAllChannelNames, getChannel }
