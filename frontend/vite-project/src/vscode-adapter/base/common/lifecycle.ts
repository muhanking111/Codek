/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/lifecycle.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface IDisposable {
  dispose(): void
}

export function isDisposable(value: unknown): value is IDisposable {
  return !!value && typeof value === "object" && typeof (value as IDisposable).dispose === "function"
}

export function dispose<T extends IDisposable>(disposables: readonly T[]): T[] {
  const errors: unknown[] = []
  for (const disposable of disposables) {
    try {
      disposable.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "Encountered errors while disposing")
  return []
}

export class DisposableStore implements IDisposable {
  private readonly items = new Set<IDisposable>()
  private isDisposed = false

  add<T extends IDisposable>(disposable: T): T {
    if (disposable === (this as unknown as IDisposable)) throw new Error("Cannot register a disposable on itself")
    if (this.isDisposed) {
      disposable.dispose()
    } else {
      this.items.add(disposable)
    }
    return disposable
  }

  clear(): void {
    const items = Array.from(this.items)
    this.items.clear()
    dispose(items)
  }

  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.clear()
  }
}

export abstract class Disposable implements IDisposable {
  protected readonly store = new DisposableStore()

  dispose(): void {
    this.store.dispose()
  }

  protected register<T extends IDisposable>(disposable: T): T {
    return this.store.add(disposable)
  }
}

export const DisposableNone: IDisposable = Object.freeze({ dispose() {} })
