---
description: Next.js App Router patterns for server components, routing, and data fetching.
tags: [nextjs, react, frontend]
---

# Next.js App Router

## Routing
- Use the `app/` directory with `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`.
- Prefer Server Components by default; add `"use client"` only when hooks or browser APIs are required.

## Data fetching
- Fetch in Server Components with `async` components or `fetch()` with Next cache options.
- Use Route Handlers in `app/api/` for REST endpoints.

## Common pitfalls
- Do not import server-only modules into client components.
- Colocate `loading.tsx` for slow routes.
- Run `npm run build` before marking work complete — App Router errors often surface only at build time.
