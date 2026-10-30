# TypeScript Coding Guidelines

Version: 0.2 (core decisions confirmed)  
Scope: modern TypeScript projects, including frontend, Node.js, libraries, and desktop applications.  
Goals: **Readable, Type-safe, Simple, Consistent.**  
Style: **Functions and data first, classes where needed; Result / union types for expected failures, exceptions for unexpected ones.**

## 1. Core Principles

1. **Readability over Brevity**: full, clear names beat abbreviations; straightforward flow beats clever syntax.
2. **Type Safety by Default**: use type inference and static checks to find errors; do not use assertions to hide problems.
3. **Simple Control Flow**: prefer guard clauses / early returns and avoid deep nesting.
4. **Explicit Boundaries**: public APIs, external data, and failure cases should have explicit contracts.
5. **Consistency over Preference**: do not argue by hand about formatting that tools can handle automatically.
6. **Functions & Data First**: express business rules with data and functions first; encapsulate state and lifecycle only as actually needed.

Rule strength:
- **MUST**: required; exceptions need a justification.
- **SHOULD**: the default; may be adjusted based on context.
- **AVOID**: avoid in principle, but not absolutely forbidden.

## 2. Naming and Declarations

- MUST: use `camelCase` for variables and functions; use `PascalCase` for types, interfaces, and classes.
- MUST: use meaningful names; avoid unnecessary abbreviations such as `usr`, `cfg`, and `tmp`.
- SHOULD: give functions verb-oriented names, such as `findUser` and `calculateTotal`.
- SHOULD: prefix booleans with `is`, `has`, `can`, `should`, etc.
- SHOULD: use `const` by default; use `let` when reassignment is needed.
- AVOID: `var`, Hungarian notation, and semantically empty Helper / Manager names.

## 3. Type System

- MUST: enable `strict`; validate untrusted external data at runtime rather than relying on type assertions alone.
- MUST: do not use `any` to evade checks. When truly needed, limit its scope and document the reason.
- SHOULD: use `unknown` for unknown external values and narrow the type after validation.
- SHOULD: allow type inference for local variables; give public functions and module boundaries clear types.
- SHOULD: use `readonly`, literal unions, and discriminated unions where appropriate; use `satisfies` for configuration objects.
- SHOULD: default to `type` for ordinary data shapes and unions; use `interface` when you actually need to extend a contract or use declaration merging. This is a **discussable team choice**, not a language rule.
- AVOID: unnecessary `as T`, the non-null assertion `!`, and overly complex generics and type gymnastics.
- AVOID: using TypeScript types in place of runtime validation of JSON / HTTP / user input.

## 4. Functions and Control Flow

- MUST: a function's name must match its actual responsibility; side effects must not hide behind names that look like pure queries.
- SHOULD: keep each function focused on a single goal that is easy to explain; prefer early returns.
- SHOULD: extract complex conditions into semantically named variables or functions.
- SHOULD: use the ternary operator only for simple value selection that reads at a glance.
- SHOULD: when nesting exceeds two levels, actively consider splitting the function or returning early.
- AVOID: nested ternaries, overly long functions, and semantically meaningless chained transformations.
- AVOID: using hard line limits in place of judgment about responsibility and readability.

For example:

```ts
function getRoleLabel(user: User): string {
  if (!user.isActive) {
    return "Inactive";
  }

  if (user.isAdmin) {
    return "Administrator";
  }

  return "Member";
}
```

## 5. Data, Async, and Errors

### 5.1 Error Semantics

- MUST: use a typed `Result<T, E>` or discriminated union for expected business failures that the caller can handle.
- MUST: propagate unexpected failures (programming defects, violated invariants, unrecoverable system faults) as exceptions; do not silently turn them into success values or vague business errors.
- SHOULD: use a uniform `Result<T, E>` shape for common operation failures; use a discriminated union that describes each state for mutually exclusive states (for example loading / ready / failed).
- SHOULD: use explicit error codes or structured fields; avoid branching on error strings for control flow.
- SHOULD: use `try/catch` at boundaries that can understand and handle the failure; convert only identified, recoverable external failures into expected errors, and let other failures continue to propagate.
- AVOID: wrapping every small function in Result, catching and rethrowing the same exception repeatedly, and empty `catch` blocks.

Minimal shared types:

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

type QuantityError = { code: "INVALID_QUANTITY" };

