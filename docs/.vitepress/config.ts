import { defineConfig } from 'vitepress'

const repository = 'https://github.com/slime21023/oleo.js'

export default defineConfig({
  title: 'oleo.js',
  description: 'A small, portable HTTP routing and middleware library for TypeScript.',
  // Served from GitHub Pages at https://slime21023.github.io/oleo.js/.
  base: '/oleo.js/',
  cleanUrls: true,
  lastUpdated: true,
  // Examples are embedded into pages with <<<; they are not pages themselves.
  srcExclude: ['examples/**'],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Filters', link: '/filters/', activeMatch: '/filters/' },
      { text: 'Contracts', link: '/contracts/', activeMatch: '/contracts/' },
      { text: 'Runtimes', link: '/runtimes/', activeMatch: '/runtimes/' },
      { text: 'Reference', link: '/reference/api', activeMatch: '/(reference|extending)/' },
      { text: 'Contributing', link: `${repository}/blob/main/CONTRIBUTING.md` },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Routing', link: '/guide/routing' },
          { text: 'Route groups', link: '/guide/groups' },
          { text: 'Middleware and context', link: '/guide/middleware' },
        ],
      },
      {
        text: 'Filters',
        items: [
          { text: 'Overview', link: '/filters/' },
          { text: 'CORS', link: '/filters/cors' },
          { text: 'Bearer authentication', link: '/filters/bearer-auth' },
          { text: 'Problem details', link: '/filters/problem-details' },
          { text: 'Request logging', link: '/filters/request-logger' },
          { text: 'Body size limit', link: '/filters/body-limit' },
          { text: 'Transformations', link: '/filters/transforms' },
        ],
      },
      {
        text: 'Contracts',
        items: [
          { text: 'Contracts', link: '/contracts/' },
          { text: 'Input validation', link: '/contracts/validation' },
          { text: 'OpenAPI generation', link: '/contracts/openapi' },
        ],
      },
      {
        text: 'Runtimes',
        items: [
          { text: 'Overview', link: '/runtimes/' },
          { text: 'Cloudflare Workers', link: '/runtimes/workers' },
          { text: 'Deno', link: '/runtimes/deno' },
          { text: 'Bun', link: '/runtimes/bun' },
          { text: 'Node.js', link: '/runtimes/node' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API overview', link: '/reference/api' },
          { text: 'Routing rules', link: '/reference/routing' },
          { text: 'HTTP semantics', link: '/reference/http-semantics' },
          { text: 'Extension API', link: '/extending/' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
  },
})
