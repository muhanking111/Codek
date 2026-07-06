import { describe, expect, it } from "vitest"
import { buildScmDecorationMap } from "./scmDecorations"

describe("buildScmDecorationMap", () => {
  it("creates relative, absolute and resourceUri keyed decorations from SCM providers", () => {
    const map = buildScmDecorationMap([{
      id: "git:D:/Workspace",
      providerId: "git",
      label: "Codek",
      rootUri: "D:/Workspace",
      branch: "main",
      ahead: 0,
      behind: 0,
      count: 2,
      groups: [
        { id: "changes", label: "更改", resources: [{ path: "src/a.ts", status: "M", staged: false, resourceUri: "file:///D:/Workspace/src/a.ts" }] },
        { id: "conflicts", label: "冲突", resources: [{ path: "src/b.ts", status: "U", staged: false }] },
      ],
    }])

    expect(map["src/a.ts"]).toMatchObject({ label: "M", status: "M", groupId: "changes", providerId: "git" })
    expect(map["D:/Workspace/src/a.ts"]).toMatchObject({ label: "M" })
    expect(map["file:///D:/Workspace/src/a.ts"]).toMatchObject({ label: "M" })
    expect(map["src/b.ts"]).toMatchObject({ label: "U", tooltip: "Codek: 冲突 (conflicts)" })
  })

  it("adds directory decorations when children contain SCM changes", () => {
    const map = buildScmDecorationMap([{
      id: "git:D:/Workspace",
      providerId: "git",
      label: "Codek",
      rootUri: "D:/Workspace",
      branch: "main",
      ahead: 0,
      behind: 0,
      count: 1,
      groups: [
        { id: "changes", label: "更改", resources: [{ path: "src/app/main.ts", status: "M", staged: false }] },
      ],
    }])

    expect(map["src"]).toMatchObject({ label: "M", aggregate: true })
    expect(map["src/app"]).toMatchObject({ label: "M", aggregate: true })
  })

  it("preserves readonly evidence and line style hints in decorations", () => {
    const map = buildScmDecorationMap([{
      id: "evidence:D:/Workspace",
      providerId: "agentEvidence",
      label: "Agent Evidence",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      count: 1,
      groups: [
        { id: "changes", label: "Evidence", resources: [{ path: "src/evidence.ts", status: "D", staged: false, readonlyEvidence: true }] },
      ],
    }])

    expect(map["src/evidence.ts"]).toMatchObject({
      readonlyEvidence: true,
      strikeThrough: true,
      faded: false,
    })
  })
})
