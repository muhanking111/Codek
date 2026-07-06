/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/instantiation/common/descriptors.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export class SyncDescriptor<T> {
  readonly ctor: new (...args: any[]) => T
  readonly staticArguments: unknown[]
  readonly supportsDelayedInstantiation: boolean

  constructor(ctor: new (...args: any[]) => T, staticArguments: unknown[] = [], supportsDelayedInstantiation = false) {
    this.ctor = ctor
    this.staticArguments = staticArguments
    this.supportsDelayedInstantiation = supportsDelayedInstantiation
  }
}

export interface SyncDescriptor0<T> {
  readonly ctor: new () => T
}
