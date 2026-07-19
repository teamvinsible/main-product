import assert from "node:assert/strict";
import test from "node:test";
import { isReservedSlug, slugFromHost } from "../src/publish";

test("reserved slugs cover platform infrastructure hosts", () => {
  for (const slug of ["api", "www", "admin", "staging", "mail", "cdn"]) {
    assert.equal(isReservedSlug(slug), true, `${slug} should be reserved`);
    assert.equal(isReservedSlug(slug.toUpperCase()), true, `${slug} should be reserved case-insensitively`);
  }
  assert.equal(isReservedSlug("my-cool-app"), false);
});

test("slugFromHost resolves published subdomains only", () => {
  assert.equal(slugFromHost("my-app.teamvinsible.com", "teamvinsible.com"), "my-app");
  assert.equal(slugFromHost("teamvinsible.com", "teamvinsible.com"), null);
  assert.equal(slugFromHost("www.teamvinsible.com", "teamvinsible.com"), null);
  // Reserved names are platform hosts, not published apps.
  assert.equal(slugFromHost("api.teamvinsible.com", "teamvinsible.com"), null);
  // Nested subdomains are not publish slugs.
  assert.equal(slugFromHost("a.b.teamvinsible.com", "teamvinsible.com"), null);
  // Unrelated hosts do not match.
  assert.equal(slugFromHost("evil-teamvinsible.com", "teamvinsible.com"), null);
});
