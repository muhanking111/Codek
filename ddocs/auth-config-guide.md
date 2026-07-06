# Codek 登录配置

Codek 当前保留两种登录方式：

- 邮箱注册 / 登录：注册前必须通过 6 位随机邮箱验证码。
- GitHub Device Flow：只需要 `GITHUB_OAUTH_CLIENT_ID`，不需要 `GITHUB_OAUTH_CLIENT_SECRET`。

## GitHub

在 GitHub OAuth App 启用 Device Flow，然后写入：

```env
GITHUB_OAUTH_CLIENT_ID=你的_Client_ID
```

流程：前端请求设备码，用户在 GitHub 授权，后端轮询 access token，读取 GitHub 主邮箱，创建或登录 Codek 用户。

## 邮箱验证码

```env
CODEK_SMTP_HOST=smtp.qq.com
CODEK_SMTP_PORT=465
CODEK_SMTP_USER=你的邮箱
CODEK_SMTP_PASS=你的邮箱授权码
CODEK_SMTP_FROM=Codek <你的邮箱>
```

邮箱校验顺序：`trim/lowercase`、格式校验、DNS MX、发送验证码、提交验证码后创建账号。不做 SMTP VRFY 或探测式查号。

## 安全要求

- 不提交 `.env`、SMTP 授权码、OAuth secret、token、私钥。
- 之前暴露过的 GitHub Client Secret 或 SMTP 授权码必须轮换。
- GitHub Device Flow 不需要 Client Secret，不要把它写入代码或文档。

## 验证

```powershell
cd desktop
npm test -- --test-reporter=spec services/auth/oauth.test.js services/auth/emailVerification.test.js
node --check main.js
```
