import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { sendNotificationWebhook } from "../dist/notifications/webhook.js";

test("generic notification webhook is optional", async () => {
  delete process.env.SWARM_NOTIFICATION_WEBHOOK_URL;
  assert.equal(await sendNotificationWebhook({
    project: "demo",
    kind: "run.completed",
    severity: "success",
    title: "Done",
    message: "Ready",
  }), false);
});

test("generic notification webhook sends structured data and bearer auth", async (t) => {
  let received;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = { authorization: request.headers.authorization, body: JSON.parse(body) };
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.notEqual(typeof address, "string");
  process.env.SWARM_NOTIFICATION_WEBHOOK_URL = `http://127.0.0.1:${address.port}/notify`;
  process.env.SWARM_NOTIFICATION_WEBHOOK_TOKEN = "test-token";

  assert.equal(await sendNotificationWebhook({
    project: "demo",
    kind: "run.failed",
    severity: "error",
    title: "Failed",
    message: "Build failed",
  }), true);
  assert.equal(received.authorization, "Bearer test-token");
  assert.equal(received.body.kind, "run.failed");
  assert.equal(received.body.project, "demo");
});
