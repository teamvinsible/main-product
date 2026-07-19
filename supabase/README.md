# Supabase setup for Teamvinsible

1. Create a project at https://supabase.com
2. SQL editor → run [`migrations/001_platform.sql`](migrations/001_platform.sql)
3. Authentication → Providers → enable **Google** (Client ID / Secret from Google Cloud Console)
4. Authentication → URL configuration:
   - Site URL: `http://127.0.0.1:5173`
   - Redirect URLs: `http://127.0.0.1:5173/auth/callback`
5. Project Settings → API: copy **URL**, **anon key**, **service_role key**, **JWT secret**

Wire into:

- `apps/web/.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_MOCK=false`
- `apps/api/.dev.vars` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- Set `DEV_AUTH_BYPASS = "false"` in `apps/api/wrangler.toml` once Supabase is live
