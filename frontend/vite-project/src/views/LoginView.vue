<script setup lang="ts">
import LoginWorkspace from "../components/login/LoginWorkspace.vue"
import LoginAuthPanel from "../components/login/LoginAuthPanel.vue"
import { useLoginProjectStatus } from "../composables/useLoginProjectStatus"

defineEmits<{
  switchToRegister: [email?: string]
  switchToForgot: []
}>()

const loginStatus = useLoginProjectStatus()
</script>

<template>
  <main class="desktop-login">
    <div class="ambient ambient-grid" aria-hidden="true"></div>
    <div class="ambient ambient-ring" aria-hidden="true"></div>
    <div class="ambient ambient-wordmark" aria-hidden="true">Codek</div>

    <header class="login-topbar">
      <div class="topbar-brand">
        <div class="traffic"><span></span><span></span><span></span></div>
        <span class="brand-mark">C</span>
        <span class="app-name">Codek</span>
      </div>

      <div class="topbar-status">
        <span class="service-chip">
          <span class="service-dot" :class="{ online: loginStatus.state.apiAvailable }"></span>
          {{ loginStatus.state.apiAvailable ? "桌面服务已连接" : "正在连接桌面服务" }}
        </span>
        <button class="refresh-button" type="button" @click="loginStatus.refresh">刷新</button>
      </div>
    </header>

    <section class="login-body">
      <LoginWorkspace
        :capabilityCards="loginStatus.capabilityCards.value"
        :serviceItems="loginStatus.serviceItems.value"
        :projectName="loginStatus.projectName.value"
        :projectRoot="loginStatus.projectRoot.value"
        :workspaceSummary="loginStatus.workspaceSummary.value"
        :heroSubtitle="loginStatus.heroSubtitle.value"
        :readyCount="loginStatus.readyCount.value"
      />

      <section class="login-stage">
        <div class="stage-accent" aria-hidden="true"></div>
        <LoginAuthPanel
          @switchToRegister="$emit('switchToRegister', $event)"
          @switchToForgot="$emit('switchToForgot')"
        />
      </section>
    </section>
  </main>
</template>

<style scoped>
.desktop-login {
  position: relative;
  min-height: 100vh;
  width: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: #edf4ff;
  background:
    radial-gradient(circle at 50% -12%, rgba(74, 212, 190, 0.18), transparent 32%),
    radial-gradient(circle at 88% 74%, rgba(78, 112, 170, 0.14), transparent 34%),
    linear-gradient(180deg, #0b0f16 0%, #0f141d 48%, #080c12 100%);
  overflow: hidden;
  -webkit-app-region: drag;
}

.ambient {
  position: fixed;
  pointer-events: none;
  user-select: none;
}

.ambient-grid {
  inset: 0;
  background:
    linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at 50% 42%, rgba(0, 0, 0, 0.9), transparent 74%);
  opacity: 0.62;
}

.ambient-ring {
  width: 720px;
  height: 720px;
  left: 50%;
  top: 50%;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow:
    0 0 0 120px rgba(255, 255, 255, 0.006),
    0 0 90px rgba(74, 212, 190, 0.06) inset;
  opacity: 0.7;
}

.ambient-wordmark {
  left: 50%;
  bottom: 8%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.018);
  font-size: clamp(88px, 16vw, 210px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}

.login-topbar {
  --codek-caption-safe-right: 154px;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
  height: 58px;
  padding: 0 calc(24px + var(--codek-caption-safe-right)) 0 24px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(9, 13, 19, 0.42);
  backdrop-filter: blur(18px);
  -webkit-app-region: drag;
  user-select: none;
}

.topbar-brand,
.topbar-status {
  display: flex;
  align-items: center;
  min-width: 0;
}

.topbar-brand {
  gap: 12px;
}

.topbar-status {
  gap: 10px;
  justify-content: flex-end;
  flex: 1 1 auto;
  max-width: min(520px, calc(100vw - 360px));
}

.traffic {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.traffic span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.traffic span:nth-child(1) {
  background: #ff6b6b;
}

.traffic span:nth-child(2) {
  background: #f6c453;
}

.traffic span:nth-child(3) {
  background: #38d98b;
}

.brand-mark {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #061016;
  background: linear-gradient(135deg, #5be7d2, #8bdc78);
  font-size: 14px;
  font-weight: 900;
  box-shadow: 0 10px 24px rgba(74, 212, 190, 0.14);
}

.app-name {
  color: #e9f1ff;
  font-size: 14px;
  font-weight: 800;
}

.service-chip,
.refresh-button {
  min-height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.045);
  color: #aab7d5;
  font: inherit;
  font-size: 12px;
}

.service-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 0 12px;
  color: #d9e6ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f0b35a;
  box-shadow: 0 0 12px rgba(240, 179, 90, 0.66);
}

.service-dot.online {
  background: #4ddac6;
  box-shadow: 0 0 12px rgba(77, 218, 198, 0.72);
}

.refresh-button {
  padding: 0 13px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.refresh-button:hover {
  color: #edf4ff;
  border-color: rgba(77, 218, 198, 0.24);
  background: rgba(77, 218, 198, 0.08);
}

.login-body {
  position: relative;
  z-index: 1;
  width: min(1320px, 100%);
  min-width: 0;
  min-height: 0;
  justify-self: center;
  align-self: stretch;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 420px);
  gap: 22px;
  padding: 30px 24px 42px;
  box-sizing: border-box;
  -webkit-app-region: no-drag;
}

.login-body > :deep(.workspace) {
  min-height: 0;
  padding: 0;
}

.login-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  -webkit-app-region: no-drag;
}

.stage-accent {
  position: absolute;
  width: min(540px, calc(100vw - 48px));
  height: min(540px, calc(100vw - 48px));
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 44%, rgba(77, 218, 198, 0.16), transparent 36%),
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.035), transparent 58%);
  filter: blur(2px);
  opacity: 0.86;
  pointer-events: none;
}

@media (max-height: 760px) and (min-width: 761px) {
  .login-topbar {
    height: 50px;
    padding-left: 18px;
    padding-right: calc(18px + var(--codek-caption-safe-right));
  }

  .login-body {
    padding: 18px;
    gap: 16px;
  }

  .ambient-wordmark {
    bottom: 3%;
  }
}

@media (max-width: 640px) {
  .login-topbar {
    height: 54px;
    padding: 0 calc(14px + var(--codek-caption-safe-right)) 0 14px;
  }

  .brand-mark {
    display: none;
  }

  .service-chip {
    max-width: 176px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .refresh-button {
    display: none;
  }

  .login-body {
    grid-template-columns: 1fr;
    align-items: start;
    padding: 28px 14px 32px;
  }

  .login-stage {
    order: 1;
  }

  .login-body > :deep(.workspace) {
    order: 2;
    overflow: visible;
  }

  .stage-accent {
    top: 36px;
    width: 420px;
    height: 420px;
  }

  .ambient-ring,
  .ambient-wordmark {
    display: none;
  }
}

@media (max-width: 860px) {
  .app-name {
    display: none;
  }

  .topbar-status {
    max-width: min(280px, calc(100vw - 230px));
  }
}
</style>
