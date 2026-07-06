/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/product/common/productService.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from "../../instantiation/common/instantiation"

export interface IProductConfiguration {
  readonly nameShort?: string
  readonly nameLong?: string
  readonly applicationName?: string
  readonly dataFolderName?: string
  readonly version?: string
  readonly commit?: string
  readonly quality?: string
  readonly urlProtocol?: string
  readonly serverApplicationName?: string
  readonly tunnelApplicationName?: string
  readonly licenseName?: string
  readonly licenseUrl?: string
  readonly reportIssueUrl?: string
  readonly documentationUrl?: string
  readonly updateUrl?: string
  readonly extensionsGallery?: unknown
  readonly [key: string]: unknown
}

export interface IProductService extends Readonly<IProductConfiguration> {
  readonly _serviceBrand: undefined
}

export const IProductService = createDecorator<IProductService>("productService")
export const productSchemaId = "vscode://schemas/vscode-product"

export const codekProductMetadata = Object.freeze({
  nameShort: "Codek",
  nameLong: "Codek",
  applicationName: "codek",
  dataFolderName: ".codek",
  version: "0.0.0",
  quality: "oss",
  urlProtocol: "codek",
  serverApplicationName: "codek-server",
  tunnelApplicationName: "codek-tunnel",
  licenseName: "MIT",
  documentationUrl: "https://github.com/codek",
} satisfies Readonly<IProductConfiguration>)

export function createCodekProductService(overrides: Partial<IProductConfiguration> = {}): IProductService {
  return Object.freeze({
    _serviceBrand: undefined,
    ...codekProductMetadata,
    ...overrides,
  })
}

export const defaultCodekProductService: IProductService = createCodekProductService()
