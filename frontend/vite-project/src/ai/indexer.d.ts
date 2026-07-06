export interface BuildIndexOptions {
  maxFiles?: number
  useBackend?: boolean
  projectRoot?: string
  knownOnly?: boolean
}

export interface CodeIndexEntry {
  path: string
  name: string
  functions: string[]
  variables: string[]
  imports: string[]
  lineCount: number
  preview: string
  content: string
}

export declare function buildIndex(options?: BuildIndexOptions): Promise<CodeIndexEntry[]>
export declare const indexingProgress: {
  total: number
  done: number
  isIndexing: boolean
}
export interface BackgroundIndexOptions {
  knownOnly?: boolean
}

export declare function startBackgroundIndexing(projectRoot?: string, options?: BackgroundIndexOptions): Promise<void>
export declare function stopBackgroundIndexing(): void
