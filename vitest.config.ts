import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'portable',
          include: ['src/**/*.test.ts'],
          exclude: ['src/node/**'],
        },
      },
      {
        test: {
          name: 'node',
          include: ['src/node/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'types',
          include: [],
          typecheck: {
            enabled: true,
            only: true,
            include: ['src/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
          },
        },
      },
    ],
  },
})
