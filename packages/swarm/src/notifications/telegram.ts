import { envString } from "../config/env-schema.js";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(envString("SWARM_TELEGRAM_BOT_TOKEN") && envString("SWARM_TELEGRAM_CHAT_ID"));
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = envString("SWARM_TELEGRAM_BOT_TOKEN");
  const chatId = envString("SWARM_TELEGRAM_CHAT_ID");
  if (!token || !chatId) return false;

  const body = text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyRunStatus(args: {
  project: string;
  status: string;
  phase?: string;
  detail?: string;
}): Promise<void> {
  if (!telegramConfigured()) return;
  const lines = [
    `Swarm: ${args.project}`,
    `Status: ${args.status}`,
    args.phase ? `Phase: ${args.phase}` : "",
    args.detail ? args.detail : "",
  ].filter(Boolean);
  await sendTelegramMessage(lines.join("\n"));
}
