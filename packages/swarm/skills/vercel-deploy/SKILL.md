---
description: Deploy to Vercel using swarm deploy or the Vercel adapter.
tags: [vercel, deploy, devops]
---

# Vercel Deploy

## Prerequisites
- `VERCEL_TOKEN` in environment (or named profile `VERCEL_TOKEN_<PROFILE>`).
- Project must build successfully (`npm run build`).

## CLI
```bash
swarm deploy <project> --provider vercel --profile default
swarm deploy <project> --provider vercel --prod
```

## Dashboard
- Bind deploy target in Settings → Deploy, then use Deploy from the project page.

## Notes
- Framework preset is auto-detected for Next.js, Vite, etc.
- Set env vars in Vercel dashboard or via project `.env` bindings before deploy.
