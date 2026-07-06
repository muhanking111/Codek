import { describe, expect, it } from "vitest"
import { createRunConfigResolverEvidence, resolveRunConfigVariables } from "./runConfigVariables"

describe("resolveRunConfigVariables", () => {
  it("expands VS Code style workspace and file variables", () => {
    const resolved = resolveRunConfigVariables({
      id: "cfg",
      name: "Node",
      type: "node",
      command: "node ${file} --name ${fileBasenameNoExtension}",
      workingDir: "${fileDirname}",
    }, {
      workspaceFolder: "D:\\Workspace",
      activeFile: "src/main.ts",
    })

    expect(resolved.command).toBe("node D:/Workspace/src/main.ts --name main")
    expect(resolved.workingDir).toBe("D:/Workspace/src")
  })

  it("keeps absolute active file paths absolute", () => {
    const resolved = resolveRunConfigVariables({
      id: "cfg",
      name: "Python",
      type: "python",
      command: "python ${fileBasename}",
      workingDir: "${workspaceFolder}",
    }, {
      workspaceFolder: "D:/Workspace",
      activeFile: "C:\\tmp\\worker.py",
    })

    expect(resolved.command).toBe("python worker.py")
    expect(resolved.workingDir).toBe("D:/Workspace")
  })

  it("expands VS Code task input variables from discovered defaults", () => {
    const resolved = resolveRunConfigVariables({
      id: "task-build",
      name: "Task: build",
      type: "custom",
      command: "npm run build -- --target ${input:target}",
      workingDir: "${workspaceFolder}",
      inputs: { target: "desktop" },
    }, {
      workspaceFolder: "D:/Workspace",
      activeFile: "src/main.ts",
      inputs: { target: "desktop" },
    })

    expect(resolved.command).toBe("npm run build -- --target desktop")
  })

  it("expands relative file and environment variables in command, cwd, and env", () => {
    const resolved = resolveRunConfigVariables({
      id: "cfg-env",
      name: "Node env",
      type: "node",
      command: "node ${relativeFile} --home ${env:CODEK_HOME}",
      workingDir: "${workspaceFolder}/${relativeFileDirname}",
      env: {
        NODE_ENV: "test",
        CODEK_BIN: "${env:CODEK_HOME}/bin",
      },
    }, {
      workspaceFolder: "D:/Workspace",
      activeFile: "D:/Workspace/src/main.ts",
      env: { CODEK_HOME: "D:/Workspace/.codek" },
    })

    expect(resolved.command).toBe("node src/main.ts --home D:/Workspace/.codek")
    expect(resolved.workingDir).toBe("D:/Workspace/src")
    expect(resolved.env).toEqual({
      NODE_ENV: "test",
      CODEK_BIN: "D:/Workspace/.codek/bin",
    })
  })

  it("returns VS Code-style configuration resolver evidence without leaking env values", () => {
    const evidence = createRunConfigResolverEvidence({
      id: "cfg-env",
      name: "Node env",
      type: "node",
      command: "node ${file} --home ${env:CODEK_HOME} --secret ${input:secret}",
      workingDir: "${workspaceFolder}",
      env: {
        CODEK_BIN: "${env:CODEK_HOME}/bin",
      },
    }, {
      workspaceFolder: "D:/Workspace",
      activeFile: "src/main.ts",
      env: { CODEK_HOME: "D:/Workspace/.codek" },
      inputs: { secret: "raw-secret-value" },
    })

    expect(evidence).toEqual({
      source: "configurationResolverService",
      vscodeServiceId: "IConfigurationResolverService",
      stateSource: "runConfigVariables",
      configId: "cfg-env",
      configName: "Node env",
      configType: "node",
      variableKinds: ["env", "file", "input", "workspaceFolder"],
      resolved: {
        commandLength: "node D:/Workspace/src/main.ts --home D:/Workspace/.codek --secret raw-secret-value".length,
        workingDir: "D:/Workspace",
        envKeys: ["CODEK_BIN"],
      },
      constraints: {
        noSecondRunConfigState: true,
        redactsVariableValues: true,
        vscodeStyleVariableResolution: true,
      },
    })
    expect(JSON.stringify(evidence)).not.toContain("raw-secret-value")
    expect(JSON.stringify(evidence)).not.toContain("D:/Workspace/.codek/bin")
  })
})
