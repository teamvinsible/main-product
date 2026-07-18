import type http from "node:http";
import { handleSwarmCommand } from "./commands.js";
import { isGoogleChatSpaceAllowed, isGoogleChatUserAllowed } from "./auth.js";
import { verifyGoogleChatBearer } from "./google-chat-auth.js";

interface GoogleChatUser {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

interface GoogleChatSpace {
  name?: string;
  type?: string;
  displayName?: string;
}

interface GoogleChatMessage {
  text?: string;
  argumentText?: string;
  sender?: GoogleChatUser;
}

interface GoogleChatEvent {
  type?: string;
  eventTime?: string;
  message?: GoogleChatMessage;
  space?: GoogleChatSpace;
  user?: GoogleChatUser;
}

function extractCommandText(message?: GoogleChatMessage): string {
  const raw = message?.argumentText?.trim() || message?.text?.trim() || "";
  return raw.replace(/^@\S+\s+/, "").trim();
}

function chatResponse(text: string, status = 200): { status: number; body: string } {
  return { status, body: JSON.stringify({ text }) };
}

export async function handleGoogleChatWebhook(
  body: string,
  headers: http.IncomingHttpHeaders,
  spawnRun: (args: string[]) => { pid?: number },
): Promise<{ status: number; body: string }> {
  if (!(await verifyGoogleChatBearer(headers.authorization as string | undefined))) {
    return { status: 401, body: JSON.stringify({ error: "Invalid Google Chat authorization" }) };
  }

  let event: GoogleChatEvent;
  try {
    event = JSON.parse(body) as GoogleChatEvent;
  } catch {
    return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const spaceName = event.space?.name || "";
  if (spaceName && !isGoogleChatSpaceAllowed(spaceName)) {
    return chatResponse("This space is not authorized to use Agent Swarm.");
  }

  if (event.type === "ADDED_TO_SPACE") {
    return chatResponse(
      "Agent Swarm is ready.\n\nCommands:\n• /run <idea>\n• /change <project> <request>\n• /status [project]\n• /resume <project>",
    );
  }

  if (event.type !== "MESSAGE" || !event.message) {
    return { status: 200, body: JSON.stringify({}) };
  }

  const sender = event.message.sender || event.user;
  if (sender?.type === "BOT") {
    return { status: 200, body: JSON.stringify({}) };
  }

  const email = sender?.email || "";
  if (email && !isGoogleChatUserAllowed(email)) {
    return chatResponse("Unauthorized user.");
  }

  const text = extractCommandText(event.message);
  if (!text) {
    return { status: 200, body: JSON.stringify({}) };
  }

  const result = await handleSwarmCommand(text);
  if (result.spawnArgs?.length) spawnRun(result.spawnArgs);
  return chatResponse(result.reply);
}
