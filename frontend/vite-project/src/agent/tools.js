// Compatibility shim: Vite resolves extensionless imports to .js before .ts.
// Keep legacy callers on the TypeScript tool registry instead of a stale copy.
import {
  buildToolContext,
  getAllTools,
  getTool as getTypeScriptTool,
  getToolNames,
  getToolsForMode,
} from "./tools.ts"

function toContext(projectRootOrContext) {
  if (projectRootOrContext && typeof projectRootOrContext === "object") {
    return projectRootOrContext
  }
  return buildToolContext(typeof projectRootOrContext === "string" ? projectRootOrContext : "")
}

function adaptTool(definition) {
  if (!definition) return undefined
  return {
    ...definition,
    arguments: definition.parameters || {},
    async execute(args = {}, projectRootOrContext = "") {
      return definition.execute(args, toContext(projectRootOrContext))
    },
  }
}

export const TOOL_DEFINITIONS = getAllTools().map(adaptTool)

export function getTool(name) {
  return adaptTool(getTypeScriptTool(name))
}

export { buildToolContext, getAllTools, getToolNames, getToolsForMode }
