const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const {
  DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES,
  DEFAULT_MAX_RENDERER_READ_FILE_BYTES,
  hashLargeFileSegment,
  patchRendererTextFileSegment,
  readRendererTextFile,
  readRendererTextFileChunk,
  resolvePreviewWindow,
  resolveRendererMaxBytes,
} = require("./largeFileReader")

async function makeTempFile(content) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-large-reader-"))
  const filePath = path.join(dir, "large.log")
  await fs.promises.writeFile(filePath, content, "utf8")
  return { dir, filePath }
}

async function makeTempNamedFile(fileName, content) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-large-reader-"))
  const filePath = path.join(dir, fileName)
  await fs.promises.writeFile(filePath, content)
  return { dir, filePath }
}

test("renderer large-file reader keeps agent full reads unrestricted", () => {
  assert.equal(resolveRendererMaxBytes({}, { source: "agent" }), 0)
  assert.equal(resolveRendererMaxBytes({ maxBytes: 128 }, { source: "agent" }), 128)
  assert.equal(resolveRendererMaxBytes({}, { source: "user" }), DEFAULT_MAX_RENDERER_READ_FILE_BYTES)
  assert.equal(DEFAULT_MAX_RENDERER_READ_FILE_BYTES, 256 * 1024 * 1024)
})

test("renderer large-file reader clamps preview windows to the hard preview budget", () => {
  assert.deepEqual(resolvePreviewWindow({
    offset: 30,
    length: DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES * 4,
  }, DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES * 8), {
    offset: 30,
    previewBytes: DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES,
  })
})

test("renderer large-file reader allows 64MiB-class files to request a 16MiB window", () => {
  assert.deepEqual(resolvePreviewWindow({
    offset: 16 * 1024 * 1024,
    length: 16 * 1024 * 1024,
  }, 64 * 1024 * 1024), {
    offset: 16 * 1024 * 1024,
    previewBytes: 16 * 1024 * 1024,
  })
})

test("renderer large-file reader reads normal files above the old 2MB guard asynchronously", async () => {
  const content = `${"a".repeat((2 * 1024 * 1024) + 32)}\nmarker-after-old-guard\n`
  const { filePath } = await makeTempFile(content)
  const originalReadFileSync = fs.readFileSync
  fs.readFileSync = () => {
    throw new Error("readFileSync must not be used for renderer editor reads")
  }
  try {
    const result = await readRendererTextFile({
      resolvedPath: filePath,
      requestedPath: filePath,
      readOptions: { maxBytes: content.length },
      readMeta: { source: "user" },
    })

    assert.equal(result, content)
    assert.match(result, /marker-after-old-guard/)
  } finally {
    fs.readFileSync = originalReadFileSync
  }
})

test("renderer large-file reader blocks binary editor extensions before decoding as UTF-8", async () => {
  const { filePath } = await makeTempNamedFile("assets.pak", Buffer.from([0, 1, 2, 3, 4, 5]))

  const result = await readRendererTextFile({
    resolvedPath: filePath,
    requestedPath: filePath,
    readOptions: { maxBytes: 1024 },
    readMeta: { source: "user" },
  })

  assert.deepEqual(result, {
    error: "BINARY_FILE",
    size: 6,
    path: filePath,
  })
})

test("renderer chunk reader blocks binary editor extensions before decoding as UTF-8", async () => {
  const { filePath } = await makeTempNamedFile("icudtl.dat", Buffer.from([0, 1, 2, 3, 4, 5]))

  const result = await readRendererTextFileChunk({
    resolvedPath: filePath,
    requestedPath: filePath,
    readOptions: {
      length: 4,
      previewBytes: 4,
      offset: 0,
      preview: true,
    },
    maxChunkBytes: 512,
  })

  assert.deepEqual(result, {
    error: "BINARY_FILE",
    size: 6,
    path: filePath,
  })
})

