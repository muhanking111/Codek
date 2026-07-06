const fs = require("fs")
const path = require("path")

async function readJsonSafe(filePath) {
  try {
    const buf = await fs.promises.readFile(filePath, "utf8")
    return { success: true, data: JSON.parse(buf) }
  } catch (err) {
    if (err.code === "ENOENT") return { success: true, data: null }
    return { success: false, error: err.message, data: null }
  }
}

async function readTextSafe(filePath) {
  try {
    return { success: true, content: await fs.promises.readFile(filePath, "utf8") }
  } catch (err) {
    if (err.code === "ENOENT") return { success: true, content: "" }
    return { success: false, error: err.message, content: "" }
  }
}

async function loadCodekRules(projectRoot) {
  if (!projectRoot) return { success: false, error: "projectRoot required", content: "" }
  return readTextSafe(path.join(projectRoot, ".codekrules"))
}

async function saveCodekRules(projectRoot, content) {
  if (!projectRoot) return { success: false, error: "projectRoot required" }
  try {
    await fs.promises.writeFile(path.join(projectRoot, ".codekrules"), content || "", "utf8")
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function loadTasks(projectRoot) {
  if (!projectRoot) return { success: false, error: "projectRoot required", tasks: [] }
  const candidates = [
    path.join(projectRoot, ".vscode", "tasks.json"),
    path.join(projectRoot, ".codek", "tasks.json"),
  ]
  for (const filePath of candidates) {
    const result = await readJsonSafe(filePath)
    if (result.data && Array.isArray(result.data.tasks)) {
      const tasks = result.data.tasks
        .filter((t) => t && typeof t.label === "string")
        .map((t) => ({
          label: t.label,
          type: t.type || "shell",
          command: t.command || "",
          args: Array.isArray(t.args) ? t.args : [],
          cwd: t.options?.cwd || "",
          group: t.group || null,
          source: filePath,
        }))
      return { success: true, tasks, source: filePath }
    }
  }
  return { success: true, tasks: [], source: null }
}

function register(router) {
  router.register("POST", "/workspace/codekrules/load", async ({ body }) => loadCodekRules(body.projectRoot))
  router.register("POST", "/workspace/codekrules/save", async ({ body }) => saveCodekRules(body.projectRoot, body.content))
  router.register("POST", "/workspace/tasks/load", async ({ body }) => loadTasks(body.projectRoot))
}

module.exports = { register, loadCodekRules, saveCodekRules, loadTasks }
