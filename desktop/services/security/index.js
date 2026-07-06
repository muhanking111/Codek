const pathGuard = require("./pathGuard")
const shellGuard = require("./shellGuard")
const sandbox = require("./sandbox")

module.exports = {
  ...pathGuard,
  ...shellGuard,
  ...sandbox,
  pathGuard,
  shellGuard,
  sandbox,
}
