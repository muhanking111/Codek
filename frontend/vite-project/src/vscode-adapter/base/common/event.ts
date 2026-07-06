/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/event.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, type IDisposable } from "./lifecycle"

export type Event<T> = (listener: (event: T) => unknown, thisArgs?: unknown, disposables?: IDisposable[]) => IDisposable

export namespace Event {
  export const None: Event<unknown> = () => ({ dispose() {} })

  export function once<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs, disposables) => {
      let didFire = false
      let result: IDisposable | undefined
      result = event((value) => {
        if (didFire) return
        didFire = true
        result?.dispose()
        listener.call(thisArgs, value)
      }, undefined, disposables)
      return result
    }
  }
}

export class Emitter<T> implements IDisposable {
  private readonly listeners = new Set<(event: T) => unknown>()
  private readonly disposables = new DisposableStore()
  private isDisposed = false

  readonly event: Event<T> = (listener, thisArgs, disposables) => {
    if (this.isDisposed) return { dispose() {} }
    const bound = thisArgs ? (event: T) => listener.call(thisArgs, event) : listener
    this.listeners.add(bound)
    const disposable = { dispose: () => { this.listeners.delete(bound) } }
    disposables?.push(disposable)
    return disposable
  }

  fire(event: T): void {
    if (this.isDisposed) return
    for (const listener of Array.from(this.listeners)) listener(event)
  }

  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.listeners.clear()
    this.disposables.dispose()
  }
}

