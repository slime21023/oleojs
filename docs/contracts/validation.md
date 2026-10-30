# Input validation

- Parameters default to `required: true`; path parameters cannot be optional. Optional query/header fields pass `undefined` to the schema when absent. The resulting field remains an own property even when its validated value is undefined.
- Query decoding follows URLSearchParams semantics, including `+` as a space. Repeated occurrences of a declared scalar parameter fail with 422. Undeclared query/header fields are ignored; array query serialization is not supported.
- Header lookup is case-insensitive, while output property names retain the declaration's spelling. Case-insensitive duplicate header declarations are rejected. Native Headers semantics apply to combined values.
- Path values come from the router's decoded parameters; declared names must occur in the full path. Undeclared path parameters remain accessible through `ctx.params`.
- JSON parsing precedes schema validation. A null body returns 400. With a body present, an absent or unsupported media type returns 415; `application/json` is case-insensitive and accepts media type parameters. Empty or malformed JSON returns 400. JSON `null` is parsed successfully and passed to the schema.
- The body is read once. `input.json` holds the validated result; handlers must not read the consumed Request body again. Routes without a JSON declaration leave bodies untouched.
- The contract reads the whole body without a size limit of its own. Install [`bodyLimit`](/filters/body-limit) around contract routes to bound it; an oversized body then returns 413 before parsing.
- Schemas validate sequentially in params, query, headers, json order; fields follow declaration order. Synchronous and asynchronous results are accepted. Every reported issue is collected, but a validator may itself choose to report only one issue.
- Missing required parameters, duplicate scalar queries, and schema failures produce 422. The handler is skipped on all expected input failures. Read failures, validator throws/rejections, malformed schema results, and malformed issues propagate to outer filters instead of becoming client errors.

Validation errors are RFC 9457 problem documents with `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "errors": [
    { "source": "query", "path": ["limit"], "message": "Limit must be between 1 and 100" },
    { "source": "json", "path": ["name"], "message": "Name is required" }
  ]
}
```

`source` is `params`, `query`, `headers`, or `json`. Paths prepend the declared parameter name to the validator's path; JSON issues use the schema path directly. Standard Schema path-segment objects are unwrapped and symbol keys are converted to strings. Messages come from the application-owned validator and must be suitable for clients; oleo does not add raw inputs, stacks, or vendor metadata. A valid failure result has at least one issue; a valid success result has a `value`, which may be undefined, null, false, zero, or an empty string.

Contract-generated 400/415/422 responses do not require `problemDetails()`. Wrap the whole router with that filter to format routing/authentication errors and unexpected exceptions as well. HEAD responses remain bodyless. Request matching/decoding happens first, then group filters, then Contract input validation and the handler; malformed path encoding remains the router's 400 behavior.

