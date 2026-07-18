import crypto from "node:crypto";
import { envBool, envString } from "../config/env-schema.js";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CHAT_X509_URL = `https://www.googleapis.com/service_accounts/v1/metadata/x509/${CHAT_ISSUER}`;
const OIDC_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let x509Cache: { certs: Record<string, string>; expires: number } | null = null;
let jwksCache: { keys: Array<Record<string, string>>; expires: number } | null = null;

function decodePart(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cacheTtlMs(res: Response, fallbackMs: number): number {
  const match = (res.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  return match ? Number(match[1]) * 1000 : fallbackMs;
}

async function getX509Certs(): Promise<Record<string, string>> {
  if (x509Cache && Date.now() < x509Cache.expires) return x509Cache.certs;
  const res = await fetch(CHAT_X509_URL);
  if (!res.ok) throw new Error(`Failed to fetch Chat x509 certs: ${res.status}`);
  const certs = await res.json() as Record<string, string>;
  x509Cache = { certs, expires: Date.now() + cacheTtlMs(res, 3_600_000) };
  return certs;
}

async function getOidcJwks(): Promise<Array<Record<string, string>>> {
  if (jwksCache && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(OIDC_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch OIDC JWKS: ${res.status}`);
  const raw = await res.json() as { keys?: Array<Record<string, string>> };
  const keys = raw.keys || [];
  jwksCache = { keys, expires: Date.now() + cacheTtlMs(res, 3_600_000) };
  return keys;
}

function verifyRs256(token: string, key: crypto.KeyObject): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  try {
    return verifier.verify(key, parts[2], "base64url");
  } catch {
    return false;
  }
}

async function verifyProjectNumberToken(token: string, projectNumber: string): Promise<boolean> {
  const header = decodePart(token.split(".")[0] || "");
  const payload = decodePart(token.split(".")[1] || "");
  if (!header || !payload) return false;
  if (String(payload.iss) !== CHAT_ISSUER) return false;
  if (String(payload.aud) !== projectNumber) return false;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return false;

  const kid = String(header.kid || "");
  const certs = await getX509Certs();
  const pem = certs[kid];
  if (!pem) return false;
  return verifyRs256(token, crypto.createPublicKey(pem));
}

async function verifyAppUrlToken(token: string, audienceUrl: string): Promise<boolean> {
  const parts = token.split(".");
  const header = decodePart(parts[0] || "");
  const payload = decodePart(parts[1] || "");
  if (!header || !payload) return false;
  if (payload.email && String(payload.email) !== CHAT_ISSUER) return false;
  if (String(payload.aud) !== audienceUrl) return false;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return false;

  const kid = String(header.kid || "");
  const keys = await getOidcJwks();
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk?.n || !jwk?.e) return false;
  const key = crypto.createPublicKey({ key: { ...jwk, kty: "RSA" }, format: "jwk" });
  return verifyRs256(token, key);
}

/** Verify Google Chat Authorization bearer token. */
export async function verifyGoogleChatBearer(authHeader: string | undefined): Promise<boolean> {
  if (envBool("SWARM_GOOGLE_CHAT_SKIP_VERIFY")) return true;

  const audienceUrl = envString("SWARM_GOOGLE_CHAT_AUDIENCE_URL");
  const projectNumber = envString("SWARM_GOOGLE_CHAT_PROJECT_NUMBER");
  if (!audienceUrl && !projectNumber) return false;

  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  try {
    if (audienceUrl) return await verifyAppUrlToken(token, audienceUrl);
    return await verifyProjectNumberToken(token, projectNumber);
  } catch {
    return false;
  }
}
