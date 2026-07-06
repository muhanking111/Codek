/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/instantiation/common/extensions.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from "./descriptors"
import type { BrandedService, ServiceIdentifier } from "./instantiation"

export const enum InstantiationType {
  Eager = 0,
  Delayed = 1,
}

const registry: [ServiceIdentifier<unknown>, unknown | SyncDescriptor<unknown>][] = []

export function registerSingleton<T>(
  id: ServiceIdentifier<T>,
  ctorOrDescriptorOrInstance: (new (...services: BrandedService[]) => T) | SyncDescriptor<T> | T,
  supportsDelayedInstantiation: InstantiationType = InstantiationType.Delayed,
): void {
  if (ctorOrDescriptorOrInstance instanceof SyncDescriptor) {
    registry.push([id as ServiceIdentifier<unknown>, ctorOrDescriptorOrInstance as SyncDescriptor<unknown>])
  } else if (typeof ctorOrDescriptorOrInstance === "function") {
    registry.push([
      id as ServiceIdentifier<unknown>,
      new SyncDescriptor<T>(
        ctorOrDescriptorOrInstance as new (...args: unknown[]) => T,
        [],
        supportsDelayedInstantiation === InstantiationType.Delayed,
      ) as SyncDescriptor<unknown>,
    ])
  } else {
    registry.push([id as ServiceIdentifier<unknown>, ctorOrDescriptorOrInstance])
  }
}

export function getSingletonServiceDescriptors(): [ServiceIdentifier<unknown>, unknown | SyncDescriptor<unknown>][] {
  return [...registry]
}
