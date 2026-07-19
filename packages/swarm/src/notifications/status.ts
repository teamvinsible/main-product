import { createNotification } from "../db/store.js";
import { notifyGoogleChatStatus } from "./google-chat.js";
import { sendNotificationWebhook } from "./webhook.js";

export async function notifyRunStatus(args: {
  project: string;
  runId?: string;
  status: string;
  phase?: string;
  detail?: string;
}): Promise<void> {
  const severity = args.status === "failed"
    ? "error"
    : args.status === "completed" || args.status === "ready"
      ? "success"
      : args.status === "awaiting_input"
        ? "warning"
        : "info";
  const title = args.status === "awaiting_input" ? "Input needed" : `Run ${args.status.replaceAll("_", " ")}`;
  const message = args.detail || (args.phase ? `${args.project} is in ${args.phase}.` : `${args.project} is ${args.status}.`);
  const payload = {
    project: args.project,
    runId: args.runId,
    kind: `run.${args.status}`,
    severity,
    title,
    message,
    metadata: { phase: args.phase, status: args.status },
  } as const;

  await Promise.allSettled([
    createNotification(payload),
    sendNotificationWebhook(payload),
    notifyGoogleChatStatus(args),
  ]);
}
