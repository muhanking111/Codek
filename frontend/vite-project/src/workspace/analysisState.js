import { reactive } from "vue"

import { normalizeRelativePath } from "./manager"
import {
  getAnalysisBackedFileOutline,
  getAnalysisBackedProjectSymbols,
  getAnalysisBackedSymbolReferences,
  registerDefaultAnalysisSymbolProvider,
  registerSymbolNavigationQuickAccessProvider,
  setAnalysisBackedSelectedSymbol,
} from "../workbench/symbolNavigationService"

export const analysisCache = new Map()

export const analysisState = reactive({
  files: {},
  projectSymbols: [],
  projectReferences: {},
  symbolQuery: "",
  selectedSymbol: "",
  activeFile: null,
})

export function getFileAnalysis(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  return relativePath ? analysisState.files[relativePath] || null : null
}

function getRawFileOutline(pathValue) {
  return getFileAnalysis(pathValue)?.symbols || []
}

export function getFileDiagnostics(pathValue) {
  return getFileAnalysis(pathValue)?.diagnostics || []
}

function getRawProjectSymbols(query = "") {
  const normalized = String(query || "").trim().toLowerCase()
  if (!normalized) return analysisState.projectSymbols.slice(0, 80)

  return analysisState.projectSymbols.filter((symbol) => {
    return (
      symbol.name.toLowerCase().includes(normalized) ||
      symbol.path.toLowerCase().includes(normalized) ||
      symbol.kind.toLowerCase().includes(normalized)
    )
  }).slice(0, 80)
}

function getRawSymbolReferences(symbolName) {
  const entry = analysisState.projectReferences[symbolName]
  if (!entry) return { total: 0, files: [] }

  return {
    total: entry.total,
    files: [...entry.files].sort((left, right) => right.count - left.count),
  }
}

function setRawSelectedSymbol(symbolName) {
  analysisState.selectedSymbol = symbolName || ""
}

registerDefaultAnalysisSymbolProvider({
  getFileOutline: getRawFileOutline,
  getWorkspaceSymbols: getRawProjectSymbols,
  getSymbolReferences: getRawSymbolReferences,
  setSelectedSymbol: setRawSelectedSymbol,
})
registerSymbolNavigationQuickAccessProvider()

export function getFileOutline(pathValue) {
  return getAnalysisBackedFileOutline(pathValue)
}

export function getProjectSymbols(query = "") {
  return getAnalysisBackedProjectSymbols(query)
}

export function getSymbolReferences(symbolName) {
  return getAnalysisBackedSymbolReferences(symbolName)
}

export function setSelectedSymbol(symbolName) {
  setAnalysisBackedSelectedSymbol(symbolName)
}
