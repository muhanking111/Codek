import { getActiveModel, getModelLabel, modelSettings } from "./models"

function measureComplexity(code) {
  const text = String(code || "")
  if (!text.trim()) return 0

  let score = 0
  const branchRe = /\b(if|else|for|while|switch|case|try|catch|finally)\b/g
  const branchMatch = text.match(branchRe)
  if (branchMatch) score += branchMatch.length * 2

  const lines = text.split("\n")
  score += Math.floor(lines.length / 8)

  let maxIndent = 0
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)[1].length
    if (indent > maxIndent) maxIndent = indent
  }
  score += Math.floor(maxIndent / 4)

  return score
}

export function selectModel(prompt = "", code = "") {
  const text = String(prompt || "").toLowerCase()
  const complexity = measureComplexity(code)

  const useCloud = modelSettings.provider !== "ollama" && modelSettings.openaiApiKey

  if (complexity >= 24) {
    return {
      model: getActiveModel(),
      mode: "deep",
      complexity,
      tier: "complex",
    }
  }

  if (
    complexity >= 16 ||
    text.includes("复杂") ||
    text.includes("疑难") ||
    text.includes("重试") ||
    text.includes("修不好") ||
    (text.includes("bug") && text.includes("复杂")) ||
    text.includes("死锁") ||
    text.includes("并发")
  ) {
    return {
      model: getActiveModel(),
      mode: "deep",
      complexity,
      tier: useCloud ? "cloud" : "local",
    }
  }

  if (
    text.includes("检查") ||
    text.includes("规范") ||
    text.includes("review") ||
    text.includes("分析") ||
    text.includes("为什么") ||
    text.includes("问题") ||
    text.includes("哪里不对") ||
    text.includes("优化建议") ||
    text.includes("代码质量")
  ) {
    return {
      model: getActiveModel(),
      mode: "analyze",
      complexity,
      tier: useCloud ? "cloud" : "local",
    }
  }

  if (
    text.includes("方案") ||
    text.includes("设计") ||
    text.includes("思路") ||
    text.includes("架构") ||
    text.includes("规划") ||
    text.includes("怎么实现") ||
    text.includes("结构")
  ) {
    return {
      model: getActiveModel(),
      mode: "design",
      complexity,
      tier: useCloud ? "cloud" : "local",
    }
  }

  const simpleModel = useCloud
    ? (modelSettings.availableModels[0] || getActiveModel())
    : getActiveModel()

  return { model: simpleModel, mode: "code", complexity, tier: "simple" }
}

export function modelLabel(model) {
  return getModelLabel(model)
}

export function getProviderLabel() {
  const labels = { ollama: "Ollama", openai: "OpenAI", openaiCompat: "Custom API" }
  return labels[modelSettings.provider] || "Ollama"
}