const test = require("node:test")
const assert = require("node:assert/strict")

const emailVerification = require("./emailVerification")
const passwordReset = require("./passwordReset")

test("validateEmailAddress rejects invalid format before DNS lookup", async () => {
  const result = await emailVerification.validateEmailAddress("not-an-email", {
    resolveMx: async () => {
      throw new Error("should not resolve")
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, "invalid_email")
})

test("validateEmailAddress rejects domains without MX records", async () => {
  const result = await emailVerification.validateEmailAddress("dev@example.invalid", {
    resolveMx: async () => [],
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, "email_domain_unreachable")
})

test("validateEmailAddress accepts valid format with MX records", async () => {
  const result = await emailVerification.validateEmailAddress(" Dev@Gmail.COM ", {
    resolveMx: async () => [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }],
  })

  assert.deepEqual(result, { ok: true, email: "dev@gmail.com" })
})

test("registration verification code uses password reset code store", () => {
  passwordReset.clearAll()
  const issued = emailVerification.issueRegistrationCode("dev@gmail.com")
  assert.equal(issued.ok, true)

  const verified = emailVerification.verifyRegistrationCode("DEV@gmail.com", issued.code)
  assert.equal(verified.ok, true)
  emailVerification.consumeRegistrationCode("dev@gmail.com")
  assert.equal(emailVerification.verifyRegistrationCode("dev@gmail.com", issued.code).ok, false)
})
