export type DiagnosisCategory =
  | "syntax_error"
  | "dependency_missing"
  | "type_error"
  | "runtime_error"
  | "build_failure"
  | "test_failure"
  | "permission_denied"
  | "network_error"
  | "unknown"

export interface Diagnosis {
  category: DiagnosisCategory
  confidence: number
  summary: string
  evidence: string
  suggestedActions: string[]
}

interface Rule {
  category: DiagnosisCategory
  pattern: RegExp
  summary: string
  actions: string[]
}

const RULES: Rule[] = [
  {
    category: "dependency_missing",
    pattern: /Cannot find module ['"]([^'"]+)['"]/i,
    summary: "Missing npm dependency",
    actions: ["Run `npm install <module>` to install the missing package", "Check if the import path is correct"],
  },
  {
    category: "dependency_missing",
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    summary: "Missing Python dependency",
    actions: ["Run `pip install <module>` to install it", "Activate the correct virtualenv"],
  },
  {
    category: "syntax_error",
    pattern: /SyntaxError: (.+)/,
    summary: "Source syntax error",
    actions: ["Open the offending file at the reported line", "Fix the syntax issue and re-run"],
  },
  {
    category: "type_error",
    pattern: /TS\d{4,5}:/,
    summary: "TypeScript type error",
    actions: ["Inspect the type at the reported location", "Adjust types or imports until `tsc --noEmit` is clean"],
  },
  {
    category: "type_error",
    pattern: /Type ['"][^'"]+['"] is not assignable to type/,
    summary: "Type assignment mismatch",
    actions: ["Narrow the value or update the target type"],
  },
  {
    category: "build_failure",
    pattern: /\b(?:vite|webpack|esbuild)\b.*(?:failed|error)/i,
    summary: "Bundler reported a build failure",
    actions: ["Read the bundler output", "Fix the underlying compile error and rebuild"],
  },
  {
    category: "test_failure",
    pattern: /(\d+)\s+failing|FAIL\s+/,
    summary: "Test suite has failing cases",
    actions: ["Re-run the failing tests with verbose output", "Fix implementation or update the assertion"],
  },
  {
    category: "permission_denied",
    pattern: /EACCES|permission denied/i,
    summary: "Filesystem or process permission denied",
    actions: ["Ensure the workspace path is writable", "Avoid running tools that need elevated privileges in sandbox"],
  },
  {
    category: "network_error",
    pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/,
    summary: "Network connectivity error",
    actions: ["Verify the target host is reachable", "Retry the request with backoff"],
  },
  {
    category: "runtime_error",
    pattern: /TypeError: (.+)/,
    summary: "JavaScript runtime TypeError",
    actions: ["Inspect the variable that is undefined/null at the reported line", "Add a guard before the access"],
  },
]

export function diagnoseError(errorText: string): Diagnosis {
  for (const rule of RULES) {
    const match = errorText.match(rule.pattern)
    if (match) {
      return {
        category: rule.category,
        confidence: 0.85,
        summary: rule.summary,
        evidence: match[0],
        suggestedActions: rule.actions.map((a) => a.replace(/<module>/, match[1] || "")),
      }
    }
  }

  return {
    category: "unknown",
    confidence: 0.2,
    summary: "Unable to categorise error from local rules",
    evidence: errorText.slice(0, 200),
    suggestedActions: ["Capture full stack trace and re-run the failing step with more logging"],
  }
}

export function buildFixStrategy(diagnosis: Diagnosis): string {
  return [
    `Diagnosis: ${diagnosis.summary} (category=${diagnosis.category}, confidence=${diagnosis.confidence.toFixed(2)})`,
    `Evidence: ${diagnosis.evidence}`,
    `Suggested actions:`,
    ...diagnosis.suggestedActions.map((a, i) => `  ${i + 1}. ${a}`),
    "",
    "Please attempt the highest-confidence fix first, then re-verify.",
  ].join("\n")
}

export interface RetryPlan {
  shouldRetry: boolean
  guidance: string
  maxAttempts: number
}

export function planRetry(diagnosis: Diagnosis, previousAttempts: number): RetryPlan {
  if (diagnosis.category === "unknown" && previousAttempts >= 1) {
    return { shouldRetry: false, guidance: "Unknown error already retried; escalate to user", maxAttempts: 0 }
  }

  const retryable: DiagnosisCategory[] = [
    "dependency_missing",
    "test_failure",
    "build_failure",
    "type_error",
    "network_error",
  ]

  if (!retryable.includes(diagnosis.category)) {
    return { shouldRetry: false, guidance: "Error class is not safely retryable", maxAttempts: 0 }
  }

  if (previousAttempts >= 3) {
    return { shouldRetry: false, guidance: "Retry budget exhausted (3 attempts)", maxAttempts: 3 }
  }

  return {
    shouldRetry: true,
    guidance: buildFixStrategy(diagnosis),
    maxAttempts: 3,
  }
}