function validateQuantity(quantity: number): Result<number, QuantityError> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: { code: "INVALID_QUANTITY" } };
  }

  return { ok: true, value: quantity };
}
```

### 5.2 Async and Side Effects

- MUST: every Promise must be awaited, returned, or have its error handling explicitly arranged; it must never be dropped by accident.
- MUST: do not ignore exceptions without cause, and do not use empty `catch` blocks without a reason.
- SHOULD: use `async` / `await` for multi-step async flows; async operations expected to fail may return `Promise<Result<T, E>>`.
- SHOULD: avoid mutating input data in data transformations; keep side effects such as I/O, time, and randomness identifiable.
- AVOID: hiding network requests, global state mutation, or storage writes inside pure data-transformation functions.

**Rule of thumb**: a network timeout or an unavailable database is not automatically a business error; convert it into a typed result only if the API explicitly promises recoverability and the caller handles it.

## 6. Modules and Architecture

- MUST: every module has a describable responsibility; its public types and functions should be small and explicit.
- SHOULD: represent ordinary data structures as `type` / objects; implement business rules as standalone functions and prefer composition.
- SHOULD: separate pure computation and data transformation from I/O boundaries to ease testing.
- SHOULD: use `class` only when there is a concrete need for **state encapsulation, resource lifecycle, or a framework contract**. Examples: Web Components, connection management, or a necessary Error subclass.
- SHOULD: use ES Modules and `import type`; organize files by feature and responsibility.
- AVOID: classes created only to group functions, Java-style getters/setters, deep inheritance, circular dependencies, and semantically empty `helpers.ts` / `utils.ts`.
- AVOID: unconditionally adding Repository, Service, Manager, or other intermediate layers just to match an architectural pattern.

A simple form of functions and data:

```ts
type User = {
  readonly firstName: string;
  readonly lastName: string;
};

function getDisplayName(user: User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}
```

**Do not misread "functions first" as forbidding objects, forbidding state, or mandating pure functions.** The goal is to make data flow and side effects easier to trace, not to pursue purity of any particular paradigm.

## 7. Testing, Comments, and Changes

- MUST: when fixing a bug, add a test that reproduces the failure (where applicable).
- SHOULD: focus tests on observable behavior and boundary conditions; do not bind them to implementation details.
- SHOULD: for Result, test the success path and the main error branches; for exceptions, test that they are thrown, translated, or logged at the correct boundary.
- SHOULD: have comments explain "why, constraints, and trade-offs"; avoid restating what the code is doing.
- SHOULD: keep changes focused; avoid incidental unrelated refactoring.
- AVOID: using excessive comments to compensate for unclear names and function structure.

## 8. Tooling Baseline

Enable the following checks in `tsconfig.json` (integrate with each project's existing compiler options):

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- Use **Prettier** for uniform formatting.
- Use **ESLint + typescript-eslint** for code quality checks. Start from `recommendedTypeChecked`; teams comfortable with TypeScript can then consider `strictTypeChecked`.
- Prioritize checks for unsafe `any`, unhandled Promises, unused variables, and unnecessary type assertions.
- CI should run at least the TypeScript typecheck, ESLint, the Prettier check, and tests.
- If a tool rule conflicts with readability, adjust it explicitly as a team rather than disabling rules widely in code.

## 9. Code Review Quick Checklist

1. Are the names clear? Are there any unnecessary abbreviations?
2. Is the control flow easy to read? Can nesting or ternaries be reduced?
3. Do the types honestly reflect the data? Are there any unsafe assertions?
4. Are Promises, external input, and error paths handled correctly? Are expected failures expressed with Result / union types, and are unexpected exceptions never swallowed?
5. Do abstractions and new files actually reduce complexity? Do tests cover the important behavior?

## 10. Architecture Decisions (Confirmed)

1. **Functions and data first, classes allowed where needed**: pure functions are not mandatory, and classes are not created for form's sake; classes are fine when using state or framework lifecycles.
2. **Result / discriminated unions for expected failures, exceptions for unexpected ones**: Result is for operation outcomes, and unions can express multi-state data; do not wrap every exception in Result.
3. **Still open to per-project discussion**: `type` as the default for ordinary data shapes and `interface` for extensible contracts (currently a recommendation, not a decided hard rule).

### Code Agent Summary

- Write clear names; do not abbreviate to save characters.
- Prefer early returns in control flow; avoid nested ternaries and excessive nesting.
- Keep types honest; do not evade checks with `any`, `as`, or `!`.
- Use data and functions first; use classes and extra abstractions only with a clear reason.
- Return Result / union types for expected failures and let unexpected exceptions propagate correctly.
- Keep changes focused; tooling checks and tests must pass.

## Official References

- TypeScript TSConfig: https://www.typescriptlang.org/tsconfig/
- TypeScript Narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- TypeScript `satisfies`: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html
- typescript-eslint Shared Configs: https://typescript-eslint.io/users/configs/
- typescript-eslint Typed Linting: https://typescript-eslint.io/getting-started/typed-linting/
- Prettier vs Linters: https://prettier.io/docs/comparison
