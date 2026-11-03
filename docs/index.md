---
layout: home

hero:
  name: oleojs
  text: HTTP routing and middleware for every runtime
  tagline: Build HTTP services from small functions over the standard Request and Response.
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
  - title: Just functions
    details: Handlers take a Request and return a Response. Routers and middleware are functions too, so they combine the same way.
  - title: Typed routes
    details: Route parameters and the application environment are typed from your patterns and routers, with no annotations.
  - title: Runs everywhere
    details: The same application runs on Cloudflare Workers, Deno, Bun, and Node.js, with zero runtime dependencies.
  - title: Batteries available
    details: Optional CORS, authentication, error, logging, and body-limit filters, plus validated routes with OpenAPI generation.
---
