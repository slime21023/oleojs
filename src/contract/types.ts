import type { Context, Params } from '../types.ts'
import type { SchemaOutput, StandardSchemaV1 } from './standard-schema.ts'

/** A scalar HTTP input. Required by default; optional inputs still validate undefined. */
export interface ContractParameter {
  readonly schema: StandardSchemaV1
  readonly required?: boolean
  readonly description?: string
}

/** Only declared sources are extracted. JSON bodies are required and consumed once. */
export interface ContractRequest {
  readonly params?: Readonly<Record<string, ContractParameter>>
  readonly query?: Readonly<Record<string, ContractParameter>>
  readonly headers?: Readonly<Record<string, ContractParameter>>
  readonly json?: StandardSchemaV1
}

// Distribute over unions before mapping optional sources and fields.
type ParameterValue<P> = P extends ContractParameter ? SchemaOutput<P['schema']> : undefined

type SourceInput<S> = S extends StandardSchemaV1 ? SchemaOutput<S>
  : { readonly [F in keyof S]: ParameterValue<S[F]> }

/** Data after validation, including schema transformations and defaults. */
export type ContractInput<R extends ContractRequest> = {
  readonly [K in keyof R]: SourceInput<R[K]>
}

/** A handler still owns native response construction; response contracts describe documentation only. */
export type ContractHandler<E, P extends Params, R extends ContractRequest> =
  (request: Request, ctx: Context<E, P>, input: ContractInput<R>) => Response | Promise<Response>

/** A documented response; no runtime validation or body reading is performed. */
export interface ContractResponse {
  readonly description: string
  readonly content?: Readonly<Record<string, { readonly schema: StandardSchemaV1 }>>
}

/** Scheme names mapped to OAuth2/OpenID Connect scopes or role names for other schemes. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>

/** An HTTP route and its input/documentation contract. */
export interface ContractDefinition<P extends string = string, R extends ContractRequest = ContractRequest> {
  readonly method: string
  readonly path: P
  readonly operationId: string
  readonly summary?: string
  readonly request?: R
  readonly responses: Readonly<Record<number, ContractResponse> & { default?: ContractResponse }>
  readonly security?: readonly SecurityRequirement[]
}

/** A public validation failure; raw input and validator metadata are not copied. */
export interface ContractIssue {
  readonly source: keyof ContractRequest
  readonly path: readonly (string | number)[]
  readonly message: string
}

/** JSON Schema 2020-12. Keywords are supplied by the application's schema exporter. */
export type JsonSchema = boolean | Readonly<Record<string, unknown>>

interface OAuthFlow {
  readonly authorizationUrl?: string
  readonly tokenUrl?: string
  readonly refreshUrl?: string
  readonly scopes: Readonly<Record<string, string>>
}

/** OpenAPI authentication metadata; it never installs authentication middleware. */
export type SecurityScheme = (
  | { readonly type: 'http'; readonly scheme: string; readonly bearerFormat?: string }
  | { readonly type: 'apiKey'; readonly name: string; readonly in: 'query' | 'header' | 'cookie' }
  | { readonly type: 'oauth2'; readonly flows: Readonly<Partial<Record<'implicit' | 'password' | 'clientCredentials' | 'authorizationCode', OAuthFlow>>> }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string }
  | { readonly type: 'mutualTLS' }
) & { readonly description?: string }

/** Settings for synchronous OpenAPI generation. A supplied converter overrides native export. */
export interface OpenApiOptions {
  readonly info: { readonly title: string; readonly version: string; readonly description?: string }
  readonly securitySchemes?: Readonly<Record<string, SecurityScheme>>
  readonly toJsonSchema?: (schema: StandardSchemaV1, direction: 'input' | 'output') => JsonSchema
}

export interface OpenApiResponse {
  readonly description: string
  readonly content?: Readonly<Record<string, { readonly schema: JsonSchema }>>
}

export interface OpenApiParameter {
  readonly name: string
  readonly in: 'path' | 'query' | 'header'
  readonly required: boolean
  readonly description?: string
  readonly schema: JsonSchema
}

export interface OpenApiOperation {
  readonly operationId: string
  readonly summary?: string
  readonly parameters?: readonly OpenApiParameter[]
  readonly requestBody?: { readonly required: true; readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>> }
  readonly responses: Readonly<Record<string, OpenApiResponse>>
  readonly security?: readonly SecurityRequirement[]
}

export type OpenApiMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

/** A standalone description; generating it performs no requests or handler/filter execution. */
export interface OpenApiDocument {
  readonly openapi: '3.1.1'
  readonly info: OpenApiOptions['info']
  readonly paths: Readonly<Record<string, Readonly<Partial<Record<OpenApiMethod, OpenApiOperation>>>>>
  readonly components?: { readonly securitySchemes: Readonly<Record<string, SecurityScheme>> }
}
