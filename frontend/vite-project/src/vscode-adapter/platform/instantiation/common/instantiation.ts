/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/instantiation/common/instantiation.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export type BrandedService = { _serviceBrand: undefined }

export interface ServiceIdentifier<T> {
  (...args: unknown[]): void
  type: T
}

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T
}

export interface IInstantiationService extends BrandedService {
  createChild(services: unknown): IInstantiationService
  invokeFunction<R, TS extends unknown[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R
  createInstance<T>(ctor: new (...args: any[]) => T, ...args: unknown[]): T
}

export interface ServiceDependency<T = unknown> {
  id: ServiceIdentifier<T>
  index: number
}

const dependenciesKey = "$di$dependencies"
const serviceIds = new Map<string, ServiceIdentifier<unknown>>()

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
  const existing = serviceIds.get(serviceId)
  if (existing) return existing as ServiceIdentifier<T>

  const id = function serviceIdentifier(target: Function, key: string, index: number) {
    if (arguments.length !== 3) {
      throw new Error("@IServiceName-decorator can only be used to decorate a parameter")
    }
    const targetRecord = target as unknown as Record<string, unknown>
    const dependencies = (targetRecord[dependenciesKey] as ServiceDependency[] | undefined) || []
    dependencies.push({ id, index })
    targetRecord[dependenciesKey] = dependencies
  } as ServiceIdentifier<T>

  id.toString = () => serviceId
  serviceIds.set(serviceId, id as ServiceIdentifier<unknown>)
  return id
}

export function refineServiceDecorator<T, TRefined extends T>(serviceIdentifier: ServiceIdentifier<T>): ServiceIdentifier<TRefined> {
  return serviceIdentifier as unknown as ServiceIdentifier<TRefined>
}

export function getServiceDependencies(ctor: unknown): ServiceDependency[] {
  const candidate = ctor as Record<string, unknown>
  const dependencies = candidate[dependenciesKey] as ServiceDependency[] | undefined
  return dependencies ? [...dependencies].sort((a, b) => a.index - b.index) : []
}
