# Privacy

Codek 的默认定位是本地桌面工具。当前公开版本不启用默认遥测上传，不上传安装包 smoke、Agent 报告、prompt/response 正文或用户文件正文。

## 本地数据

Codek 可能在本地保存：

- 设置、窗口状态和工作区状态。
- Agent run report、quality gate 摘要、artifact 元数据和 diff 摘要。
- 扩展列表、图标缓存、索引缓存和终端状态。
- `.codek/reports` 下的本地验证报告。

这些数据用于本机调试和交付验收，不应直接上传到公开仓库。

## API key 与模型请求

API key 应只保存在本机环境变量或本地配置中。不要把 API key、Bearer token 或 Provider 凭据写入文档、截图、issue、日志或报告。

当用户配置模型 Provider 后，prompt 和上下文可能发送到对应 Provider。请在发送前确认是否包含私有代码、密钥、合同、客户数据或其他敏感内容。

## 遥测

当前公开版本没有默认遥测上传闭环。未来如增加遥测，必须提供明确开关、说明采集字段，并避免采集用户文件正文、prompt/response 正文和密钥。

## 清理本地数据

Windows 安装版通常使用 `%APPDATA%/Codek`。便携或 smoke 模式可能使用隔离 user data 目录。需要干净重试时，先关闭 Codek，再删除对应用户数据目录。删除前请确认没有需要保留的本地配置。
