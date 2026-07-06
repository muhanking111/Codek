export function buildPlan(prompt, context) {
    return `
你是代码重构规划器。

任务：
将用户需求拆成步骤，每一步只做一个修改。

输出 JSON：

[
  {
    "step": 1,
    "action": "modify",
    "target": "file.js",
    "instruction": "..."
  }
]

需求：
${prompt}

上下文：
${context}
`
}