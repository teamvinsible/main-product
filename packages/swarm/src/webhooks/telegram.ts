import type http from "node:http";
import { handleSwarmCommand } from "./commands.js";
import { sendTelegramMessage } from "../notifications/telegram.js";
import { isTelegramUserAllowed, verifyTelegramSecret } from "./auth.js";

interface TelegramUpdate {
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; first_name?: string };
    chat: { id: number };
  };
}

export async function handleTelegramWebhook(
  body: string,
  headers: http.IncomingHttpHeaders,
  spawnRun: (args: string[]) => { pid?: number },
): Promise<{ status: number; body: string }> {
  if (!verifyTelegramSecret(headers["x-telegram-bot-api-secret-token"] as string | undefined)) {
    return { status: 403, body: JSON.stringify({ error: "Invalid webhook secret" }) };
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(body) as TelegramUpdate;
  } catch {
    return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const msg = update.message;
  if (!msg?.text?.trim()) {
    return { status: 200, body: JSON.stringify({ ok: true }) };
  }

  const userId = msg.from?.id;
  if (userId !== undefined && !isTelegramUserAllowed(userId)) {
    await sendTelegramMessage("Unauthorized user.");
    return { status: 200, body: JSON.stringify({ ok: true }) };
  }

  const result = await handleSwarmCommand(msg.text.trim());
  if (result.spawnArgs?.length) spawnRun(result.spawnArgs);

  await fetch(`https://api.telegram.org/bot${process.env.SWARM_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: msg.chat.id, text: result.reply }),
  }).catch(() => {});

  return { status: 200, body: JSON.stringify({ ok: true }) };
}
