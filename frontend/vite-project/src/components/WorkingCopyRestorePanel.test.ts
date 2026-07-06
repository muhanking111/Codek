import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import WorkingCopyRestorePanel from "./WorkingCopyRestorePanel.vue"
import type { WorkingCopyRestoreActionState } from "../workspace/manager"

function createRestoreAction(overrides: Partial<WorkingCopyRestoreActionState> = {}): WorkingCopyRestoreActionState {
  return {
    path: "src/main.ts",
    resource: "file:///D:/Workspace/src/main.ts",
    state: "conflict",
    message: "磁盘内容已变化，备份可作为冲突打开。",
    primaryAction: {
      id: "restore",
      label: "恢复备份并标记冲突",
      description: "打开备份内容，但保留磁盘上的外部修改，等待保存或丢弃。",
      enabled: true,
    },
    actions: [
      {
        id: "restore",
        label: "恢复备份并标记冲突",
        description: "打开备份内容，但保留磁盘上的外部修改，等待保存或丢弃。",
        enabled: true,
      },
      {
        id: "discard",
        label: "丢弃备份",
        description: "删除 hot-exit 备份，保留当前磁盘内容。",
        enabled: true,
      },
      {
        id: "openAsConflict",
        label: "作为冲突打开",
        description: "打开备份并保持冲突状态。",
        enabled: true,
      },
    ],
    ...overrides,
  }
}

describe("WorkingCopyRestorePanel", () => {
  it("renders the empty restore picker DOM state", () => {
    const wrapper = mount(WorkingCopyRestorePanel, { props: { actions: [] } })

    expect(wrapper.find('[data-codek-smoke="working-copy-restore-empty"]').text()).toContain("没有待恢复")
    expect(wrapper.find('[data-codek-smoke="working-copy-restore-list"]').exists()).toBe(false)
  })

  it("renders pending backups with restore discard and conflict actions", async () => {
    const wrapper = mount(WorkingCopyRestorePanel, {
      props: {
        actions: [createRestoreAction()],
      },
    })

    const entry = wrapper.find(".restore-panel-entry")
    expect(entry.attributes("data-path")).toBe("src/main.ts")
    expect(entry.attributes("data-state")).toBe("conflict")
    expect(wrapper.find('[data-action="restore"]').classes()).toContain("primary")
    expect(wrapper.find('[data-action="discard"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="openAsConflict"]').exists()).toBe(true)

    await wrapper.find('[data-action="openAsConflict"]').trigger("click")
    expect(wrapper.emitted("apply")).toEqual([["src/main.ts", "openAsConflict"]])
  })

  it("exposes orphan actions and disabled busy error states", () => {
    const wrapper = mount(WorkingCopyRestorePanel, {
      props: {
        busyActionKey: "src/delete-me.ts:openAsOrphan",
        errorMessage: "restore failed",
        actions: [
          createRestoreAction({
            path: "src/delete-me.ts",
            state: "orphan",
            message: "原文件已删除，备份可作为 orphan 打开。",
            primaryAction: {
              id: "openAsOrphan",
              label: "作为已删除文件打开",
              description: "打开备份并保持已删除状态。",
              enabled: true,
            },
            actions: [
              {
                id: "openAsOrphan",
                label: "作为已删除文件打开",
                description: "打开备份并保持已删除状态。",
                enabled: true,
              },
            ],
          }),
        ],
      },
    })

    expect(wrapper.classes()).toContain("busy")
    expect(wrapper.classes()).toContain("error")
    expect(wrapper.find('[data-codek-smoke="working-copy-restore-error"]').text()).toBe("restore failed")
    const button = wrapper.find('[data-action="openAsOrphan"]')
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.text()).toContain("处理中")
  })
})