test("renderer large-file reader returns a real window beyond the hard renderer budget", async () => {
  const { filePath } = await makeTempFile("small fixture marker")
  const result = await readRendererTextFile({
    resolvedPath: filePath,
    requestedPath: filePath,
    stat: {
      isFile: () => true,
      size: DEFAULT_MAX_RENDERER_READ_FILE_BYTES + 1,
    },
    readOptions: { maxBytes: DEFAULT_MAX_RENDERER_READ_FILE_BYTES },
    readMeta: { source: "user" },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.size, DEFAULT_MAX_RENDERER_READ_FILE_BYTES + 1)
  assert.equal(result.limit, DEFAULT_MAX_RENDERER_READ_FILE_BYTES)
  assert.equal(result.offset, 0)
  assert.match(result.content, /small fixture marker/)
})

test("renderer user reads switch 260MiB files to a bounded preview window", async () => {
  const second = "second-window-marker\n"
  const { filePath } = await makeTempFile(`${"a".repeat(1024)}${second}${"b".repeat(1024)}`)
  const offset = 1024
  const result = await readRendererTextFile({
    resolvedPath: filePath,
    requestedPath: filePath,
    stat: {
      isFile: () => true,
      size: 260 * 1024 * 1024,
    },
    readOptions: {
      preview: true,
      previewBytes: 256,
      length: 256,
      offset,
    },
    readMeta: { source: "user" },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.size, 260 * 1024 * 1024)
  assert.equal(result.limit, DEFAULT_MAX_RENDERER_READ_FILE_BYTES)
  assert.equal(result.offset, offset)
  assert.equal(result.bytesRead, 256)
  assert.match(result.content, /second-window-marker/)
})

test("renderer large-file reader reads real preview windows asynchronously for extreme files", async () => {
  const first = "first-window-marker\n"
  const second = "second-window-marker\n"
  const padding = "x".repeat(1024)
  const { filePath } = await makeTempFile(`${first}${padding}${second}${padding}`)
  const offset = first.length + padding.length
  const result = await readRendererTextFile({
    resolvedPath: filePath,
    requestedPath: filePath,
    stat: {
      isFile: () => true,
      size: DEFAULT_MAX_RENDERER_READ_FILE_BYTES + 1,
    },
    readOptions: {
      maxBytes: 1024,
      preview: true,
      previewBytes: 256,
      length: 256,
      offset,
    },
    readMeta: { source: "user" },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.offset, offset)
  assert.equal(result.previewBytes, 256)
  assert.match(result.content, /second-window-marker/)
})

test("renderer large-file smoke windows follow the requested preview size, not the legacy 8MiB default", async () => {
  const { filePath } = await makeTempFile("smoke fixture")
  const result = await readRendererTextFile({
    resolvedPath: filePath,
    requestedPath: filePath,
    stat: {
      isFile: () => true,
      size: DEFAULT_MAX_RENDERER_READ_FILE_BYTES + 1,
    },
    smokeExtremeFile: {
      filePath,
      virtualSize: DEFAULT_MAX_RENDERER_READ_FILE_BYTES + 1,
    },
    readOptions: {
      maxBytes: 1024 * 1024,
      preview: true,
      previewBytes: 1024 * 1024,
      length: 1024 * 1024,
      offset: 1024 * 1024,
    },
    readMeta: { source: "user" },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.offset, 1024 * 1024)
  assert.match(result.content, /CODEK_EXTREME_WINDOW_002/)
})

test("renderer large-file chunk reader returns only the requested small byte window", async () => {
  const first = "chunk-first-marker\n"
  const second = "chunk-second-marker\n"
  const { filePath } = await makeTempFile(`${first}${"a".repeat(4096)}${second}${"b".repeat(4096)}`)
  const offset = first.length + 4096
  const result = await readRendererTextFileChunk({
    resolvedPath: filePath,
    requestedPath: filePath,
    readOptions: {
      length: 256,
      previewBytes: 256,
      offset,
      preview: true,
    },
    maxChunkBytes: 512,
  })

  assert.equal(result.offset, offset)
  assert.equal(result.previewBytes, 256)
  assert.equal(result.bytesRead, 256)
  assert.match(result.content, /chunk-second-marker/)
  assert.doesNotMatch(result.content, /chunk-first-marker/)
})

test("renderer large-file segment patch replaces only the requested byte window", async () => {
  const content = "prefix--window--suffix"
  const { filePath } = await makeTempFile(content)

  await assert.doesNotReject(() => patchRendererTextFileSegment(filePath, {
    path: "large.log",
    offset: "prefix--".length,
    deleteBytes: "window".length,
    insertText: "edited",
    expectedSize: Buffer.byteLength(content, "utf8"),
    expectedHash: hashLargeFileSegment("window"),
    nextSize: Buffer.byteLength("prefix--edited--suffix", "utf8"),
    safety: "safe-segment-replace",
  }))

  assert.equal(await fs.promises.readFile(filePath, "utf8"), "prefix--edited--suffix")
})

test("renderer large-file segment patch rejects external file size changes", async () => {
  const content = "prefix--window--suffix"
  const { filePath } = await makeTempFile(content)

  await assert.rejects(() => patchRendererTextFileSegment(filePath, {
    path: "large.log",
    offset: "prefix--".length,
    deleteBytes: "window".length,
    insertText: "edited",
    expectedSize: Buffer.byteLength(content, "utf8") + 1,
    expectedHash: hashLargeFileSegment("window"),
    nextSize: Buffer.byteLength("prefix--edited--suffix", "utf8"),
    safety: "safe-segment-replace",
  }), /文件大小已经被外部修改/)

  assert.equal(await fs.promises.readFile(filePath, "utf8"), content)
})

test("renderer large-file segment patch rejects external window content changes", async () => {
  const content = "prefix--window--suffix"
  const { filePath } = await makeTempFile(content)

  await assert.rejects(() => patchRendererTextFileSegment(filePath, {
    path: "large.log",
    offset: "prefix--".length,
    deleteBytes: "window".length,
    insertText: "edited",
    expectedSize: Buffer.byteLength(content, "utf8"),
    expectedHash: hashLargeFileSegment("stale-window"),
    nextSize: Buffer.byteLength("prefix--edited--suffix", "utf8"),
    safety: "safe-segment-replace",
  }), /当前窗口内容已经变化/)

  assert.equal(await fs.promises.readFile(filePath, "utf8"), content)
})
