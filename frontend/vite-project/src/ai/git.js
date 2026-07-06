const GIT_COMMIT_PROMPT = `You are a commit message generator. Given a git diff, write a concise, conventional commit message.

Rules:
- Output ONLY the commit message, no other text.
- Use conventional commits format: type(scope): subject
- Types: feat, fix, refactor, test, docs, chore, style, perf
- Subject line: max 72 chars, lowercase, no period at end
- Add a body bullet list for multi-file changes if needed`

const GIT_REVIEW_PROMPT = `You are a senior code reviewer. Given a git diff, provide a focused review.

Rules:
- Start with a one-line overall assessment (LGTM / Needs work / Critical issues).
- List issues by severity: critical, warning, suggestion.
- Focus on: logic errors, security, performance, naming, edge cases.
- Be specific: reference file names and line ranges.
- Suggest concrete fixes for each issue.`

const GIT_CONFLICT_PROMPT = `You are a merge conflict resolver. Given both sides of a merge conflict, recommend the best resolution.

Rules:
- Explain what each side changes and why they might conflict.
- Recommend a merged resolution that preserves both changes' intent.
- Output the resolved code wrapped in a markdown code block.`

const GIT_PR_PROMPT = `You are a PR description generator. Given branch diff information, write a well-structured PR description.

Sections:
1. Summary (1-2 sentences)
2. Changes (bullet list of key changes)
3. Testing (how to test these changes)
4. Notes (any important context or caveats)`

export const GIT_TOOLS = {
  generateCommitMessage: {
    id: "git-commit",
    name: "Generate Commit Message",
    prompt: GIT_COMMIT_PROMPT,
  },
  reviewChanges: {
    id: "git-review",
    name: "Review Changes",
    prompt: GIT_REVIEW_PROMPT,
  },
  resolveConflict: {
    id: "git-conflict",
    name: "Resolve Conflict",
    prompt: GIT_CONFLICT_PROMPT,
  },
  generatePR: {
    id: "git-pr",
    name: "Generate PR Description",
    prompt: GIT_PR_PROMPT,
  },
}

export async function generateCommitMessage(diff, model, callAi) {
  const response = await callAi({
    model,
    messages: [
      { role: "system", content: GIT_COMMIT_PROMPT },
      { role: "user", content: `Generate a commit message for this diff:\n\n${diff.slice(0, 5000)}` },
    ],
    stream: false,
  })
  return response.trim()
}

export async function reviewChanges(diff, model, callAi) {
  const response = await callAi({
    model,
    messages: [
      { role: "system", content: GIT_REVIEW_PROMPT },
      { role: "user", content: `Review these changes:\n\n${diff.slice(0, 8000)}` },
    ],
    stream: false,
  })
  return response
}

export async function resolveConflict(ours, theirs, base, model, callAi) {
  const response = await callAi({
    model,
    messages: [
      { role: "system", content: GIT_CONFLICT_PROMPT },
      {
        role: "user",
        content: `Base:\n\`\`\`\n${(base || "").slice(0, 1500)}\n\`\`\`\n\nOurs:\n\`\`\`\n${ours.slice(0, 3000)}\n\`\`\`\n\nTheirs:\n\`\`\`\n${theirs.slice(0, 3000)}\n\`\`\``,
      },
    ],
    stream: false,
  })

  const match = response.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  return { resolution: match ? match[1].trim() : response, explanation: response }
}

export async function generatePRDescription(diff, branchInfo, model, callAi) {
  const branch = branchInfo?.current || "current"
  const target = branchInfo?.target || "main"

  const response = await callAi({
    model,
    messages: [
      { role: "system", content: GIT_PR_PROMPT },
      {
        role: "user",
        content: `Generate a PR description for merging ${branch} into ${target}:\n\nDiff:\n${diff.slice(0, 6000)}`,
      },
    ],
    stream: false,
  })
  return response
}