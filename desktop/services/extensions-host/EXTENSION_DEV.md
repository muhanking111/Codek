# Codek Extension Host 开发指南

当前 Extension Host 只服务 Agent 工作台 MVP 所需的基础扩展桥：命令、配置、storage、progress、status bar、tree/view、语言提供者和必要消息通道。它不是完整 VS Code Extension API 兼容承诺。

## 架构

```text
Renderer(Vue/Monaco)
  <-> Electron IPC
MainThread proxies
  <-> Named Pipe / PersistentProtocol
Extension Host(Node bundle)
```

关键目录：

- `desktop/services/extensions-host/mainThread/`：MainThread 代理。
- `desktop/services/extensions-host/extHostServer.js`：扩展宿主 IPC 服务。
- `desktop/services/extensions-host/bundle/`：生成的 Extension Host bundle。
- `frontend/vite-project/src/`：渲染侧事件、面板和 evidence 展示。

## 支持边界

优先维护：`commands`、`workspace.getConfiguration`、message/progress/status bar、storage、quick input、language providers、text editor 基础操作。

部分或延后：terminal、debug、SCM、webview、notebook、chat、完整 marketplace。除非直接阻塞 Agent MVP，不继续扩 API 面。

## 新增 MainThread 代理

1. 在 `mainThread/mainThread<Name>.js` 实现 `register(server, opts)`。
2. 用 `server.onRpc("$methodName", handler)` 注册 RPC。
3. 在 `mainThread/index.js` 接入并更新代理计数。
4. 补 focused Node/Vitest 测试；涉及 VS Code source path 时跑 `npm run check:vscode-source-boundary`。

## 故障恢复

Extension Host 崩溃后会按退避策略重启。用 `/extensions-host/recovery` 查看状态；不要把一次重启成功当作完整 API 兼容证明。
