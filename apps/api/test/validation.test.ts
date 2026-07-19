import assert from "node:assert/strict";
import test from "node:test";
import { readJsonObject, RequestError, slugField, stringField } from "../src/validation";

test("readJsonObject rejects bodies larger than the configured limit", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ idea: "x".repeat(100) }),
  });
  await assert.rejects(() => readJsonObject(request, 32), (error) => {
    assert.equal(error instanceof RequestError, true);
    assert.equal((error as RequestError).status, 413);
    return true;
  });
});

test("string and slug validation reject malformed input", () => {
  assert.throws(() => stringField({}, "idea", { required: true }), RequestError);
  assert.equal(stringField({ name: "  project  " }, "name"), "project");
  assert.equal(slugField({ slug: "valid-slug-2" }), "valid-slug-2");
  assert.throws(() => slugField({ slug: "Not Valid" }), RequestError);
});
