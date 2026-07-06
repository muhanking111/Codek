import { reactive } from "vue"

export type RewriteCategory = "performance" | "readability" | "safety" | "modern" | "bug"
export type RewriteSeverity = "info" | "warning" | "critical"

export interface RewriteSuggestion {
  id: string
  file: string
  startLine: number
  endLine: number
  originalCode: string
  suggestedCode: string
  description: string
  category: RewriteCategory
  severity: RewriteSeverity
}

interface RewriteState {
  suggestions: RewriteSuggestion[]
  isScanning: boolean
  queueSize: number
}

export const rewriteState = reactive<RewriteState>({
  suggestions: [],
  isScanning: false,
  queueSize: 0,
})
