# Security Policy

## 安全边界

Codek 是本地桌面开发工具，会接触用户项目文件、终端命令、扩展、模型 Provider 配置和 Agent 任务输出。默认安全边界是人类确认优先：Agent 在用户确认前不应静默修改真实工作区。

关键流程必须保持本地可控：计划、diff、测试结果、质量门、证据链和失败复盘都应可由用户检查；高风险写入、命令执行、扩展安装和外部上传不能静默发生。

## 不要提交

请不要向仓库提交以下内容：

- API key、Bearer token、SSH key、证书、私钥、`.env` 文件。
- 用户私有项目源码、prompt/response 正文、模型输出全文。
- 本机 `.codek` 报告里的完整隐私路径或私有文件内容。
- 安装包签名证书或证书密码。

## 报告漏洞

公开仓库启用前，先通过私下渠道联系维护者。请提供：

- Codek 版本或 commit。
- 操作系统和安装方式。
- 最小复现步骤。
- 错误摘要和必要截图。
- 是否涉及越权文件写入、命令执行、密钥泄露或沙箱绕过。

不要在公开 issue 中粘贴真实密钥、用户文件正文或可直接利用的攻击 payload。

## 高风险区域

- Agent 自动写入、Accept/Rollback、patch apply。
- 终端命令执行和 shell integration。
- 扩展安装、扩展宿主和 marketplace 数据。
- 文件上传、图片附件、工作区索引。
- 模型 Provider 配置和本地使用量统计。

## 维护者发布检查

发布前必须运行：

```powershell
npm run release:gate -- --open-source-candidate --report-dir=.codek/reports
```

如门禁发现密钥、私有内容、缺少公开文档、缺少 CI 或 AY 证据失败，不得公开发布。
