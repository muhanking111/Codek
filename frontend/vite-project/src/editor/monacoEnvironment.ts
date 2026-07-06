type MonacoWorkerLabel = "json" | "css" | "scss" | "less" | "html" | "typescript" | "javascript" | string

import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

const workerByLabel: Record<string, new () => Worker> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  typescript: TypeScriptWorker,
  javascript: TypeScriptWorker,
}

export function setupMonacoEnvironment(): void {
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: MonacoWorkerLabel) {
      const WorkerCtor = workerByLabel[label] || EditorWorker
      return new WorkerCtor()
    },
  }
}
