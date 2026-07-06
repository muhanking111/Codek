const assert = require("node:assert/strict")
const test = require("node:test")

const {
  fileUriPathToFsPath,
  pathToFileUriPath,
  toFileUriComponents,
} = require("./uriComponents")

test("pathToFileUriPath prefixes Windows drive paths for VS Code URI components", () => {
  assert.equal(pathToFileUriPath("D:\\Workspace\\docs\\plan.md", "win32"), "/D:/Workspace/docs/plan.md")
  assert.equal(pathToFileUriPath("c:/Users/name/file.ts", "win32"), "/c:/Users/name/file.ts")
})

test("pathToFileUriPath leaves POSIX absolute paths unprefixed", () => {
  assert.equal(pathToFileUriPath("/home/codek/project/file.ts", "linux"), "/home/codek/project/file.ts")
})

test("fileUriPathToFsPath converts VS Code Windows URI paths back to normalized fs paths", () => {
  assert.equal(fileUriPathToFsPath("/D:/Workspace/docs/plan.md", "win32", "\\"), "d:\\Workspace\\docs\\plan.md")
  assert.equal(fileUriPathToFsPath("/c:/Users/name/file.ts", "win32", "\\"), "c:\\Users\\name\\file.ts")
})

test("toFileUriComponents returns complete file URI component shape", () => {
  assert.deepEqual(toFileUriComponents("D:\\Workspace\\package.json", "win32"), {
    $mid: 1,
    scheme: "file",
    authority: "",
    path: "/D:/Workspace/package.json",
    query: "",
    fragment: "",
    fsPath: "d:\\Workspace\\package.json",
    _sep: 1,
  })
})
