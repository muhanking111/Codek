const test = require("node:test")
const assert = require("node:assert/strict")

const oauth = require("./oauth")

function withEnv(values, fn) {
  const original = {}
  for (const key of Object.keys(values)) {
    original[key] = process.env[key]
    if (values[key] === undefined) delete process.env[key]
    else process.env[key] = values[key]
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (original[key] === undefined) delete process.env[key]
        else process.env[key] = original[key]
      }
      oauth.setFetchForTest(null)
    })
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body
    },
  }
}

function parseBody(init) {
  return Object.fromEntries(new URLSearchParams(String(init.body || "")).entries())
}

test("oauth rejects removed providers", async () => {
  await assert.rejects(
    () => oauth.exchange("google", "code", "http://localhost/callback"),
    /unsupported_provider/,
  )
  await assert.rejects(
    () => oauth.exchange("qq", "code", "http://localhost/callback"),
    /unsupported_provider/,
  )
  await assert.rejects(
    () => oauth.exchange("wechat", "code", "http://localhost/callback"),
    /unsupported_provider/,
  )
})

test("GitHub Device Flow start requires client id", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: undefined }, async () => {
    await assert.rejects(
      () => oauth.startGithubDeviceFlow(),
      /github_client_id_required/,
    )
  })
})

test("GitHub Device Flow start parses device code response", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    let request
    oauth.setFetchForTest(async (url, init) => {
      request = { url: String(url), init, body: parseBody(init) }
      return jsonResponse({
        device_code: "device-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      })
    })

    const started = await oauth.startGithubDeviceFlow()

    assert.equal(request.url, "https://github.com/login/device/code")
    assert.equal(request.init.method, "POST")
    assert.equal(request.body.client_id, "gh_id")
    assert.equal(request.body.scope, "read:user user:email")
    assert.deepEqual(started, {
      provider: "github",
      deviceCode: "device-123",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    })
  })
})

test("GitHub Device Flow start rejects malformed GitHub responses", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    oauth.setFetchForTest(async () => jsonResponse({ error: "bad_verification_code" }))

    await assert.rejects(
      () => oauth.startGithubDeviceFlow(),
      /github_device_start_failed/,
    )
  })
})

test("GitHub Device Flow poll reports authorization_pending as waiting", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    oauth.setFetchForTest(async () => jsonResponse({ error: "authorization_pending" }))

    const result = await oauth.pollGithubDeviceFlow("device-123", 5)

    assert.deepEqual(result, {
      status: "pending",
      interval: 5,
      error: "authorization_pending",
    })
  })
})

test("GitHub Device Flow poll increases interval on slow_down", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    oauth.setFetchForTest(async () => jsonResponse({ error: "slow_down" }))

    const result = await oauth.pollGithubDeviceFlow("device-123", 5)

    assert.deepEqual(result, {
      status: "pending",
      interval: 10,
      error: "slow_down",
    })
  })
})

test("GitHub Device Flow poll maps terminal GitHub errors", async () => {
  const cases = [
    ["expired_token", "github_device_code_expired"],
    ["access_denied", "github_authorization_denied"],
    ["device_flow_disabled", "github_device_flow_disabled"],
  ]

  for (const [githubError, expected] of cases) {
    await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
      oauth.setFetchForTest(async () => jsonResponse({ error: githubError }))

      await assert.rejects(
        () => oauth.pollGithubDeviceFlow("device-123", 5),
        new RegExp(expected),
      )
    })
  }
})

test("GitHub Device Flow poll fetches stable id and verified primary email", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    const calls = []
    oauth.setFetchForTest(async (url, init = {}) => {
      calls.push({ url: String(url), init })
      const href = String(url)
      if (href.includes("access_token")) {
        const body = parseBody(init)
        assert.equal(body.client_id, "gh_id")
        assert.equal(body.device_code, "device-123")
        assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:device_code")
        return jsonResponse({ access_token: "token", token_type: "bearer" })
      }
      if (href.endsWith("/user")) return jsonResponse({ id: 42, login: "dev" })
      if (href.endsWith("/user/emails")) {
        return jsonResponse([
          { email: "secondary@example.com", primary: false, verified: true },
          { email: "Dev@Gmail.COM", primary: true, verified: true },
        ])
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const result = await oauth.pollGithubDeviceFlow("device-123", 5)

    assert.deepEqual(result, {
      status: "authorized",
      provider: "github",
      oauthId: "42",
      email: "dev@gmail.com",
    })
    assert.equal(calls.length, 3)
  })
})

test("GitHub identity requires a verified primary email", async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: "gh_id" }, async () => {
    oauth.setFetchForTest(async (url) => {
      if (String(url).endsWith("/user")) return jsonResponse({ id: 42, email: "" })
      if (String(url).endsWith("/user/emails")) {
        return jsonResponse([{ email: "dev@example.com", primary: true, verified: false }])
      }
      throw new Error(`unexpected url: ${url}`)
    })

    await assert.rejects(
      () => oauth.fetchGithubIdentity("token"),
      /github_verified_email_required/,
    )
  })
})

test("authorizeUrls keeps GitHub clickable without exposing a Web OAuth URL", () => withEnv({
  GITHUB_OAUTH_CLIENT_ID: "gh_id",
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
  QQ_OAUTH_CLIENT_ID: "qq_id",
  QQ_OAUTH_CLIENT_SECRET: "qq_secret",
  WECHAT_OAUTH_APP_ID: "wx_id",
  WECHAT_OAUTH_APP_SECRET: "wx_secret",
}, async () => {
  const providers = oauth.authorizeUrls()
  assert.equal(providers.length, 1)
  assert.deepEqual(providers.map((p) => p.provider), ["github"])
  assert.equal(providers[0].configured, true)
  assert.equal(providers[0].authorizeUrl, "")
}))
