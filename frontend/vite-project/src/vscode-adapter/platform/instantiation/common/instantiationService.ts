/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/instantiation/common/instantiationService.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from "./descriptors"
import {
  createDecorator,
  getServiceDependencies,
  type IInstantiationService as IInstantiationServiceShape,
  type ServiceIdentifier,
  type ServicesAccessor,
} from "./instantiation"
import { ServiceCollection } from "./serviceCollection"

export const IInstantiationService = createDecorator<IInstantiationServiceShape>("instantiationService")

export class InstantiationService implements IInstantiationServiceShape {
  declare readonly _serviceBrand: undefined
  private readonly createdServices = new Set<unknown>()
  private readonly activeInstantiations = new Set<ServiceIdentifier<unknown>>()
  private disposed = false

  constructor(
    private readonly services = new ServiceCollection(),
    private readonly strict = false,
    private readonly parent?: InstantiationService,
  ) {
    this.services.set(IInstantiationService, this)
  }

  createChild(services: ServiceCollection): InstantiationService {
    this.throwIfDisposed()
    return new InstantiationService(services, this.strict, this)
  }

  invokeFunction<R, TS extends unknown[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R {
    this.throwIfDisposed()
    let done = false
    const accessor: ServicesAccessor = {
      get: <T>(id: ServiceIdentifier<T>) => {
        if (done) throw new Error("service accessor is only valid during invocation")
        const service = this.getOrCreateServiceInstance(id)
        if (!service) this.throwIfStrict(`[invokeFunction] unknown service '${id}'`)
        return service as T
      },
    }
    try {
      return fn(accessor, ...args)
    } finally {
      done = true
    }
  }

  createInstance<T>(ctorOrDescriptor: (new (...args: any[]) => T) | SyncDescriptor<T>, ...rest: unknown[]): T {
    this.throwIfDisposed()
    if (ctorOrDescriptor instanceof SyncDescriptor) {
      return this.doCreateInstance(ctorOrDescriptor.ctor, [...ctorOrDescriptor.staticArguments, ...rest])
    }
    return this.doCreateInstance(ctorOrDescriptor, rest)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const service of this.createdServices) {
      if (service && typeof (service as { dispose?: unknown }).dispose === "function") {
        ;(service as { dispose: () => void }).dispose()
      }
    }
    this.createdServices.clear()
  }

  private doCreateInstance<T>(ctor: new (...args: any[]) => T, staticArgs: unknown[] = []): T {
    const dependencies = getServiceDependencies(ctor)
    if (!dependencies.length) return new ctor(...staticArgs)

    const firstServiceArgPos = dependencies[0].index
    const args = staticArgs.slice(0, firstServiceArgPos)
    while (args.length < firstServiceArgPos) args.push(undefined)

    for (const dependency of dependencies) {
      args[dependency.index] = this.getOrCreateServiceInstance(dependency.id)
      if (!args[dependency.index]) this.throwIfStrict(`[createInstance] ${ctor.name} depends on UNKNOWN service ${dependency.id}.`)
    }
    return new ctor(...args)
  }

  private getOrCreateServiceInstance<T>(id: ServiceIdentifier<T>): T | undefined {
    const local = this.services.getInstanceOrDescriptor(id)
    if (local instanceof SyncDescriptor) return this.createAndCacheServiceInstance(id, local)
    if (local !== undefined) return local as T
    return this.parent?.getOrCreateServiceInstance(id)
  }

  private createAndCacheServiceInstance<T>(id: ServiceIdentifier<T>, descriptor: SyncDescriptor<T>): T {
    if (this.activeInstantiations.has(id as ServiceIdentifier<unknown>)) {
      throw new Error(`illegal state - RECURSIVELY instantiating service '${id}'`)
    }
    this.activeInstantiations.add(id as ServiceIdentifier<unknown>)
    try {
      const instance = this.doCreateInstance(descriptor.ctor, descriptor.staticArguments)
      this.services.set(id, instance)
      this.createdServices.add(instance)
      return instance
    } finally {
      this.activeInstantiations.delete(id as ServiceIdentifier<unknown>)
    }
  }

  private throwIfStrict(message: string): never {
    if (this.strict) throw new Error(message)
    throw new Error(message)
  }

  private throwIfDisposed(): void {
    if (this.disposed) throw new Error("InstantiationService has been disposed")
  }
}
