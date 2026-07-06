export interface TaskTemplate {
  id: string
  icon: string
  title: string
  description: string
  prompt: string
  category: "quality" | "refactor" | "docs"
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "add-tests",
    icon: "⚗",
    title: "Add Unit Tests",
    description: "Generate comprehensive test cases for the selected module or file.",
    prompt: "Analyze the code and add comprehensive unit tests. Cover edge cases, error handling, and happy paths. Use the project's existing test framework. Create test files if they don't exist.",
    category: "quality",
  },
  {
    id: "add-typescript-types",
    icon: "⭐",
    title: "Add TypeScript Types",
    description: "Add or improve TypeScript type definitions and interfaces.",
    prompt: "Review the code and add proper TypeScript type annotations. Add interfaces, type aliases, and fix any type issues. Ensure strict mode compatibility.",
    category: "refactor",
  },
  {
    id: "add-error-handling",
    icon: "⚠",
    title: "Add Error Handling",
    description: "Add proper error handling, try-catch blocks, and error boundaries.",
    prompt: "Review the code for potential error sources. Add proper try-catch blocks, error boundaries, meaningful error messages, and error logging. Handle edge cases gracefully.",
    category: "quality",
  },
  {
    id: "refactor-to-async",
    icon: "↻",
    title: "Refactor to Async/Await",
    description: "Convert callback or .then() chains to async/await.",
    prompt: "Find all callback-based or .then() chain patterns and convert them to async/await. Ensure proper error handling with try-catch.",
    category: "refactor",
  },
  {
    id: "optimize-performance",
    icon: "⚡",
    title: "Optimize Performance",
    description: "Analyze and optimize performance bottlenecks.",
    prompt: "Analyze the code for performance bottlenecks: unnecessary re-renders, memory leaks, inefficient loops, redundant API calls. Apply optimizations with explanations.",
    category: "quality",
  },
  {
    id: "add-documentation",
    icon: "📝",
    title: "Add Documentation",
    description: "Generate JSDoc/docstring comments for the code.",
    prompt: "Analyze all public functions, classes, and interfaces. Add JSDoc/docstring documentation with parameter types, return values, and usage examples.",
    category: "docs",
  },
  {
    id: "fix-lint-errors",
    icon: "✔",
    title: "Fix Lint Errors",
    description: "Auto-fix ESLint, Prettier, and other lint violations.",
    prompt: "Read the project's lint configuration. Fix all lint violations in the current file. Keep the logic unchanged while fixing style issues.",
    category: "quality",
  },
  {
    id: "extract-function",
    icon: "✂",
    title: "Extract Function",
    description: "Extract selected code into a reusable function.",
    prompt: "Extract the selected code block into a well-named, reusable function. Determine the correct parameters, return type, and placement (same file or new module). Update all call sites.",
    category: "refactor",
  },
]
