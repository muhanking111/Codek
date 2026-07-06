import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import LoginView from "./LoginView.vue"
import { auth } from "../auth/authState"
import { workspace } from "../workspace/manager"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
}))

function resetAuthState() {
  auth.isLoggedIn = false
  auth.token = ""
  auth.username = ""
  auth.email = ""
  auth.loading = false
  auth.loginError = ""
  auth.loginErrorCode = ""
  auth.needCaptcha = false
  auth.captchaImage = ""
  auth.rememberMe = false
  auth.autoLogin = false
  auth.oauthStatus = "idle"
  auth.oauthProvider = ""
  auth.githubDeviceFlow.active = false
  auth.githubDeviceFlow.userCode = ""
  auth.githubDeviceFlow.verificationUri = ""
  auth.githubDeviceFlow.statusText = ""
}

describe("LoginView workspace visibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetAuthState()
    workspace.projectRoot = "D:\\Workspace"
    workspace.workspaceFile = ""
    workspace.workspaceRoots = ["D:\\Workspace"]
  })

  afterEach(() => {
    resetAuthState()
    workspace.projectRoot = ""
    workspace.workspaceFile = ""
    workspace.workspaceRoots = []
  })

  it("keeps pre-login workspace and project status visible next to the auth form", () => {
    const wrapper = mount(LoginView)

    expect(wrapper.findComponent({ name: "LoginWorkspace" }).exists()).toBe(true)
    expect(wrapper.text()).toContain("项目启动状态总览")
    expect(wrapper.text()).toContain("D:/Workspace")
    expect(wrapper.find("form").exists()).toBe(true)
    expect(wrapper.find("input#email").exists()).toBe(true)
    expect(wrapper.find("input#password").exists()).toBe(true)
    wrapper.unmount()
  })

  it("keeps email login interactive and preserves error/loading states", async () => {
    const loginWithEmail = vi.spyOn(auth, "loginWithEmail").mockResolvedValue(true)
    const wrapper = mount(LoginView)

    const submit = wrapper.find("button.submit")
    expect(submit.attributes("disabled")).toBeDefined()

    await wrapper.find("input#email").setValue("dev@example.test")
    await wrapper.find("input#password").setValue("secret-pass")
    await nextTick()
    expect(wrapper.find("button.submit").attributes("disabled")).toBeUndefined()

    await wrapper.find("form").trigger("submit")
    expect(loginWithEmail).toHaveBeenCalledWith("dev@example.test", "secret-pass", "")

    auth.loginError = "网络异常"
    auth.loginErrorCode = "network"
    await nextTick()
    expect(wrapper.text()).toContain("网络异常")

    auth.loading = true
    await nextTick()
    expect(wrapper.find("button.submit").attributes("disabled")).toBeDefined()
    wrapper.unmount()
  })
})
