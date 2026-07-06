/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/lazy.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

enum LazyValueState {
  Uninitialized,
  Running,
  Completed,
}

export class Lazy<T> {
  private state = LazyValueState.Uninitialized
  private storedValue?: T
  private error: Error | undefined

  constructor(private readonly executor: () => T) {}

  get hasValue(): boolean {
    return this.state === LazyValueState.Completed
  }

  get value(): T {
    if (this.state === LazyValueState.Uninitialized) {
      this.state = LazyValueState.Running
      try {
        this.storedValue = this.executor()
      } catch (error) {
        this.error = error as Error
      } finally {
        this.state = LazyValueState.Completed
      }
    } else if (this.state === LazyValueState.Running) {
      throw new Error("Cannot read the value of a lazy that is being initialized")
    }

    if (this.error) throw this.error
    return this.storedValue as T
  }

  get rawValue(): T | undefined {
    return this.storedValue
  }
}
