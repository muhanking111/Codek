import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FileIcon from "./FileIcon.vue"
import { ConfigurationTarget, settingsStore } from "../settings/settingsStore"
import { workbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(async (_path?: string) => ({
    found: true,
    themeId: "vs-seti",
    icons: {},
  })),
}))

vi.mock("../lib/api", () => ({
  api: {
    get: mocks.apiGet,
  },
}))

describe("FileIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsStore.reset()
    localStorage.clear()
  })

  it("consumes file icon theme changes through IWorkbenchThemeService", async () => {
    const wrapper = mount(FileIcon, {
      props: {
        name: "src/App.vue",
      },
    })
    await flushPromises()

    expect(wrapper.find(".file-icon-svg").classes()).toContain("icon-theme-vs-seti")
    expect(wrapper.find(".file-icon-svg").attributes("data-file-icon-theme-id")).toBe("vs-seti")
    expect(wrapper.find(".file-icon-svg").attributes("data-file-icon-theme-service")).toBe("workbenchThemeService")

    await workbenchThemeService.setFileIconTheme("minimal", ConfigurationTarget.USER)
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".file-icon-svg").classes()).toContain("icon-theme-minimal")
    expect(wrapper.find(".file-icon-svg").attributes("data-file-icon-theme-id")).toBe("minimal")
    expect(wrapper.find(".file-icon-svg").attributes("data-file-icon-theme-service")).toBe("workbenchThemeService")
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/extensions-host/icon-themes/minimal")

    wrapper.unmount()
  })
})
