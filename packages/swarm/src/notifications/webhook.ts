import { envString } from "../config/env-schema.js";

export async function sendNotificationWebhook(payload: {
  project: string;
  runId?: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const url = envString("SWARM_NOTIFICATION_WEBHOOK_URL");
  if (!url) return false;
  const token = envString("SWARM_NOTIFICATION_WEBHOOK_TOKEN");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...payload, sentAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
