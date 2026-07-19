import type { Sandbox } from "@cloudflare/sandbox";
import type { MediatorAgent } from "./agents/mediator";
import type { DomainAgent } from "./agents/domain-agent";
import type { SwarmRuntime } from "./containers/swarm-runtime";
import type { CrewRunParams } from "./workflows/crew-run";

// Wrangler generates the deployed binding surface via `npm run cf:types`; this
// interface adds secrets and RPC class generics that configuration cannot infer.
export interface Env {
  ENVIRONMENT?: "development" | "production" | "test";
  SWARM_ORIGIN?: string;
  PLATFORM_HOST: string;
  SWARM_DASHBOARD_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  DEV_AUTH_BYPASS?: string;
  LEGACY_SWARM?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  DISPATCH_NAMESPACE?: string;
  DB?: D1Database;
  WORKSPACES?: R2Bucket;
  RUN_QUEUE?: Queue;
  Mediator?: DurableObjectNamespace<MediatorAgent>;
  DomainAgent?: DurableObjectNamespace<DomainAgent>;
  Sandbox?: DurableObjectNamespace<Sandbox>;
  SwarmRuntime?: DurableObjectNamespace<SwarmRuntime>;
  CREW_WORKFLOW?: Workflow<CrewRunParams>;
  DISPATCHER?: DispatchNamespace;
  RUN_RATE_LIMITER?: RateLimit;
  DISPATCH_LEGACY?: { get(name: string): { fetch: typeof fetch } };
}

export function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === "development";
}

export function missingCoreBindings(env: Env): string[] {
  const bindings: Array<[string, unknown]> = [
    ["DB", env.DB],
    ["WORKSPACES", env.WORKSPACES],
    ["RUN_QUEUE", env.RUN_QUEUE],
    ["Mediator", env.Mediator],
    ["DomainAgent", env.DomainAgent],
    ["CREW_WORKFLOW", env.CREW_WORKFLOW],
    ["RUN_RATE_LIMITER", env.RUN_RATE_LIMITER],
  ];
  return bindings.filter(([, value]) => !value).map(([name]) => name);
}

export function allowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173";
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  if (origin && allowedOrigins(env).includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };
  }
  return {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export function json(env: Env, request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, request) },
  });
}

export function useLegacySwarm(env: Env): boolean {
  return env.LEGACY_SWARM === "true" && Boolean(env.SWARM_ORIGIN);
}
