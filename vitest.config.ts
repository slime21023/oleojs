import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'portable',
          include: ['test/portable/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'node',
          include: ['test/node/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'types',
          include: [],
          typecheck: {
            enabled: true,
            only: true,
            include: ['test/types/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
          },
        },
      },
    ],
  },
})
