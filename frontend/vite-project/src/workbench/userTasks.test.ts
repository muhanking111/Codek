import { describe, expect, it } from "vitest"
import { resolveProblemMatchers } from "./problemMatcher"
import { TASK_CONFIG_STATE_SOURCE, UserTasksService } from "./userTasks"

describe("UserTasksService", () => {
  it("projects workspace and profile tasks through one service contract", async () => {
    const service = new UserTasksService()
    const workspaceAdded = await service.loadWorkspaceTasks(async (path) => {
      if (path !== ".vscode/tasks.json") return null
      return JSON.stringify({
        version: "2.0.0",
        tasks: [{ label: "build", type: "npm", script: "build" }],
      })
    })
    const profileAdded = service.loadProfileTasks(JSON.stringify({
      tasks: JSON.stringify({
        version: "2.0.0",
        tasks: [{ label: "profile lint", command: "npm", args: ["run", "lint"] }],
      }),
    }))

    expect(workspaceAdded).toBe(1)
    expect(profileAdded).toBe(1)
    expect(service.getTasks().map((task) => [task.id, task.source, task.command])).toEqual([
      ["task-build", "workspace", "npm run build"],
      ["profile-task-profile-lint", "profile", "npm run lint"],
    ])
    expect(service.getContractSnapshot()).toMatchObject({
      source: "userTasksService",
      serviceId: "userTasksService",
      vscodeServiceIds: ["ITaskService", "TaskConfiguration", "TaskDefinitionRegistry", "ProblemMatcherRegistry", "IUserDataProfileService"],
      stateSource: TASK_CONFIG_STATE_SOURCE,
      activeTaskId: "task-build",
      counts: { workspace: 1, profile: 1, total: 2 },
      constraints: {
        noSecondTaskState: true,
        evidenceSafeActions: true,
        preservesAgentEvidenceSafety: true,
      },
      migrationAudit: {
        stateSource: TASK_CONFIG_STATE_SOURCE,
        runtimeTaskSources: ["workspace", "profile", "extensionProvider"],
        taskConfigurationSources: [
          expect.objectContaining({
            source: "workspace",
            currentOwner: "UserTasksService.loadWorkspaceTasks",
            vscodeOwner: "TaskConfiguration(workspace .vscode/tasks.json)",
            inputKind: ".vscode/tasks.json",
            runtimeInput: true,
          }),
          expect.objectContaining({
            source: "profile",
            currentOwner: "UserTasksService.loadProfileTasks",
            vscodeOwner: "IUserDataProfileService.currentProfile.tasksResource",
            inputKind: "profile.tasksResource",
            runtimeInput: true,
          }),
          expect.objectContaining({
            source: "extensionProvider",
            currentOwner: "UserTasksService.replaceExtensionProviderTasks",
            vscodeOwner: "MainThreadTask/ExtHostTask provider projection",
            inputKind: "extension-provider-task",
            runtimeInput: true,
          }),
        ],
        debugRunConfigsUsage: "debug-only",
        debugRunConfigsInput: false,
        taskRunConfigFallback: false,
        configurationResolverOwner: "configurationResolverService/inputAndVariableResolution",
        userTasksOwner: "UserTasksService",
        problemMatcherOwner: "ProblemMatcherRegistry",
        problemMatcherRegistrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource",
        blockers: [],
      },
    })
  })

  it("records evidence-safe task actions without shell execution or git index mutation", () => {
    const service = new UserTasksService()
    service.replaceTasks("workspace", [{
      id: "task-build",
      name: "Task: build",
      type: "custom",
      command: "npm run build",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    }])

    const action = service.createTaskAction("task-build", "run")

    expect(action).toMatchObject({
      id: "user-task-action-task-build-run",
      taskId: "task-build",
      command: "npm run build",
      source: "userTasksService",
      evidenceSafe: true,
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
    })
  })

  it("keeps task configuration independent from Debug run configuration state", () => {
    const service = new UserTasksService()
    service.replaceTasks("workspace", [{
      id: "task-test",
      name: "Task: test",
      type: "custom",
      command: "npm test",
      workingDir: "${workspaceFolder}",
    }])

    const tasks = service.getTasks()
    tasks.splice(0, tasks.length)

    expect(service.getTasks()).toEqual([
      expect.objectContaining({
        id: "task-test",
        source: "workspace",
        command: "npm test",
      }),
    ])
    expect(service.getContractSnapshot()).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      counts: { workspace: 1, profile: 0, extensionProvider: 0, total: 1 },
      constraints: expect.objectContaining({ noSecondTaskState: true }),
    }))
  })

  it("projects VS Code TaskDefinition, TaskExecution, and ConfigurationProperties from one task model", () => {
    const service = new UserTasksService()
    service.replaceTasks("workspace", [{
      id: "task-watch-build",
      name: "Task: watch build",
      type: "custom",
      command: "tsc --watch",
      workingDir: "${workspaceFolder}/app",
      source: "workspace",
      group: "build",
      dependsOn: ["clean"],
      dependsOrder: "sequence",
      isBackground: true,
      problemMatchers: resolveProblemMatchers("$tsc", "${workspaceFolder}/app"),
      env: { NODE_ENV: "development" },
      inputs: { target: "web" },
    }])

    const [task] = service.getTaskDefinitions()
    expect(task).toMatchObject({
      id: "task-watch-build",
      label: "Task: watch build",
      source: "workspace",
      definition: {
        type: "custom",
        id: "task-watch-build",
        label: "Task: watch build",
        _key: "custom:task-watch-build",
      },
      execution: {
        id: "task-watch-build",
        taskId: "task-watch-build",
        taskName: "Task: watch build",
        runType: "background",
        command: "tsc --watch",
        workingDir: "${workspaceFolder}/app",
      },
      configurationProperties: {
        identifier: "task-watch-build",
        name: "Task: watch build",
        group: "build",
        dependsOn: ["clean"],
        dependsOrder: "sequence",
        isBackground: true,
        problemMatcherIds: ["$tsc"],
      },
    })
    expect(task.problemMatcherRegistry).toEqual({
      source: "ProblemMatcherRegistry",
      matcherIds: ["$tsc"],
      matcherCount: 1,
      singleSource: true,
      vscodeOwner: "ProblemMatcherRegistry",
      currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
      registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
    })
    expect(service.getContractSnapshot()).toMatchObject({
      taskDefinitions: [expect.objectContaining({
        id: "task-watch-build",
        configurationProperties: expect.objectContaining({
          problemMatcherIds: ["$tsc"],
        }),
      })],
      problemMatcherRegistry: {
        source: "ProblemMatcherRegistry",
        matcherIds: ["$tsc"],
        matcherCount: 1,
        singleSource: true,
        vscodeOwner: "ProblemMatcherRegistry",
        currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
        registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
      },
      constraints: expect.objectContaining({
        noRunConfigShapeLeak: true,
        problemMatcherRegistrySingleSource: true,
      }),
      migrationAudit: {
        stateSource: TASK_CONFIG_STATE_SOURCE,
        runtimeTaskSources: ["workspace", "profile", "extensionProvider"],
        taskConfigurationSources: [
          {
            source: "workspace",
            currentOwner: "UserTasksService.loadWorkspaceTasks",
            vscodeOwner: "TaskConfiguration(workspace .vscode/tasks.json)",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts",
            inputKind: ".vscode/tasks.json",
            runtimeInput: true,
          },
          {
            source: "profile",
            currentOwner: "UserTasksService.loadProfileTasks",
            vscodeOwner: "IUserDataProfileService.currentProfile.tasksResource",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts",
            inputKind: "profile.tasksResource",
            runtimeInput: true,
          },
          {
            source: "extensionProvider",
            currentOwner: "UserTasksService.replaceExtensionProviderTasks",
            vscodeOwner: "MainThreadTask/ExtHostTask provider projection",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
            inputKind: "extension-provider-task",
            runtimeInput: true,
          },
        ],
        debugRunConfigsUsage: "debug-only",
        debugRunConfigsInput: false,
        taskRunConfigFallback: false,
        configurationResolverOwner: "configurationResolverService/inputAndVariableResolution",
        userTasksOwner: "UserTasksService",
        problemMatcherOwner: "ProblemMatcherRegistry",
        problemMatcherRegistrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource",
        currentSourcePaths: [
          "frontend/vite-project/src/workbench/userTasks.ts",
          "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          "frontend/vite-project/src/workbench/taskRunner.ts",
          "frontend/vite-project/src/workbench/taskDiscovery.ts",
          "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        ],
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
          "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts",
          "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
          "src/vs/workbench/contrib/tasks/common/taskService.ts",
          "src/vs/workbench/services/configurationResolver/common/configurationResolver.ts",
          "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts",
        ],
        blockers: [],
      },
    })
  })

  it("projects extension provider tasks into the same task configuration and problem matcher source", () => {
    const service = new UserTasksService()
    service.replaceTasks("workspace", [{
      id: "task-build",
      name: "Task: build",
      type: "custom",
      command: "npm run build",
      workingDir: "${workspaceFolder}",
    }])

    const added = service.replaceExtensionProviderTasks([{
      _id: "npm:lint",
      name: "npm: lint",
      source: "npm",
      definition: { type: "npm", script: "lint" },
      execution: { process: "npm", args: ["run", "lint"] },
      problemMatchers: resolveProblemMatchers("$tsc"),
    }])

    expect(added).toBe(1)
    expect(service.getTasks().map((task) => [task.id, task.source, task.command])).toEqual([
      ["task-build", "workspace", "npm run build"],
      ["extension-provider-task-npm-lint", "extensionProvider", "npm run lint"],
    ])
    expect(service.getContractSnapshot()).toMatchObject({
      counts: {
        workspace: 1,
        profile: 0,
        extensionProvider: 1,
        total: 2,
      },
      providerBridge: {
        status: "partial",
        providerTaskCount: 1,
        stateSource: "userTasksService/extensionProviderProjection",
        rendererIpcConsumerConnected: false,
        terminalTaskSystemExecution: false,
      },
      taskDefinitions: [
        expect.objectContaining({ id: "task-build", source: "workspace" }),
        expect.objectContaining({
          id: "extension-provider-task-npm-lint",
          source: "extensionProvider",
          definition: expect.objectContaining({
            type: "npm",
            _key: "npm:extension-provider-task-npm-lint",
          }),
          configurationProperties: expect.objectContaining({
            problemMatcherIds: ["$tsc"],
          }),
        }),
      ],
      problemMatcherRegistry: {
        source: "ProblemMatcherRegistry",
        matcherIds: ["$tsc"],
        matcherCount: 1,
        singleSource: true,
        vscodeOwner: "ProblemMatcherRegistry",
        currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
        registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
      },
    })
  })

  it("preserves provider-backed background task identity for TerminalTaskSystem lifecycle linkage", () => {
    const service = new UserTasksService()
    service.replaceExtensionProviderTasks([{
      _id: "npm:watch",
      name: "npm: watch",
      source: "npm",
      definition: { type: "npm", script: "watch" },
      execution: { process: "npm", args: ["run", "watch"] },
      isBackground: true,
      problemMatchers: [{
        id: "$npm-watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }])

    expect(service.getTasks("extensionProvider")).toEqual([
      expect.objectContaining({
        id: "extension-provider-task-npm-watch",
        source: "extensionProvider",
        providerType: "npm",
        isBackground: true,
      }),
    ])
    expect(service.getTaskDefinitions("extensionProvider")[0]).toEqual(expect.objectContaining({
      execution: expect.objectContaining({
        runType: "background",
      }),
      configurationProperties: expect.objectContaining({
        isBackground: true,
        problemMatcherIds: ["$npm-watch"],
      }),
    }))
  })
})
