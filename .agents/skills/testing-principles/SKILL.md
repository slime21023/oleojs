---
name: testing-principles
description: Apply language-agnostic testing principles whenever tests are written, added, updated, run, or reviewed, and whenever a feature, bug fix, refactor, or public API change should be covered by tests, in any programming language or framework. Covers when tests are required, what to cover, deterministic and isolated test design, test doubles, reusing project conventions, and honest reporting of what ran.
---

# Testing Principles

Write tests that prove behavior, fail for one clear reason, and run the same way every time. These principles are independent of language and framework; follow the project's existing test tooling and conventions for the details.

## Workflow

1. Inspect existing tests, the test runner configuration, and naming and layout conventions before writing anything.
2. Decide whether the change requires tests (see "When tests are required").
3. Write or update tests for observable behavior, covering the cases listed under "What to cover".
4. Run the relevant tests with the project's own command. For a bug fix, confirm the new test fails without the fix and passes with it.
5. Review the tests against the checklist below.
6. Report which tests were added, which commands ran, and any result you could not obtain.

Follow explicit user requirements and established project conventions where they conflict with these defaults.

## Rule levels

- **MUST:** Required; state the reason for any exception.
- **SHOULD:** Default approach; depart only for a concrete benefit.
- **AVOID:** Not the default; use only when constraints justify it.

## When tests are required

- **MUST** add or update tests when adding public behavior or fixing a bug.
- **MUST** make a bug-fix test reproduce the defect: it fails before the fix and passes after.
- **SHOULD** add or update tests when changing a public contract, error behavior, or boundary handling.
- **SHOULD** rely on existing tests for a pure refactor, but run them first and confirm they exercise the changed code; add tests where they do not.

## What to cover

- **MUST** test observable behavior through the public interface: inputs, outputs, and externally visible effects.
- **SHOULD** cover, for each behavior: the normal path, boundary values, expected failure paths, and at least one invalid input.
- **SHOULD** add malformed and boundary cases for parsers and anything that handles untrusted input; use property-based or fuzz testing when the language has mature tooling for it.
- **AVOID** testing private implementation details, so refactors do not break tests without changing behavior.

## Test design

- **MUST** keep tests deterministic and independent: control time, randomness, network, filesystem, and environment; never rely on execution order or shared mutable state between tests.
- **SHOULD** give each test one reason to fail and a name that states the scenario and expected outcome.
- **SHOULD** structure each test as setup, action, assertion, with assertions that make a failure self-explanatory.
- **SHOULD** replace only real boundaries (network, storage, clock, external services) with test doubles; keep pure logic real. Prefer simple fakes over interaction-verifying mocks.
- **SHOULD** assert error kind or code rather than full message text.
- **AVOID** asserting on incidental details such as log output, ordering that is not part of the contract, or exact formatting.
- **AVOID** editing a test only to make it pass, skipping or deleting failing tests, and chasing coverage percentages without meaningful assertions.

## Tooling and delivery

- **MUST** reuse the project's existing test framework, layout, and commands. Inspect what a command does before running it.
- **AVOID** adding a dependency solely to write tests.
- **SHOULD**, when no test setup exists, deliver a runnable check script or list the intended test cases with their expected results, and say that no formal tests were run.
- **MUST** report honestly: name what ran and its result, what failed, and what could not be run and why.

## Review checklist

- [ ] Does each new behavior or bug fix have a test, and does the bug-fix test fail without the fix?
- [ ] Do tests assert observable behavior rather than implementation details?
- [ ] Are normal, boundary, expected-failure, and invalid-input cases covered where relevant?
- [ ] Are tests deterministic, independent, and free of hidden shared state?
- [ ] Are doubles used only at real boundaries?
- [ ] Were the tests actually run, and is the result reported accurately?
