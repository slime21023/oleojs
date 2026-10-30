---
name: develop-readable-typescript
description: >-
  Apply readable, type-safe TypeScript engineering practices when implementing,
  modifying, debugging, refactoring, or reviewing TypeScript (.ts and .tsx)
  code. Use for tasks involving naming, control flow, functional and
  data-oriented design, error handling, module boundaries, and code quality.
---

# Develop Readable TypeScript

Write clear, type-safe, maintainable TypeScript. Optimize for understanding and
correctness rather than brevity, cleverness, or architectural ceremony.

## Workflow

1. Inspect relevant files, `package.json`, TypeScript and lint configurations,
   tests, and applicable repository instructions.
2. Read [TypeScript guidelines](references/typescript-guidelines.md) before
   substantive implementation, refactoring, debugging, or review work.
3. Identify the requested behavior, data contracts, and failure paths.
4. Make the smallest coherent change that fulfills the task.
5. Run available type checks, linting, formatting checks, and relevant tests.
6. Review the diff for readability, safety, and unnecessary scope.
7. Report what changed, verification results, and any remaining risks.

Follow explicit user requirements and established project constraints. Treat
this skill as a set of defaults where no conflicting requirement exists.
Do not introduce unrelated refactoring or new dependencies solely for style.

## Readability

- Use meaningful, descriptive names; avoid token-saving abbreviations.
- Name functions after their actual responsibility and observable side effects.
- Prefer guard clauses and early returns to deep nesting.
- Avoid nested ternaries and hard-to-follow chained expressions.
- Extract conditions only when doing so improves clarity.
- Treat nesting depth and function length as review signals, not hard limits.
- Prefer simple, explicit logic over shorter but less readable code.

## Type Safety and Data

- Preserve TypeScript strictness and the project's public contracts.
- Prefer inference for obvious local values and explicit boundary types.
- Avoid `any`, unsafe `as` assertions, and non-null `!` assertions;
  justify narrowly scoped exceptions.
- Treat external input as untrusted; validate at runtime when necessary.
- Prefer discriminated unions for finite states and `readonly` contracts
  for data that must not be modified.
- Avoid complex type-level abstractions without concrete benefits.

## Architecture

- Prefer plain data structures and functions for domain logic.
- Keep pure transformations distinct from I/O and shared mutable state.
- Prefer composition over inheritance and avoid speculative layers.
- Use classes when state ownership, resource lifetime, framework contracts
  (including web components), or error types make them appropriate.
- Avoid classes that merely group static helpers or functions.
- Keep modules cohesive, with minimal exports and no unnecessary wrappers.
- Prefer ES modules and type-only imports for type-only dependencies.
- Respect existing architecture unless the task warrants changing it.

## Failures and Async Work

- Model expected, recoverable operation failures as `Result<T, E>` or
  discriminated unions with structured errors.
- Use discriminated unions for finite application states.
- Propagate unexpected failures with exceptions; do not swallow them.
- Catch and translate only errors a boundary can meaningfully handle.
- Classify network and storage failures by the public contract and whether
  callers can recover; do not blindly convert all exceptions to Result.
- Await, return, or deliberately handle every Promise.
- Prefer `async`/`await` for multi-step asynchronous flows.
- Use `Promise<Result<T, E>>` when async operations have expected failures.
- Do not wrap infallible helpers in Result or catch/rethrow without purpose.

## Task-Specific Checks

### Implementation
- Identify success, expected failure, and unexpected exception paths.
- Add or update behavior-focused tests, including meaningful failure cases.
- Avoid introducing a design pattern without a concrete need.

### Refactoring
- Preserve observable behavior and API contracts, including thrown error
  types and messages; report any unavoidable change explicitly.
- Prefer narrow changes that improve naming, branches, or dependencies.
- Retain necessary stateful and framework patterns.

### Code Review
- Prioritize correctness, unsafe types, hidden side effects, error handling,
  unhandled Promises, unnecessary abstractions, and missing tests.
- Give actionable findings with precise locations and reasons.
- Distinguish material defects from optional stylistic suggestions.

## Verification and Handoff

- Use existing project scripts; inspect their meaning before running them.
- Do not invent commands or change dependencies only to run checks.
- When the project has no TypeScript configuration (for example a standalone
  file), type-check the result with `tsc --strict --noEmit` (or
  `bunx tsc --strict --noEmit`) instead of skipping verification.
- Review names, nesting, type assertions, error paths, and scope after edits.
- State which checks passed, failed, or could not be run.
- Explain justified exceptions instead of silently weakening the standard.

See [the full coding guidelines](references/typescript-guidelines.md) for
MUST/SHOULD/AVOID rules, examples, and compiler/linter recommendations.
