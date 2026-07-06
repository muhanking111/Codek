import { describe, expect, it, vi } from "vitest"
import {
  CancellationTokenSource,
  DisposableStore,
  Emitter,
  Event,
  ResourceMap,
  ResourceSet,
  TernarySearchTree,
  URI,
  compareFileExtensions,
  compareFileNames,
  dirname,
  extUriIgnorePathCase,
  isValidBasename,
  joinPath,
  relativePath,
} from "."

describe("VS Code base/common adapter", () => {
  it("disposes registered items exactly once", () => {
    const store = new DisposableStore()
    const first = vi.fn()
    const second = vi.fn()

    store.add({ dispose: first })
    store.add({ dispose: second })
    store.dispose()
    store.dispose()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("fires emitter listeners and supports once", () => {
    const emitter = new Emitter<number>()
    const regular = vi.fn()
    const once = vi.fn()

    const disposable = emitter.event(regular)
    Event.once(emitter.event)(once)
    emitter.fire(1)
    emitter.fire(2)
    disposable.dispose()
    emitter.fire(3)

    expect(regular).toHaveBeenCalledTimes(2)
    expect(regular).toHaveBeenNthCalledWith(1, 1)
    expect(regular).toHaveBeenNthCalledWith(2, 2)
    expect(once).toHaveBeenCalledTimes(1)
    expect(once).toHaveBeenCalledWith(1)
  })

  it("cancels tokens and notifies listeners", () => {
    const source = new CancellationTokenSource()
    const listener = vi.fn()

    source.token.onCancellationRequested(listener)
    expect(source.token.isCancellationRequested).toBe(false)
    source.cancel()

    expect(source.token.isCancellationRequested).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("parses and formats VS Code file URIs without corrupting path characters", () => {
    const uri = URI.file("C:\\Users\\Codek\\c#\\question?.ts")

    expect(uri.scheme).toBe("file")
    expect(uri.path).toBe("/C:/Users/Codek/c#/question?.ts")
    expect(uri.toString()).toBe("file:///c:/Users/Codek/c%23/question%3F.ts")
    expect(URI.parse(uri.toString()).path).toBe("/c:/Users/Codek/c#/question?.ts")
  })

  it("supports VS Code URI path helpers", () => {
    const root = URI.file("D:\\Workspace")
    const file = joinPath(root, "frontend", "..", "docs", "PLAN.md")

    expect(file.path).toBe("/D:/Workspace/docs/PLAN.md")
    expect(dirname(file).path).toBe("/D:/Workspace/docs")
    expect(relativePath(root, file)).toBe("docs/PLAN.md")
  })

  it("uses URI identity for resource maps and sets", () => {
    const file = URI.file("D:\\Workspace\\src\\App.vue")
    const samePathDifferentObject = URI.file("D:\\Workspace\\src\\App.vue")
    const map = new ResourceMap<string>()
    const set = new ResourceSet()

    map.set(file, "editor")
    set.add(file)

    expect(map.get(samePathDifferentObject)).toBe("editor")
    expect(set.has(samePathDifferentObject)).toBe(true)
    expect([...map.keys()][0]).toBe(file)
  })

  it("allows VS Code biased resource keys when a caller needs case-insensitive files", () => {
    const map = new ResourceMap<string>((resource) => extUriIgnorePathCase.getComparisonKey(resource))

    map.set(URI.file("D:\\Workspace\\SRC\\App.vue"), "opened")

    expect(map.get(URI.file("D:\\Workspace\\src\\app.vue"))).toBe("opened")
  })

  it("uses VS Code ternary search tree URI parent and child lookups", () => {
    const tree = TernarySearchTree.forUris<boolean>((resource) => resource.scheme === "file")
    const src = URI.file("D:\\Workspace\\src")
    const child = URI.file("D:\\Workspace\\SRC\\App.vue")
    const grandChild = URI.file("D:\\Workspace\\src\\nested\\File.ts")

    tree.fill([[src, true], [grandChild, true]])

    expect(tree.get(URI.file("D:\\Workspace\\src"))).toBe(true)
    expect(tree.findSubstr(child)).toBe(true)
    expect([...tree.findSuperstr(src)!].map(([resource]) => resource.fsPath.replace(/\\/g, "/"))).toEqual([
      "d:/Workspace/src/nested/File.ts",
    ])
  })

  it("uses VS Code filename comparers with numeric ordering", () => {
    const names = ["file-10.ts", "file-2.ts", "file-01.ts", "file-1.ts"]

    expect([...names].sort(compareFileNames)).toEqual([
      "file-01.ts",
      "file-1.ts",
      "file-2.ts",
      "file-10.ts",
    ])
    expect(["b.test.ts", "a.ts", "c.md"].sort(compareFileExtensions)).toEqual([
      "c.md",
      "a.ts",
      "b.test.ts",
    ])
  })

  it("validates basenames with VS Code Windows and Unix rules", () => {
    expect(isValidBasename("main.ts", true)).toBe(true)
    expect(isValidBasename("bad:name.ts", true)).toBe(false)
    expect(isValidBasename("con", true)).toBe(false)
    expect(isValidBasename("test.txt.", true)).toBe(false)
    expect(isValidBasename(" spaced ", true)).toBe(false)
    expect(isValidBasename("bad:name.ts", false)).toBe(true)
    expect(isValidBasename("nested/name.ts", false)).toBe(false)
  })
})
