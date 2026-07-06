import { createApp } from 'vue'
import App from './App.vue'
import AuthGate from './components/AuthGate.vue'
import { auth } from './auth/authState'
import { provideI18n } from './i18n/index'
import { setupGlobalErrorHandlers, captureError } from './utils/errorReporter'

setupGlobalErrorHandlers()

const isElectron = typeof window !== 'undefined'
  && Boolean((window as unknown as { codek?: unknown }).codek)
const previewView = import.meta.env.DEV && typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('codekPreview')
  : ""
const isAuthPreview = previewView === 'login' || previewView === 'register'

if (isAuthPreview) {
  const previewParams = new URLSearchParams(window.location.search)
  if (previewParams.get('githubDevicePreview') === '1') {
    auth.loading = true
    auth.oauthStatus = 'pending'
    auth.oauthProvider = 'github'
    auth.githubDeviceFlow = {
      active: true,
      deviceCode: 'preview-device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: Date.now() + 840000,
      expiresIn: 900,
      remainingSeconds: 840,
      interval: 5,
      statusText: '已打开 GitHub 授权页，等待你完成授权',
      copyState: 'idle',
    }
  }
  const app = createApp(AuthGate, { initialView: previewView })
  provideI18n(app)
  app.mount('#app')
} else if (!isElectron) {
  document.body.innerHTML = `
    <div style="
      display:flex;align-items:center;justify-content:center;
      height:100vh;background:#0d0e10;color:#d1d5db;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      text-align:center;padding:24px;">
      <div>
        <h1 style="font-size:24px;margin-bottom:12px;color:#2dd4bf;">Codek</h1>
        <p style="font-size:15px;color:#8b8fa3;">请通过桌面应用启动 Codek，浏览器访问已禁用。</p>
        <p style="font-size:13px;color:#5a5e6a;margin-top:8px;">Please launch Codek via the desktop application.</p>
      </div>
    </div>
  `
} else {
  const app = createApp(App)

  app.config.errorHandler = (err, _instance, info) => {
    captureError("vue", err, { info })
  }

  provideI18n(app)
  app.mount('#app')
}
