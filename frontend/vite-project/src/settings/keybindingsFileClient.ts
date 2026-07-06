import { api } from "../lib/api"
import type { VsCodeKeybindingEntry } from "./keybindingsJson"

export interface UserKeybindingsFile {
  path: string
  keybindings: VsCodeKeybindingEntry[]
}

export async function readUserKeybindingsFile(): Promise<UserKeybindingsFile> {
  return api.get<UserKeybindingsFile>("/keybindings/user")
}

export async function writeUserKeybindingsFile(
  keybindings: VsCodeKeybindingEntry[],
): Promise<UserKeybindingsFile> {
  return api.request<UserKeybindingsFile>("PUT", "/keybindings/user", { keybindings })
}
