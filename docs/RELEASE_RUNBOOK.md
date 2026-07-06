# Release Runbook

本文件记录 Codek 公开发布前的最小检查步骤。它不替代 CI，也不包含签名证书、账号口令、API key 或任何私有路径。

## 发布前检查

1. 确认工作树干净，目标分支已同步远程。
2. 运行基础验证：

```powershell
npm run typecheck
npm run check:vscode-source-boundary
git diff --check
```

3. 运行公开仓库检查：

```powershell
npm run ba:open-source-readiness
```

4. 需要打包时先运行：

```powershell
npm run doctor -- --clean-clone
npm run build
```

5. 对生成产物记录版本、commit、操作系统、架构和校验值。不要把本机 `.codek` 报告、私有日志、签名证书或密钥提交到仓库。

## 签名

Windows、macOS 和 Linux 的签名材料必须保存在维护者自己的安全存储或 CI secret 中。仓库只记录签名流程和校验要求，不保存证书、私钥、授权码或密码。

## 回滚

如果发布后发现阻断问题：

1. 停止继续分发当前构建。
2. 标记受影响的版本、commit 和平台。
3. 回退到上一个已验证版本，或发布修复版本。
4. 在发布说明中记录影响范围、修复方式和用户需要采取的动作。

## 校验值

发布产物应提供 SHA256 校验值。校验值可以写入 release notes，但不要把本机绝对路径、用户目录或临时构建目录写入公开说明。
