/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/cancellation.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "./event"
import { type IDisposable } from "./lifecycle"

export interface CancellationToken {
  readonly isCancellationRequested: boolean
  readonly onCancellationRequested: Event<void>
}

const cancelledEvent: Event<void> = (listener, thisArgs): IDisposable => {
  const handle = setTimeout(() => listener.call(thisArgs, undefined), 0)
  return { dispose: () => clearTimeout(handle) }
}

export namespace CancellationToken {
  export const None: CancellationToken = Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: Event.None as Event<void>,
  })

  export const Cancelled: CancellationToken = Object.freeze({
    isCancellationRequested: true,
    onCancellationRequested: cancelledEvent,
  })
}

class MutableToken implements CancellationToken, IDisposable {
  private cancelled = false
  private emitter: Emitter<void> | null = null

  get isCancellationRequested(): boolean {
    return this.cancelled
  }

  get onCancellationRequested(): Event<void> {
    if (this.cancelled) return cancelledEvent
    this.emitter ??= new Emitter<void>()
    return this.emitter.event
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.emitter?.fire(undefined)
    this.dispose()
  }

  dispose(): void {
    this.emitter?.dispose()
    this.emitter = null
  }
}

export class CancellationTokenSource implements IDisposable {
  private currentToken: CancellationToken | undefined
  private parentListener: IDisposable | undefined

  constructor(parent?: CancellationToken) {
    this.parentListener = parent?.onCancellationRequested(() => this.cancel())
  }

  get token(): CancellationToken {
    this.currentToken ??= new MutableToken()
    return this.currentToken
  }

  cancel(): void {
    if (!this.currentToken) {
      this.currentToken = CancellationToken.Cancelled
    } else if (this.currentToken instanceof MutableToken) {
      this.currentToken.cancel()
    }
  }

  dispose(cancel = false): void {
    if (cancel) this.cancel()
    this.parentListener?.dispose()
    if (!this.currentToken) this.currentToken = CancellationToken.None
    else if (this.currentToken instanceof MutableToken) this.currentToken.dispose()
  }
}

