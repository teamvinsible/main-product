import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { AuthUser } from "@teamvinsible/shared";
import { isDevelopment, type Env } from "./env";

// Supabase projects on "JWT signing keys" issue ES256 tokens verified against
// the project JWKS; legacy projects use the HS256 shared secret. Cache the
// JWKS per isolate — jose refetches on unknown kid automatically.
let jwksCache: { url: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

function supabaseJwks(supabaseUrl: string) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  if (!jwksCache || jwksCache.url !== url) {
    jwksCache = { url, jwks: createRemoteJWKSet(new URL(url)) };
  }
  return jwksCache.jwks;
}

export type Authed = {
  user: AuthUser;
  accessToken: string;
};

const DEV_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "dev@localhost",
  displayName: "Local Dev",
  avatarUrl: null,
};

export function authConfigured(env: Env): boolean {
  // SUPABASE_URL alone suffices for asymmetric (JWKS) verification; the JWT
  // secret is only needed for legacy HS256 projects.
  return Boolean(env.SUPABASE_URL || env.SUPABASE_JWT_SECRET);
}

export function serviceClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAuth(request: Request, env: Env): Promise<Authed | Response> {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  const hostname = new URL(request.url).hostname;
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const allowDevBypass = isDevelopment(env) && loopback && env.DEV_AUTH_BYPASS === "true";

  // Explicit local development path without Supabase. It can never activate on a deployed host.
  if (allowDevBypass && !match) {
    return { user: DEV_USER, accessToken: "dev-bypass" };
  }

  if (!match) {
    return new Response(JSON.stringify({ error: "Unauthorized", code: "missing_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = match[1]!.trim();
  if (!authConfigured(env)) {
    if (allowDevBypass) {
      return { user: DEV_USER, accessToken: token };
    }
    return new Response(JSON.stringify({ error: "Auth not configured on API", code: "auth_unconfigured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Supabase user access tokens always carry aud "authenticated" and
    // iss "{project}/auth/v1"; enforcing both rejects service-role and
    // foreign-project tokens.
    const verifyOptions = {
      audience: "authenticated",
      ...(env.SUPABASE_URL
        ? { issuer: `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1` }
        : {}),
    };

    const alg = decodeProtectedHeader(token).alg;
    let payload;
    if (alg === "HS256") {
      if (!env.SUPABASE_JWT_SECRET) throw new Error("HS256 token but no JWT secret configured");
      const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], ...verifyOptions }));
    } else {
      if (!env.SUPABASE_URL) throw new Error("Asymmetric token but no SUPABASE_URL configured");
      ({ payload } = await jwtVerify(token, supabaseJwks(env.SUPABASE_URL), {
        algorithms: ["ES256", "RS256"],
        ...verifyOptions,
      }));
    }

    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) {
      return new Response(JSON.stringify({ error: "Invalid token", code: "invalid_sub" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof (payload as { user_metadata?: { email?: string } }).user_metadata?.email === "string"
          ? (payload as { user_metadata: { email: string } }).user_metadata.email
          : null;

    const meta = (payload as { user_metadata?: Record<string, unknown> }).user_metadata || {};
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      (email ? email.split("@")[0] : null);
    const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : null;

    return {
      accessToken: token,
      user: {
        id: sub,
        email,
        displayName,
        avatarUrl,
      },
    };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid or expired token", code: "invalid_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function isAuthResponse(value: Authed | Response): value is Response {
  return value instanceof Response;
}
