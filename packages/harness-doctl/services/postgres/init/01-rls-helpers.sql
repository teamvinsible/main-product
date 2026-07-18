-- RLS helpers, applied at DB init. `auth.uid()` reads the JWT `sub` claim that
-- PostgREST/GoTrue set per request, giving you Supabase-style row policies.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', 'web_anon')
$$;

-- ===========================================================================
-- REQUIRED PATTERN — every table you create MUST enable + force RLS and define
-- a policy. The harness `spec/rls-required` gate is the coarse check; this is
-- the shape your migrations follow:
--
--   ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.items FORCE  ROW LEVEL SECURITY;
--   CREATE POLICY items_owner ON public.items
--     USING (owner_id = auth.uid())
--     WITH CHECK (owner_id = auth.uid());
-- ===========================================================================
