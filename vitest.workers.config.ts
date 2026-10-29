import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: { compatibilityDate: '2026-10-01' },
    }),
  ],
  test: {
    name: 'workerd',
    include: ['src/**/*.test.ts'],
    exclude: ['src/node/**'],
  },
})
