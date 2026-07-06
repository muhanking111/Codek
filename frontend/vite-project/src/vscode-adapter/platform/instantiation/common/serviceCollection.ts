/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/instantiation/common/serviceCollection.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from "./instantiation"
import type { SyncDescriptor } from "./descriptors"

export class ServiceCollection {
  private readonly entries = new Map<ServiceIdentifier<unknown>, unknown | SyncDescriptor<unknown>>()

  constructor(...entries: [ServiceIdentifier<unknown>, unknown | SyncDescriptor<unknown>][]) {
    for (const [id, service] of entries) this.set(id, service)
  }

  set<T>(id: ServiceIdentifier<T>, service: T | SyncDescriptor<T>): T | SyncDescriptor<T> | undefined {
    const previous = this.entries.get(id) as T | SyncDescriptor<T> | undefined
    this.entries.set(id, service)
    return previous
  }

  get<T>(id: ServiceIdentifier<T>): T | undefined {
    return this.entries.get(id) as T | undefined
  }

  getInstanceOrDescriptor<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined {
    return this.entries.get(id) as T | SyncDescriptor<T> | undefined
  }

  has<T>(id: ServiceIdentifier<T>): boolean {
    return this.entries.has(id)
  }
}
