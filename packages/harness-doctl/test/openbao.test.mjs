import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { OpenBaoProvider, SecretsError } from "../dist/index.js";

test("OpenBao provider reads KV v2 values without leaking metadata", async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.headers["x-vault-token"], "test-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: { data: { PG_PASSWORD: "secret", PORT: 5432 }, metadata: { version: 1 } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new OpenBaoProvider({ addr: `http://127.0.0.1:${address.port}`, path: "secret/data/acme", token: "test-token" });
  assert.deepEqual(await provider.resolve(), { PG_PASSWORD: "secret", PORT: "5432" });
});

test("OpenBao provider requires authentication", async () => {
  const previous = process.env.BAO_TOKEN;
  delete process.env.BAO_TOKEN;
  try {
    await assert.rejects(
      new OpenBaoProvider({ addr: "http://127.0.0.1:1", path: "secret/acme" }).resolve(),
      (error) => error instanceof SecretsError && /token missing/.test(error.message),
    );
  } finally {
    if (previous !== undefined) process.env.BAO_TOKEN = previous;
  }
});
