import { describe, expect, it } from "vitest"
import {
  discoverRunConfigsFromFiles,
  parseLaunchConfigs,
  parseCargoProject,
  parseGoProject,
  parseGradleProject,
  parseMavenProject,
  parsePackageScripts,
  parsePythonProject,
  parseVsCodeProfileTasksResource,
  parseVsCodeTasks,
} from "./taskDiscovery"

describe("taskDiscovery", () => {
  it("parses VS Code npm and shell tasks into run configs", () => {
    const configs = parseVsCodeTasks(JSON.stringify({
      version: "2.0.0",
      tasks: [
        {
          label: "build",
          type: "npm",
          script: "build",
          options: { cwd: "${workspaceFolder}/frontend" },
        },
        {
          label: "run worker",
          type: "shell",
          command: "node",
          args: ["scripts/worker.js", "--once"],
        },
      ],
    }))

    expect(configs).toEqual([
      {
        id: "task-build",
        name: "Task: build",
        type: "custom",
        command: "npm run build",
        workingDir: "${workspaceFolder}/frontend",
        source: "workspace",
      },
      {
        id: "task-run-worker",
        name: "Task: run worker",
        type: "custom",
        command: "node scripts/worker.js --once",
        workingDir: "${workspaceFolder}",
        source: "workspace",
      },
    ])
  })

  it("preserves VS Code task metadata and resolves problem matchers", () => {
    const configs = parseVsCodeTasks(JSON.stringify({
      version: "2.0.0",
      tasks: [
        {
          label: "watch build",
          type: "shell",
          command: "tsc",
          args: ["--watch"],
          group: { kind: "build", isDefault: true },
          dependsOn: ["clean"],
          isBackground: true,
          dependsOrder: "sequence",
          problemMatcher: "$tsc",
          options: {
            cwd: "${workspaceFolder}/app",
            env: { NODE_ENV: "development" },
          },
        },
      ],
    }))

    expect(configs[0]).toMatchObject({
      id: "task-watch-build",
      command: "tsc --watch",
      workingDir: "${workspaceFolder}/app",
      group: "build",
      dependsOn: ["clean"],
      dependsOrder: "sequence",
      isBackground: true,
      env: { NODE_ENV: "development" },
    })
    expect(configs[0].problemMatchers?.[0]).toMatchObject({
      source: "TypeScript",
      filePrefix: "${workspaceFolder}/app",
    })
  })

  it("parses VS Code task inputs as default values for input variables", () => {
    const configs = parseVsCodeTasks(JSON.stringify({
      version: "2.0.0",
      inputs: [
        { id: "target", type: "promptString", default: "web" },
      ],
      tasks: [
        {
          label: "build target",
          type: "shell",
          command: "npm run build -- --target ${input:target}",
        },
      ],
    }))

    expect(configs[0]).toMatchObject({
      command: "npm run build -- --target ${input:target}",
      inputs: { target: "web" },
    })
  })

  it("parses VS Code profile tasks resources into run configs", () => {
    const configs = parseVsCodeProfileTasksResource(JSON.stringify({
      tasks: JSON.stringify({
        version: "2.0.0",
        tasks: [
          {
            label: "profile build",
            type: "shell",
            command: "npm",
            args: ["run", "profile:build"],
          },
        ],
      }),
    }))

    expect(configs).toEqual([
      {
        id: "task-profile-build",
        name: "Task: profile build",
        type: "custom",
        command: "npm run profile:build",
        workingDir: "${workspaceFolder}",
        source: "workspace",
      },
    ])
  })

  it("parses VS Code launch configurations into runnable commands", () => {
    const configs = parseLaunchConfigs(JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          name: "API",
          type: "node",
          request: "launch",
          program: "${workspaceFolder}/server.js",
          args: ["--port", "3000"],
          cwd: "${workspaceFolder}/api",
        },
        {
          name: "Py Worker",
          type: "python",
          request: "launch",
          program: "worker.py",
        },
        {
          name: "Runtime",
          type: "node",
          runtimeExecutable: "npm",
          runtimeArgs: ["run", "dev"],
        },
      ],
    }))

    expect(configs.map((config) => [config.id, config.name, config.command, config.workingDir])).toEqual([
      ["launch-api", "Launch: API", "node ${workspaceFolder}/server.js --port 3000", "${workspaceFolder}/api"],
      ["launch-py-worker", "Launch: Py Worker", "python worker.py", "${workspaceFolder}"],
      ["launch-runtime", "Launch: Runtime", "npm run dev", "${workspaceFolder}"],
    ])
  })

  it("parses package scripts in stable name order", () => {
    const configs = parsePackageScripts(JSON.stringify({
      scripts: {
        test: "vitest run",
        build: "vite build",
      },
    }))

    expect(configs.map((config) => `${config.name}:${config.command}`)).toEqual([
      "npm: build:npm run build",
      "npm: test:npm run test",
    ])
  })

  it("uses pnpm and yarn lockfiles when discovering package scripts", async () => {
    const pnpmConfigs = await discoverRunConfigsFromFiles(async (path) => {
      if (path === "package.json") return JSON.stringify({ scripts: { build: "vite build" } })
      if (path === "pnpm-lock.yaml") return "lockfileVersion: '9.0'"
      return null
    })

    expect(pnpmConfigs.find((config) => config.id === "pnpm-build")?.command).toBe("pnpm run build")

    const yarnConfigs = await discoverRunConfigsFromFiles(async (path) => {
      if (path === "package.json") return JSON.stringify({ scripts: { test: "vitest" } })
      if (path === "yarn.lock") return "# yarn lockfile"
      return null
    })

    expect(yarnConfigs.find((config) => config.id === "yarn-test")?.command).toBe("yarn test")
  })

  it("discovers Maven and Python project tasks", () => {
    expect(parseMavenProject("<project><modelVersion>4.0.0</modelVersion></project>").map((config) => config.command)).toEqual([
      "mvn test",
      "mvn package",
    ])

    expect(parsePythonProject("[tool.pytest.ini_options]\n[tool.ruff]\n").map((config) => `${config.name}:${config.command}`)).toEqual([
      "Python: test:python -m pytest",
      "Python: lint:ruff check .",
    ])
  })

  it("discovers Gradle, Cargo, and Go project tasks with problem matchers", () => {
    expect(parseGradleProject("plugins { id 'java' }\ndependencies {}").map((config) => config.command)).toEqual([
      "./gradlew test",
      "./gradlew build",
    ])
    expect(parseCargoProject("[package]\nname = \"demo\"").map((config) => config.command)).toEqual([
      "cargo test",
      "cargo build",
    ])
    expect(parseCargoProject("[package]\nname = \"demo\"")[0].problemMatchers?.[0].source).toBe("Rust")
    expect(parseGoProject("module example.com/demo\n\ngo 1.22").map((config) => config.command)).toEqual([
      "go test ./...",
      "go build ./...",
    ])
    expect(parseGoProject("module example.com/demo\n")[0].problemMatchers?.[0].source).toBe("Go")
  })

  it("discovers and deduplicates configs from workspace files", async () => {
    const files = new Map<string, string>([
      [".vscode/tasks.json", JSON.stringify({
        tasks: [
          { label: "build", type: "npm", script: "build" },
          { label: "lint", command: "npm", args: ["run", "lint"] },
        ],
      })],
      [".vscode/launch.json", JSON.stringify({
        configurations: [
          { name: "API", type: "node", program: "server.js" },
          { name: "build", type: "node", program: "build.js" },
        ],
      })],
      ["package.json", JSON.stringify({
        scripts: {
          build: "vite build",
          dev: "vite",
        },
      })],
      ["pnpm-lock.yaml", "lockfileVersion: '9.0'"],
      ["pom.xml", "<project></project>"],
      ["build.gradle", "plugins { id 'java' }"],
      ["pyproject.toml", "[tool.poetry]\n[tool.pytest.ini_options]\n[tool.ruff]\n"],
      ["Cargo.toml", "[package]\nname = \"demo\""],
      ["go.mod", "module example.com/demo\n"],
    ])

    const configs = await discoverRunConfigsFromFiles(async (path) => files.get(path) ?? null)

    expect(configs.map((config) => config.id)).toEqual([
      "task-build",
      "task-lint",
      "launch-api",
      "launch-build",
      "pnpm-build",
      "pnpm-dev",
      "maven-test",
      "maven-package",
      "gradle-test",
      "gradle-build",
      "python-test",
      "python-lint",
      "cargo-test",
      "cargo-build",
      "go-test",
      "go-build",
    ])
    expect(configs.find((config) => config.id === "pnpm-build")?.command).toBe("pnpm run build")
  })
})
