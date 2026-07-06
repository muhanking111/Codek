import { describe, expect, it } from "vitest"
import { CodekDialogService } from "./dialogService"

describe("CodekDialogService", () => {
  it("queues modal confirm/input/prompt requests and projects evidence-safe decisions", async () => {
    let idCounter = 0
    let now = 1000
    const service = new CodekDialogService({
      now: () => now,
      createId: (prefix) => `${prefix}-${idCounter++}`,
    })
    const events: string[] = []
    service.onWillShowDialog((request) => events.push(`will:${request.id}:${request.kind}`))
    service.onDidShowDialog((decision) => events.push(`did:${decision.id}:${decision.kind}:${decision.outcome}`))

    const confirm = service.confirm({
      type: "warning",
      title: "删除文件",
      message: "确定删除 secret.txt？",
      detail: "该操作不可撤销",
      primaryButton: "删除",
      cancelButton: "取消",
      checkbox: { label: "同时删除证据缓存", checked: true },
      source: "explorer",
      evidenceContext: {
        operationId: "delete-1",
        workspaceFolder: "D:/Workspace",
        resource: "D:/Workspace/secret.txt",
        commandId: "workbench.files.delete",
      },
    })

    expect(service.getActiveDialog()).toMatchObject({
      id: "dialog-0",
      kind: "confirm",
      modal: true,
      buttons: [
        { index: 0, label: "删除", isCancel: false },
        { index: 1, label: "取消", isCancel: true },
      ],
      evidenceContext: {
        operationId: "delete-1",
        workspaceFolder: "D:/Workspace",
        commandId: "workbench.files.delete",
      },
    })

    service.resolveActiveDialog({ buttonIndex: 0, checkboxChecked: false })
    await expect(confirm).resolves.toEqual({ confirmed: true, checkboxChecked: false })
    expect(service.getDecisionProjections()).toEqual([
      {
        id: "dialog-0",
        kind: "confirm",
        outcome: "confirmed",
        buttonIndex: 0,
        buttonLabel: "删除",
        checkboxChecked: false,
        source: "explorer",
        timestamp: 1000,
        evidenceContext: {
          operationId: "delete-1",
          workspaceFolder: "D:/Workspace",
          resourceKind: "file",
          commandId: "workbench.files.delete",
        },
      },
    ])

    now = 1001
    const input = service.input({
      title: "输入 Token",
      message: "请输入访问令牌",
      inputs: [{ type: "password", value: "sk-secret", placeholder: "Token" }],
      primaryButton: "保存",
      cancelButton: "取消",
      source: "agent.approval",
    })
    service.resolveActiveDialog({ buttonIndex: 0, values: ["sk-secret"] })
    await expect(input).resolves.toEqual({ confirmed: true, values: ["sk-secret"] })
    expect(service.getDecisionProjections()[1]).toMatchObject({
      kind: "input",
      outcome: "confirmed",
      inputCount: 1,
      valuesRedacted: true,
      source: "agent.approval",
    })
    expect(JSON.stringify(service.getDecisionProjections())).not.toContain("sk-secret")

    now = 1002
    const prompt = service.prompt({
      type: "question",
      message: "如何处理冲突？",
      buttons: [
        { label: "保留本地", run: () => "local" },
        { label: "使用远端", run: () => "remote" },
      ],
      cancelButton: true,
      source: "merge",
    })
    service.resolveActiveDialog({ buttonIndex: 1 })
    await expect(prompt).resolves.toEqual({ result: "remote" })
    expect(events).toEqual([
      "will:dialog-0:confirm",
      "did:dialog-0:confirm:confirmed",
      "will:dialog-1:input",
      "did:dialog-1:input:confirmed",
      "will:dialog-2:prompt",
      "did:dialog-2:prompt:confirmed",
    ])
  })
})
