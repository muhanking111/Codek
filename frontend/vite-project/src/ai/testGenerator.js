const TEST_SYSTEM_PROMPT = `You are a test generation expert. Given source code, you generate high-quality unit tests.

Rules:
- Output ONLY the test code wrapped in a single markdown code block with language tag.
- Use the project's existing test framework (Jest, Vitest, pytest, go test, etc.).
- Cover edge cases, error paths, and happy paths.
- Focus on meaningful assertions - don't just test for existence.
- Mock external dependencies appropriately.
- Keep tests readable and maintainable.`

const TEST_FIX_PROMPT = `You are a test debugging expert. Given failing test output and the test code, fix the test.

Rules:
- Output ONLY the fixed test code wrapped in a single markdown code block.
- Do not change the test's intent or weaken assertions.
- Fix root causes: wrong mocks, wrong assertions, race conditions, missing setup.
- Explain the fix briefly before the code block.`

export async function generateTests(sourceCode, filePath, model, callAi) {
  const messages = [
    { role: "system", content: TEST_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Generate unit tests for this file:\nPath: ${filePath}\n\n\`\`\`\n${sourceCode.slice(0, 6000)}\n\`\`\``,
    },
  ]

  const response = await callAi({ model, messages, stream: false })
  return extractCodeBlock(response)
}

export async function fixFailingTests(testCode, testOutput, model, callAi) {
  const messages = [
    { role: "system", content: TEST_FIX_PROMPT },
    {
      role: "user",
      content: `Fix these failing tests:\n\nTest Code:\n\`\`\`\n${testCode.slice(0, 4000)}\n\`\`\`\n\nTest Output:\n\`\`\`\n${testOutput.slice(0, 2000)}\n\`\`\``,
    },
  ]

  const response = await callAi({ model, messages, stream: false })
  return extractCodeBlock(response)
}

function extractCodeBlock(response) {
  const match = response.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : response.trim()
}