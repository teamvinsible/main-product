import { notifyGoogleChatStatus } from "./google-chat.js";
import { notifyRunStatus as notifyTelegramStatus } from "./telegram.js";

export async function notifyRunStatus(args: {
  project: string;
  status: string;
  phase?: string;
  detail?: string;
}): Promise<void> {
  await Promise.allSettled([
    notifyTelegramStatus(args),
    notifyGoogleChatStatus(args),
  ]);
}
