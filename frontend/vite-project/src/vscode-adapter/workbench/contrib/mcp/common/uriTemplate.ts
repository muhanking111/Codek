/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IUriTemplateVariable {
  readonly explodable: boolean
  readonly name: string
  readonly optional: boolean
  readonly prefixLength?: number
  readonly repeatable: boolean
}

interface IUriTemplateComponent {
  readonly expression: string
  readonly operator: string
  readonly variables: readonly IUriTemplateVariable[]
}

/**
 * Represents an RFC 6570 URI Template.
 * Source: D:\SourceMirror\vscode\src\vs\workbench\contrib\mcp\common\uriTemplate.ts
 */
export class UriTemplate {
  public readonly components: ReadonlyArray<IUriTemplateComponent | string>

  private constructor(
    public readonly template: string,
    components: ReadonlyArray<IUriTemplateComponent | string>,
  ) {
    this.template = template
    this.components = components
  }

  public static parse(template: string): UriTemplate {
    const components: Array<IUriTemplateComponent | string> = []
    const regex = /\{([^{}]+)\}/g
    let match: RegExpExecArray | null
    let lastPos = 0
    while ((match = regex.exec(template))) {
      const [expression, inner] = match
      components.push(template.slice(lastPos, match.index))
      lastPos = match.index + expression.length

      if (template[match.index - 1] === "{" || template[lastPos] === "}") {
        components.push(inner)
        continue
      }

      let operator = ""
      let rest = inner
      if (rest.length > 0 && UriTemplate.isOperator(rest[0])) {
        operator = rest[0]
        rest = rest.slice(1)
      }
      const variables = rest.split(",").map((value): IUriTemplateVariable => {
        let name = value
        let explodable = false
        let repeatable = false
        let prefixLength: number | undefined
        let optional = false
        if (name.endsWith("*")) {
          explodable = true
          repeatable = true
          name = name.slice(0, -1)
        }
        const prefixMatch = name.match(/^(.*?):(\d+)$/)
        if (prefixMatch) {
          name = prefixMatch[1]
          prefixLength = parseInt(prefixMatch[2], 10)
        }
        if (name.endsWith("?")) {
          optional = true
          name = name.slice(0, -1)
        }
        return { explodable, name, optional, prefixLength, repeatable }
      })
      components.push({ expression, operator, variables })
    }
    components.push(template.slice(lastPos))
    return new UriTemplate(template, components)
  }

  private static readonly operators = ["+", "#", ".", "/", ";", "?", "&"] as const

  private static isOperator(char: string): boolean {
    return (UriTemplate.operators as readonly string[]).includes(char)
  }

  public resolve(variables: Record<string, unknown>): string {
    let result = ""
    for (const component of this.components) {
      result += typeof component === "string" ? component : this.expand(component, variables)
    }
    return result
  }

  private expand(component: IUriTemplateComponent, variables: Record<string, unknown>): string {
    const operator = component.operator
    const isNamed = operator === ";" || operator === "?" || operator === "&"
    const isReserved = operator === "+" || operator === "#"
    const isFragment = operator === "#"
    const isLabel = operator === "."
    const isPath = operator === "/"
    const isForm = operator === "?"
    const isFormCont = operator === "&"
    const isParam = operator === ";"
    const prefix = operator === "#" || operator === "." || operator === ";" || operator === "?" || operator === "&"
      ? operator
      : ""
    const values: string[] = []

    for (const variable of component.variables) {
      const value = variables[variable.name]
      const defined = Object.prototype.hasOwnProperty.call(variables, variable.name)
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        if (isParam && defined) values.push(variable.name)
        else if ((isForm || isFormCont) && defined) values.push(UriTemplate.formPair(variable.name, "", isNamed))
        continue
      }

      if (typeof value === "object" && !Array.isArray(value)) {
        const pairs = objectPairs(value as Record<string, unknown>, variable, { isParam, isForm, isFormCont, isLabel, isPath, isReserved })
        if (variable.explodable) {
          if (isLabel) values.push(pairs.join("."))
          else if (isPath) values.push(pairs.join(""))
          else if (isParam) values.push(pairs.join(";"))
          else if (isForm || isFormCont) values.push(pairs.join("&"))
          else values.push(pairs.join(","))
        } else {
          const flat = flattenObjectPairs(value as Record<string, unknown>).join(",")
          values.push(isParam || isForm || isFormCont ? `${variable.name}=${flat}` : flat)
        }
        continue
      }

      if (Array.isArray(value)) {
        values.push(expandArray(value, variable, { isLabel, isPath, isParam, isForm, isFormCont, isReserved }))
        continue
      }

      let text = String(value)
      if (variable.prefixLength !== undefined) text = text.substring(0, variable.prefixLength)
      const encoded = UriTemplate.encode(text, isReserved)
      if (isParam || isForm || isFormCont) values.push(`${variable.name}=${encoded}`)
      else if (isPath) values.push(`/${encoded}`)
      else values.push(encoded)
    }

