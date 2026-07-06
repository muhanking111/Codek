# VS Code 必要底座边界

更新时间：2026-07-01

本文件只回答一个问题：哪些 VS Code 底座能力还值得为 Agent 工作台闭环继续投入。它不是全量源码迁移计划。

## 规则

- 外部 VS Code source 只读对照；运行、构建、打包不得依赖外部源码目录。
- 新迁移必须直接阻塞 Agent 任务闭环，否则冻结。
- 迁移前必须列出 VS Code 入口、Codek 当前路径、替换/旁路方案和验证命令。
- 触碰 build/import/migration/source path 后必须跑 `npm run check:vscode-source-boundary`。

## 保留投入

| 能力 | 用途 |
| --- | --- |
| File / TextFile / WorkingCopy | proposal、Accept、Rollback、用户改动保护。 |
| Search / Replace / BulkEdit | Agent 跨文件修改主通道。 |
| Terminal / Task | 测试、typecheck、质量门输出采集。 |
| SCM / diff evidence | Accept 前风险提示和冲突保护。 |
| Diagnostics / Problems | 质量门失败解释。 |
| Extension Host 基础桥 | 命令、配置、storage、progress、tree/view。 |
| Menus / Commands / ContextKey | Agent 工作流入口和状态可见性。 |

## 冻结或延后

- 完整 Workbench UI parity、ActivityBar / Sidebar 视觉重构。
- 完整 Settings UI、Debug runtime、Remote、Marketplace、Auth、Notebook / Webview 深水位。
- 只为了“更像 VS Code”的结构搬迁。

答不上“它阻塞哪个 Agent 工作台用户路径”的任务，不开工。
