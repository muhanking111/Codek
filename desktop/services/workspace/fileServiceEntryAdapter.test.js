const assert = require("node:assert/strict")
const test = require("node:test")
const path = require("path")

const {
  FilePermission,
  FileType,
  createDirectoryEntryLimitSentinel,
  mapDirentToFileServiceEntry,
  mapDirentsToFileServiceEntries,
  mapStatToFileServiceEntry,
} = require("./fileServiceEntryAdapter")

function dirent(name, kind) {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => kind === "symlink",
  }
}

test("maps Node dirents to VS Code FileType based explorer entries", async () => {
  const parentPath = path.join("C:", "repo")
  const entries = await mapDirentsToFileServiceEntries({
    fsPromises: {
      stat: async (entryPath) => ({
        size: entryPath.endsWith("a.ts") ? 12 : 0,
        mtimeMs: 101,
        ctimeMs: 99,
        mode: 0o555,
        isFile: () => entryPath.endsWith("a.ts"),
        isDirectory: () => entryPath.endsWith("src"),
        isSymbolicLink: () => false,
      }),
    },
    parentPath,
    dirents: [dirent("src", "directory"), dirent("a.ts", "file")],
    includeStats: true,
  })

  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, "src")
  assert.equal(entries[0].type, FileType.Directory)
  assert.equal(entries[0].isDirectory, true)
  assert.equal(entries[0].isDir, true)
  assert.equal(entries[1].type, FileType.File)
  assert.equal(entries[1].isFile, true)
  assert.equal(entries[1].size, 12)
  assert.equal(entries[1].mtimeMs, 101)
  assert.equal((entries[1].permissions & FilePermission.Executable) !== 0, true)
})

test("preserves symlink type when metadata stat is not requested", async () => {
  const entry = await mapDirentToFileServiceEntry({
    fsPromises: {},
    parentPath: path.join("C:", "repo"),
    dirent: dirent("linked", "symlink"),
    includeStats: false,
  })

  assert.equal(entry.type, FileType.SymbolicLink)
  assert.equal(entry.isSymbolicLink, true)
  assert.equal(entry.isDirectory, false)
  assert.equal(entry.isFile, false)
})

test("preserves symlink type when metadata stat follows the target", async () => {
  const entry = await mapDirentToFileServiceEntry({
    fsPromises: {
      stat: async () => ({
        size: 0,
        mtimeMs: 10,
        ctimeMs: 9,
        mode: 0o755,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }),
    },
    parentPath: path.join("C:", "repo"),
    dirent: dirent("linked-folder", "symlink"),
    includeStats: true,
  })

  assert.equal((entry.type & FileType.SymbolicLink) !== 0, true)
  assert.equal(entry.isSymbolicLink, true)
  assert.equal(entry.isDirectory, true)
})

test("maps Node stats to VS Code FileType based fs:stat result", () => {
  const result = mapStatToFileServiceEntry({
    filePath: path.join("C:", "repo", "src"),
    stat: {
      size: 4096,
      mtimeMs: 123,
      ctimeMs: 99,
      mode: 0o555,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    },
  })

  assert.equal(result.exists, true)
  assert.equal(result.name, "src")
  assert.equal(result.type, FileType.Directory)
  assert.equal(result.isDirectory, true)
  assert.equal(result.isDir, true)
  assert.equal(result.isFile, false)
  assert.equal(result.mtime, 123)
  assert.equal(result.mtimeMs, 123)
  assert.equal((result.permissions & FilePermission.Executable) !== 0, true)
})

test("fs:stat mapping keeps virtual size override for smoke fixtures", () => {
  const result = mapStatToFileServiceEntry({
    filePath: path.join("C:", "repo", "large.log"),
    sizeOverride: 260 * 1024 * 1024,
    stat: {
      size: 1024,
      mtimeMs: 123,
      ctimeMs: 99,
      mode: 0o644,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    },
  })

  assert.equal(result.type, FileType.File)
  assert.equal(result.isFile, true)
  assert.equal(result.size, 260 * 1024 * 1024)
})

test("falls back to dirent type when metadata stat fails", async () => {
  const entry = await mapDirentToFileServiceEntry({
    fsPromises: {
      stat: async () => {
        throw new Error("ENOENT")
      },
    },
    parentPath: path.join("C:", "repo"),
    dirent: dirent("vanished.txt", "file"),
    includeStats: true,
  })

  assert.equal(entry.type, FileType.File)
  assert.equal(entry.isFile, true)
  assert.equal(entry.size, 0)
  assert.equal(entry.mtimeMs, 0)
})

test("creates a FileType based directory entry limit sentinel", () => {
  const sentinel = createDirectoryEntryLimitSentinel({
    parentPath: path.join("C:", "repo"),
    totalEntries: 3200,
    readDurationMs: 17,
  })

  assert.equal(sentinel.name, "...")
  assert.equal(sentinel.type, FileType.File)
  assert.equal(sentinel.isFile, true)
  assert.equal(sentinel.isDirectory, false)
  assert.equal(sentinel.truncated, true)
  assert.equal(sentinel.totalEntries, 3200)
  assert.equal(sentinel.readDurationMs, 17)
})
