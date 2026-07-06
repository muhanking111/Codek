import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it } from "vitest"
import OutputPanel from "./OutputPanel.vue"
import { provideI18n } from "../i18n/index"
import { globalOutputLogTelemetryService } from "../workbench/outputLogTelemetryService"

describe("OutputPanel", () => {
  beforeEach(() => {
    globalOutputLogTelemetryService.reset()
  })

  it("follows the output service active channel and renders extension backing-file content", async () => {
    const wrapper = mount(OutputPanel, {
      props: {
        visible: true,
      },
      global: {
        plugins: [{
          install(app: { provide: (key: symbol | string, value: unknown) => void }) {
            provideI18n(app)
          },
        }],
      },
    })

    globalOutputLogTelemetryService.createOutputChannel("Extension Smoke", {
      source: "extensionHost",
      sources: ["extensionHost", "extension-output-ms.test-#1-Extension Smoke"],
      user: true,
    })
    globalOutputLogTelemetryService.write("Extension Smoke", "info", "debug-output-smoke:first\n", "extensionHost")
    globalOutputLogTelemetryService.write("Extension Smoke", "info", "debug-output-smoke:second\n", "extensionHost")
    globalOutputLogTelemetryService.showChannel("Extension Smoke", false)

    await flushPromises()
    await wrapper.vm.$nextTick()

    const outputContent = wrapper.find('[data-codek-smoke="output-content"]')
    const panel = wrapper.find('[data-codek-smoke="output-panel"]')
    expect(panel.attributes("data-output-owner")).toBe("outputLogTelemetryService")
    expect(panel.attributes("data-output-renderer-owner")).toBe("OutputPanel")
    expect(panel.attributes("data-output-main-thread-owner")).toBe("MainThreadOutputService")
    expect(panel.attributes("data-output-state-source")).toBe("outputLogTelemetryService")
    expect(panel.attributes("data-output-ui-owner-state")).toBe("partial")
    expect(panel.attributes("data-output-evidence-state")).toBe("partial")
    expect(panel.attributes("data-output-remaining-gap")).toContain("App.vue")
    expect(JSON.stringify(panel.attributes())).not.toContain("connected")
    expect(outputContent.attributes("data-output-service-source")).toBe("outputLogTelemetryService")
    expect(outputContent.attributes("data-output-active-channel")).toBe("Extension Smoke")
    expect(outputContent.attributes("data-output-entry-count")).toBe("2")
    expect(outputContent.attributes("data-output-preview")).toContain("debug-output-smoke:first")
    expect(outputContent.attributes("data-output-preview")).toContain("debug-output-smoke:second")
    expect(wrapper.text()).toContain("debug-output-smoke:first")
    expect(wrapper.text()).toContain("debug-output-smoke:second")

    wrapper.unmount()
  })
})
