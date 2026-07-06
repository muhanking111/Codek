const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildAnthropicTools,
  buildOpenAITools,
  buildToolContext,
  getFilteredSchemas,
  normalizeToolNameFilter,
  structuredToolError,
} = require("./index")

test("normalizeToolNameFilter accepts arrays and comma-separated strings", () => {
  assert.deepEqual([...normalizeToolNameFilter(["read_file", "grep"])], ["read_file", "grep"])
  assert.deepEqual([...normalizeToolNameFilter("read_file, grep")], ["read_file", "grep"])
  assert.equal(normalizeToolNameFilter([]), null)
})

test("getFilteredSchemas only exposes requested tool names", () => {
  const schemas = getFilteredSchemas(["read_file", "grep"])
  assert.deepEqual(schemas.map((schema) => schema.name), ["read_file", "grep"])
})

test("provider tool builders honor toolNameFilter", () => {
  const anthropicNames = buildAnthropicTools(["read_file"]).map((tool) => tool.name)
  const openAiNames = buildOpenAITools(["read_file"]).map((tool) => tool.function.name)

  assert.deepEqual(anthropicNames, ["read_file"])
  assert.deepEqual(openAiNames, ["read_file"])
})

test("native agent schemas expose profile MCP tools for default agent loop", () => {
  const schemas = getFilteredSchemas(["mcp_list_tools", "mcp_call_tool"])

  assert.deepEqual(schemas.map((schema) => schema.name), ["mcp_list_tools", "mcp_call_tool"])
  assert.equal(schemas[0].autoAuthorize, true)
  assert.equal(schemas[1].flags.mutates, true)
  assert.equal(schemas[1].flags.network, true)
})

test("agent loop tool context preserves VS Code workspace file for MCP resource discovery", () => {
  const context = buildToolContext({
    projectRoot: "D:/workspace/app",
    workspaceFile: "D:/workspace/demo.code-workspace",
  }, { networkAccess: false })

  assert.equal(context.projectRoot, "D:/workspace/app")
  assert.equal(context.workspaceFile, "D:/workspace/demo.code-workspace")
  assert.equal(context.networkAccess, false)
})

test("agent loop preserves VS Code MCP missing input metadata in tool errors", () => {
  const error = new Error("MCP input required for fs: root")
  error.code = "MCP_INPUT_REQUIRED"
  error.missingInputs = [{ id: "root", password: false, default: "${workspaceFolder}" }]

  const result = structuredToolError(error, {
    parsedArguments: {
      serverName: "fs",
      toolName: "read_file",
    },
  })

  assert.equal(result.content, "MCP input required: root")
  assert.deepEqual(result.structured, {
    code: "MCP_INPUT_REQUIRED",
    serverName: "fs",
    toolName: "read_file",
    missingInputs: [{ id: "root", password: false, default: "${workspaceFolder}" }],
  })
})
