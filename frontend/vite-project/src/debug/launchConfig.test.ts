import { describe, expect, it } from "vitest"
import { buildDapLaunchConfig } from "./launchConfig"

describe("buildDapLaunchConfig", () => {
  it("maps node commands to VS Code js-debug launch shape", () => {
    expect(buildDapLaunchConfig({
      id: "node",
      name: "Node",
      type: "node",
      command: "node src/server.js --port 3000",
      workingDir: "D:/Workspace",
      env: { NODE_ENV: "test" },
    })).toEqual({
      type: "node",
      noDebug: false,
      cwd: "D:/Workspace",
      env: { NODE_ENV: "test" },
      runtimeExecutable: "node",
      program: "src/server.js",
      args: ["--port", "3000"],
    })
  })

  it("maps python commands to debugpy launch shape", () => {
    expect(buildDapLaunchConfig({
      id: "python",
      name: "Python",
      type: "python",
      command: "python worker.py --once",
      workingDir: "D:/Workspace",
    })).toEqual({
      type: "python",
      noDebug: false,
      cwd: "D:/Workspace",
      python: "python",
      program: "worker.py",
      args: ["--once"],
    })
  })

  it("keeps custom commands as program for custom adapters", () => {
    expect(buildDapLaunchConfig({
      id: "custom",
      name: "Custom",
      type: "custom",
      command: "custom-debug --stdio",
      workingDir: "${workspaceFolder}",
    })).toEqual({
      type: "custom",
      noDebug: false,
      cwd: "${workspaceFolder}",
      program: "custom-debug --stdio",
    })
  })
})
