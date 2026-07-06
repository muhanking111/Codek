<template>
  <div v-if="!auth.isLoggedIn" class="auth-gate-root">
    <LoginView
      v-if="view === 'login'"
      @switchToRegister="handleSwitchToRegister"
      @switchToForgot="view = 'forgot'"
    />
    <RegisterPanel
      v-else-if="view === 'register'"
      :initialEmail="pendingEmail"
      @switchToLogin="view = 'login'"
    />
    <ForgotPasswordPanel v-else-if="view === 'forgot'" @switchToLogin="view = 'login'" />
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { auth } from "../auth/authState"
import LoginView from "../views/LoginView.vue"
import RegisterPanel from "./RegisterPanel.vue"
import ForgotPasswordPanel from "./ForgotPasswordPanel.vue"

const props = withDefaults(
  defineProps<{
    initialView?: "login" | "register" | "forgot"
  }>(),
  {
    initialView: "login",
  },
)

const view = ref<"login" | "register" | "forgot">(props.initialView)
const pendingEmail = ref("")

onMounted(async () => {
  await auth.init()
})

function handleSwitchToRegister(email?: string) {
  pendingEmail.value = email || ""
  view.value = "register"
}
</script>

<style scoped>
.auth-gate-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
</style>
