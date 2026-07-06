import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  timeout: 30000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})