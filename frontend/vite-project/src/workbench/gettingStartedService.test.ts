import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import {
  GETTING_STARTED_COMMAND_IDS,
  MenuId,
  MenuRegistry,
  clearGettingStartedProgress,
  getGettingStartedContributionSummary,
  getWelcomePageProjection,
  globalGettingStartedService,
  registerGettingStartedContributions,
  registerGettingStartedWalkthrough,
} from "./gettingStartedService"

describe("gettingStartedService", () => {
  beforeEach(() => {
    clearCommands()
    MenuRegistry.clear()
    globalGettingStartedService.clearWalkthroughs()
    clearGettingStartedProgress()
  })

  it("projects welcome start entries from a single service source with context filtering", () => {
    const projection = getWelcomePageProjection({ "workspace.hasRoot": false })

    expect(projection.primaryActions.map((action) => action.id)).toEqual([
      "openFolder",
      "newFile",
      "commandPalette",
      "openChat",
      "remote",
    ])
    expect(projection.startEntries.map((entry) => entry.commandId)).toEqual([
      GETTING_STARTED_COMMAND_IDS.OpenFolder,
      GETTING_STARTED_COMMAND_IDS.NewFile,
      GETTING_STARTED_COMMAND_IDS.CommandPalette,
      GETTING_STARTED_COMMAND_IDS.OpenChat,
      GETTING_STARTED_COMMAND_IDS.Remote,
    ])
    expect(projection.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codek.setup", totalSteps: 4, completedSteps: 0 }),
      expect.objectContaining({ id: "codek.agentEvidence", totalSteps: 3, completedSteps: 0 }),
    ]))
  })

  it("registers walkthroughs, evaluates category and step when clauses, and tracks completion events", () => {
    registerGettingStartedWalkthrough({
      id: "extension.sample",
      title: "Sample",
      description: "Extension sample walkthrough",
      source: "extension",
      when: "feature.sample",
      order: 50,
      steps: [
        {
          id: "extension.sample.hidden",
          title: "Hidden",
          description: "Hidden until context changes",
          when: "feature.hidden",
          completionEvents: ["onCommand:sample.hidden"],
          media: { type: "svg", path: "media/hidden.svg", altText: "Hidden" },
        },
        {
          id: "extension.sample.run",
          title: "Run",
          description: "Run command",
          completionEvents: ["onCommand:sample.run"],
          media: { type: "markdown", path: "media/run.md" },
        },
      ],
    })

    expect(globalGettingStartedService.getWalkthrough("extension.sample", { "feature.sample": false })).toBeNull()

    const beforeProgress = globalGettingStartedService.getWalkthrough("extension.sample", { "feature.sample": true })
    expect(beforeProgress?.steps.map((step) => step.id)).toEqual(["extension.sample.run"])
    expect(beforeProgress?.completedSteps).toBe(0)

    globalGettingStartedService.progressByEvent("onCommand:sample.run")

    const afterProgress = globalGettingStartedService.getWalkthrough("extension.sample", { "feature.sample": true })
    expect(afterProgress?.steps[0]).toEqual(expect.objectContaining({ id: "extension.sample.run", done: true }))
    expect(afterProgress?.progress).toBe(1)
  })

  it("registers evidence-safe onboarding commands and command palette menu entries", async () => {
    const calls: string[] = []
    const disposable = registerGettingStartedContributions({
      openFolder: async () => { calls.push("openFolder") },
      newFile: async () => { calls.push("newFile") },
      openCommandPalette: async () => { calls.push("commandPalette") },
      openChat: async () => { calls.push("openChat") },
      openRemote: async () => { calls.push("remote") },
    })

    for (const id of Object.values(GETTING_STARTED_COMMAND_IDS)) {
      expect(getCommand(id)).toEqual(expect.objectContaining({ source: "vscode" }))
    }

    await executeCommand(GETTING_STARTED_COMMAND_IDS.OpenFolder)
    await executeCommand(GETTING_STARTED_COMMAND_IDS.OpenChat)
    expect(calls).toEqual(["openFolder", "openChat"])

    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.id)).toEqual(expect.arrayContaining([
      GETTING_STARTED_COMMAND_IDS.OpenFolder,
      GETTING_STARTED_COMMAND_IDS.OpenChat,
    ]))
    expect(getGettingStartedContributionSummary().evidenceSafeActions.every((action) => action.writesGitIndex === false)).toBe(true)

    disposable.dispose()
    expect(getCommand(GETTING_STARTED_COMMAND_IDS.OpenFolder)).toBeNull()
  })

  it("emits progress changes without creating a second walkthrough state source", () => {
    const listener = vi.fn()
    const disposable = globalGettingStartedService.onDidChangeWalkthrough(listener)

    globalGettingStartedService.progressByEvent(`onCommand:${GETTING_STARTED_COMMAND_IDS.OpenFolder}`)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      id: "codek.setup",
      completedSteps: 1,
    }))
    expect(getWelcomePageProjection().categories.find((category) => category.id === "codek.setup")).toEqual(expect.objectContaining({
      completedSteps: 1,
      progress: 0.25,
    }))

    disposable.dispose()
  })
})
