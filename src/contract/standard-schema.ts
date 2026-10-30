/** Structural interfaces for https://standardschema.dev/; no runtime dependency is required. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly jsonSchema?: {
      readonly input: (options: { readonly target: string }) => Record<string, unknown>
      readonly output: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}

/** Success includes a value even when it is undefined; failure contains issues. */
export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] }

/** A validator's public message and optional location within its input. */
export interface StandardIssue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

export type SchemaOutput<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['output']
