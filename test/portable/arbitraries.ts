import fc from 'fast-check'

// A fixed seed keeps the same generated cases across the runtime matrix.
export const PROPERTY_OPTIONS = { seed: 20261029, numRuns: 300 }

export const paramNameArbitrary = fc.oneof(
  fc.constantFrom('__proto__', 'constructor', 'toString', '$id', '名字'),
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,12}$/),
)

// Exclude bare dot segments: Request normalizes those before routing.
export const paramValueArbitrary = fc
  .array(fc.constantFrom('a', 'Z', '0', ' ', '/', '%', 'é', '中', '🙂', '?', '#', '\u0000'), {
    minLength: 1,
    maxLength: 20,
  })
  .map((characters) => characters.join(''))

export const staticSegmentArbitrary = fc.oneof(
  fc.constantFrom('café', 'a b', '中', 'a#b'),
  fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/),
)