    if (isLabel) {
      const filtered = values.filter((value) => value !== "")
      return filtered.length ? prefix + filtered.join(".") : ""
    }
    if (isPath) {
      const filtered = values.filter((value) => value !== "")
      const joined = filtered.length ? filtered.join("") : ""
      return joined && !joined.startsWith("/") ? `/${joined}` : joined
    }
    if (isParam) {
      return values.length ? prefix + values.map((value) => value.replace(/=\s*$/, "")).join(";") : ""
    }
    if (isForm || isFormCont) return values.length ? prefix + values.join("&") : ""
    if (isFragment) return prefix + values.join(",")
    return values.join(",")
  }

  private static encode(value: string, reserved: boolean): string {
    return reserved ? encodeURI(value) : pctEncode(value)
  }

  private static formPair(key: string, value: unknown, named: boolean): string {
    return named ? `${key}=${encodeURIComponent(String(value))}` : encodeURIComponent(String(value))
  }
}

function objectPairs(
  value: Record<string, unknown>,
  variable: IUriTemplateVariable,
  context: { isParam: boolean; isForm: boolean; isFormCont: boolean; isLabel: boolean; isPath: boolean; isReserved: boolean },
): string[] {
  const pairs: string[] = []
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const item = String(value[key])
    if (context.isParam || context.isForm || context.isFormCont || context.isLabel) pairs.push(`${key}=${item}`)
    else if (context.isPath) pairs.push(`/${key}=${pctEncode(item)}`)
    else pairs.push(`${key}=${context.isReserved ? encodeURI(item) : pctEncode(item)}`)
  }
  return pairs
}

function flattenObjectPairs(value: Record<string, unknown>): string[] {
  const pairs: string[] = []
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    pairs.push(key, String(value[key]))
  }
  return pairs
}

function expandArray(
  value: unknown[],
  variable: IUriTemplateVariable,
  context: { isLabel: boolean; isPath: boolean; isParam: boolean; isForm: boolean; isFormCont: boolean; isReserved: boolean },
): string {
  if (variable.explodable) {
    if (context.isLabel) return value.join(".")
    if (context.isPath) return value.map((item) => `/${context.isReserved ? encodeURI(String(item)) : pctEncode(String(item))}`).join("")
    if (context.isParam) return value.map((item) => `${variable.name}=${String(item)}`).join(";")
    if (context.isForm || context.isFormCont) return value.map((item) => `${variable.name}=${String(item)}`).join("&")
    return value.map((item) => context.isReserved ? encodeURI(String(item)) : pctEncode(String(item))).join(",")
  }
  if (context.isLabel) return value.join(",")
  if (context.isParam || context.isForm || context.isFormCont) return `${variable.name}=${value.join(",")}`
  return value.map((item) => context.isReserved ? encodeURI(String(item)) : pctEncode(String(item))).join(",")
}

function pctEncode(value: string): string {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (
      (code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5A)
      || (code >= 0x61 && code <= 0x7A)
      || code === 0x2D
      || code === 0x2E
      || code === 0x5F
      || code === 0x7E
    ) {
      output += value[index]
    } else {
      output += `%${code.toString(16).toUpperCase()}`
    }
  }
  return output
}
