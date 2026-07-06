import { computed, ref, type Ref } from "vue"

interface EditorInsightsOptions {
  activeFile: Ref<string | null | undefined>
  getFileOutline: (path: string) => unknown[]
  getFileDiagnostics: (path: string) => unknown[]
  getProjectSymbols: (query: string) => unknown[]
  getSymbolReferences: (symbolName: string) => unknown[]
  setSelectedSymbol: (symbolName: string) => void
}

export function useEditorInsights(options: EditorInsightsOptions) {
  const problemsVisible = ref(false)
  const symbolQuery = ref("")
  const selectedSymbol = ref("")

  const currentOutline = computed(() => (options.activeFile.value ? options.getFileOutline(options.activeFile.value) : []))
  const currentDiagnostics = computed(() =>
    options.activeFile.value ? options.getFileDiagnostics(options.activeFile.value) : [],
  )
  const projectSymbolResults = computed(() => options.getProjectSymbols(symbolQuery.value))
  const currentReferences = computed(() => options.getSymbolReferences(selectedSymbol.value))

  function toggleProblemsPanel(): void {
    problemsVisible.value = !problemsVisible.value
  }

  function openProblemsPanel(): void {
    problemsVisible.value = true
  }

  function closeProblemsPanel(): void {
    problemsVisible.value = false
  }

  function updateSelectedSymbol(name: string): void {
    selectedSymbol.value = name || ""
    options.setSelectedSymbol(selectedSymbol.value)
  }

  function clearSelectedSymbol(): void {
    updateSelectedSymbol("")
  }

  return {
    problemsVisible,
    symbolQuery,
    selectedSymbol,
    currentOutline,
    currentDiagnostics,
    projectSymbolResults,
    currentReferences,
    toggleProblemsPanel,
    openProblemsPanel,
    closeProblemsPanel,
    updateSelectedSymbol,
    clearSelectedSymbol,
  }
}
