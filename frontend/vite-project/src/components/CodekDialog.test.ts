import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import CodekDialog from "./CodekDialog.vue"

describe("CodekDialog", () => {
  it("uses labelled dialog semantics and shows loading state", () => {
    const wrapper = mount(CodekDialog, {
      props: {
        visible: true,
        title: "测试弹窗",
        loading: true,
      },
      slots: {
        default: "<button>确认</button>",
      },
      attachTo: document.body,
    })

    const dialog = document.body.querySelector(".cdk-overlay") as HTMLElement
    const title = document.body.querySelector(".cdk-title") as HTMLElement

    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id)
    expect(document.body.querySelector(".cdk-loading")?.textContent).toContain("处理中")

    wrapper.unmount()
  })
})
