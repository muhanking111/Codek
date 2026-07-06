import { chatSync } from "./llmClient"
import { getActiveProvider, getActiveModel } from "./aiProviders"
import { modelLabel, selectModel } from "./router"

const EDIT_SYSTEM_PROMPT = `你是一个代码编辑助手。你的任务是根据用户指令修改代码。
规则：
1. 只输出修改后的完整代码，不要解释，不要用 markdown 包裹
2. 严格保留原有代码风格和换行
3. 只修改指令要求的范围，不要改动无关代码
4. 如果指令不明确或无法完成，直接输出原始代码不变`

const REVIEW_SYSTEM_PROMPT = `你是一个代码审查助手。分析下面的代码，并根据用户指令指出问题。
输出格式：
1. 问题列表，每行一个
2. 修改建议，简明扼要

不要输出修改后的代码，只输出分析结果。`

const DESIGN_SYSTEM_PROMPT = `你是一个代码方案设计助手。根据用户需求，给出修改思路和方案。
输出要求：简明扼要，直接给出方案要点，不输出完整代码。`

function buildEditPrompt(selectedCode, instruction, analysis = "") {
  let prompt = `请根据以下指令修改这段代码：\n\n\`\`\`\n${selectedCode}\n\`\`\`\n\n指令：${instruction}`

  if (analysis) {
    prompt += `\n\n参考分析：\n${analysis}`
  }

  prompt += "\n\n修改后的代码："
  return prompt
}

function extractCode(text) {
  const content = String(text || "").trim()
  if (!content) return ""

  const codeBlockMatch = content.match(/```(?:\w*)\n([\s\S]*?)```/)
  if (codeBlockMatch) return codeBlockMatch[1].trim()

  return content.replace(/^['"]|['"]$/g, "")
}

async function callModel(model, messages) {
  const result = await chatSync({
    provider: getActiveProvider(),
    model,
    messages,
    stream: false,
  })
  return result || ""
}

export async function editCode(selectedCode, instruction, callbacks = {}) {
  if (!selectedCode || !instruction) return { code: selectedCode, model: "" }

  const route = selectModel(instruction, selectedCode)
  const model = route.model
  const onModel = callbacks.onModelChange || (() => {})

  if (route.mode === "deep") {
    onModel(modelLabel(model), "深度分析中...")
    const result = await callModel(model, [
      { role: "system", content: EDIT_SYSTEM_PROMPT },
      { role: "user", content: buildEditPrompt(selectedCode, instruction) },
    ])
    return { code: extractCode(result) || selectedCode, model: modelLabel(model) }
  }

  if (route.mode === "analyze") {
    onModel(modelLabel(model), "审查代码中...")
    const review = await callModel(model, [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: `代码：\n\`\`\`\n${selectedCode}\n\`\`\`\n\n指令：${instruction}` },
    ])
    if (callbacks.onReview) callbacks.onReview(review)

    onModel(modelLabel(model), "修改代码中...")
    const result = await callModel(model, [
      { role: "system", content: EDIT_SYSTEM_PROMPT },
      { role: "user", content: buildEditPrompt(selectedCode, instruction, review) },
    ])
    return { code: extractCode(result) || selectedCode, model: modelLabel(model), review }
  }

  if (route.mode === "design") {
    onModel(modelLabel(model), "设计方案中...")
    const design = await callModel(model, [
      { role: "system", content: DESIGN_SYSTEM_PROMPT },
      { role: "user", content: `代码：\n\`\`\`\n${selectedCode}\n\`\`\`\n\n需求：${instruction}` },
    ])
    if (callbacks.onReview) callbacks.onReview(design)

    onModel(modelLabel(model), "实现代码中...")
    const result = await callModel(model, [
      { role: "system", content: EDIT_SYSTEM_PROMPT },
      { role: "user", content: buildEditPrompt(selectedCode, instruction, design) },
    ])
    return { code: extractCode(result) || selectedCode, model: modelLabel(model), review: design }
  }

  onModel(modelLabel(model), "修改代码中...")
  const result = await callModel(model, [
    { role: "system", content: EDIT_SYSTEM_PROMPT },
    { role: "user", content: buildEditPrompt(selectedCode, instruction) },
  ])
  return { code: extractCode(result) || selectedCode, model: modelLabel(model) }
}
