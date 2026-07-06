import { chatSync } from "../ai/llmClient"
import { getActiveProvider } from "../ai/aiProviders"

const PLANNER_SYSTEM_PROMPT = `You are a task planner for a coding agent. Given a user goal, break it down into an ordered list of concrete, actionable steps.

Rules:
- Each step must be one specific task the agent can perform (read, edit, write, search, run).
- Steps must be sequential - each step builds on previous ones.
- Output ONLY a JSON array of step objects. No other text.
- Each step object: { "description": "short step name", "instruction": "detailed instruction for the agent" }`

export async function generatePlan(goal, model) {
  try {
    const response = await chatSync({
      provider: getActiveProvider(),
      model,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: `Generate a step-by-step plan for: ${goal}` },
      ],
      stream: false,
    })

    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const steps = JSON.parse(jsonMatch[0])
      if (Array.isArray(steps) && steps.length > 0) return steps
    }
    throw new Error("Could not parse plan")
  } catch {
    return fallbackPlan(goal)
  }
}

function fallbackPlan(goal) {
  const goalLower = goal.toLowerCase()

  if (goalLower.includes("test") || goalLower.includes("测试") || goalLower.includes("spec")) {
    return [
      { description: "Analyze source files", instruction: "Read the main source files to understand the code structure and identify functions that need tests." },
      { description: "Identify test framework", instruction: "Check package.json or project config to determine the test framework being used." },
      { description: "Write tests", instruction: "Create or update test files with comprehensive test cases covering the main functions." },
      { description: "Run tests", instruction: "Run the test suite and verify all tests pass." },
      { description: "Fix failures", instruction: "If any tests fail, analyze the failures and fix either the tests or the source code as needed." },
    ]
  }

  if (goalLower.includes("refactor") || goalLower.includes("重构") || goalLower.includes("typescript")) {
    return [
      { description: "Survey codebase", instruction: "Read the project structure and identify all files that need refactoring." },
      { description: "Create migration plan", instruction: "List files in order of refactoring priority: no-dependency files first, then dependent files." },
      { description: "Refactor core types", instruction: "Convert type definitions, interfaces, and enums first." },
      { description: "Refactor utility functions", instruction: "Convert helper and utility modules." },
      { description: "Refactor main modules", instruction: "Convert the main application modules, updating imports accordingly." },
      { description: "Verify", instruction: "Run build and tests to verify the refactoring was correct." },
    ]
  }

  if (goalLower.includes("error") || goalLower.includes("错误处理") || goalLower.includes("exception")) {
    return [
      { description: "Identify error-prone code", instruction: "Search for try-catch blocks, error callbacks, and unhandled promises in the codebase." },
      { description: "Add error boundaries", instruction: "Add try-catch blocks around critical operations and API calls." },
      { description: "Add error logging", instruction: "Add consistent error logging throughout the codebase." },
      { description: "Add user-facing messages", instruction: "Add user-friendly error messages for common failure scenarios." },
      { description: "Verify", instruction: "Run the application and verify error states are handled gracefully." },
    ]
  }

  return [
    { description: "Analyze", instruction: `Read and understand the codebase relevant to: ${goal}` },
    { description: "Implement", instruction: `Make the necessary code changes to accomplish: ${goal}` },
    { description: "Verify", instruction: "Run verification commands to ensure the changes work correctly." },
  ]
}