# Codek Frontend Workbench

本目录是 Codek 的 Vue 3 + Vite 前端工作台，不再保留默认 Vite 模板说明。

## 当前定位

- 支撑 Codek Agent 工作台：任务计划、Agent 状态、diff / artifact、质量门、证据链、Accept / Rework / Reject / Rollback。
- 继续使用 Monaco 和已经迁入的 VS Code adapter/shim，并优先补齐 Agent 工作台闭环必需底座。
- 不追求完整 VS Code Workbench UI parity，也不把视觉相似度作为当前主阻断。

## 开发命令

```powershell
npm install
npm run dev
npm run test -- --run
npm run typecheck
```

根仓库级验证仍从仓库根目录执行：

```powershell
npm run typecheck
npm run check:vscode-source-boundary
git diff --check
```

## 文档入口

- `../../docs/VS_CODE_SOURCE_MIGRATION_MATRIX.md`
- `../../docs/PACKAGING_RUNTIME_SOURCE_BOUNDARY.md`
