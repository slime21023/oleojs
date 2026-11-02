---
layout: home

hero:
  name: oleojs
  text: HTTP routing and middleware for every runtime
  tagline: Compose applications from functions over native Request and Response, with zero runtime dependencies.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Introduction
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/slime21023/oleojs

features:
  - title: An application is a function
    details: Handlers take a Request and a Context and return a Response. Routers and filters are handlers too, so everything composes the same way.
  - title: Types follow the routes
    details: Route parameters are inferred from patterns through nested groups, and environment requirements of filters combine automatically.
  - title: One app, four runtimes
    details: The portable core uses only ECMA-262 and the WinterTC Minimum Common API. It runs on Cloudflare Workers, Deno, and Bun, and on Node.js through an adapter.
  - title: Optional, independent extensions
    details: Standard filters, validated contracts with OpenAPI 3.1.1, and tooling built on the public extension API stay out of the core.
---
