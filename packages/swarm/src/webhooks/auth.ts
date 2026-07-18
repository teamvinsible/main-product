import crypto from "node:crypto";
import { envList, envString } from "../config/env-schema.js";

export function verifyTelegramSecret(header: string | undefined): boolean {
  const secret = envString("SWARM_TELEGRAM_WEBHOOK_SECRET");
  if (!secret) return true;
  return header === secret;
}

export function isTelegramUserAllowed(userId: number | string): boolean {
  const allowed = envList("SWARM_TELEGRAM_ALLOWED_USERS");
  if (!allowed.length) return true;
  return allowed.includes(String(userId));
}

export function verifyGitHubSignature(payload: string, signature: string | undefined): boolean {
  const secret = envString("SWARM_GITHUB_WEBHOOK_SECRET");
  if (!secret) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const given = signature.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

export function isGitHubRepoAllowed(fullName: string): boolean {
  const allowed = envList("SWARM_GITHUB_ALLOWED_REPOS");
  if (!allowed.length) return true;
  return allowed.some((r) => r.toLowerCase() === fullName.toLowerCase());
}

export function isGoogleChatUserAllowed(email: string): boolean {
  const allowed = envList("SWARM_GOOGLE_CHAT_ALLOWED_USERS");
  if (!allowed.length) return true;
  return allowed.some((u) => u.toLowerCase() === email.toLowerCase());
}

export function isGoogleChatSpaceAllowed(spaceName: string): boolean {
  const allowed = envList("SWARM_GOOGLE_CHAT_ALLOWED_SPACES");
  if (!allowed.length) return true;
  return allowed.some((s) => s === spaceName);
}
