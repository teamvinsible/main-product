import { envString } from "../config/env-schema.js";

export function googleChatConfigured(): boolean {
  return Boolean(envString("SWARM_GOOGLE_CHAT_WEBHOOK_URL"));
}

/** Post a message via a Google Chat incoming webhook URL (space settings → webhooks). */
export async function sendGoogleChatMessage(text: string): Promise<boolean> {
  const url = envString("SWARM_GOOGLE_CHAT_WEBHOOK_URL");
  if (!url) return false;

  const body = text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyGoogleChatStatus(args: {
  project: string;
  status: string;
  phase?: string;
  detail?: string;
}): Promise<void> {
  if (!googleChatConfigured()) return;
  const lines = [
    `Swarm: ${args.project}`,
    `Status: ${args.status}`,
    args.phase ? `Phase: ${args.phase}` : "",
    args.detail ? args.detail : "",
  ].filter(Boolean);
  await sendGoogleChatMessage(lines.join("\n"));
}
