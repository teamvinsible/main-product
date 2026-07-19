import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOrigin, type Env } from "../src/env";

const env = {
  ALLOWED_ORIGINS:
    "https://teamvinsible.com,https://www.teamvinsible.com,https://teamvinsible-web.pages.dev,https://*.teamvinsible-web.pages.dev",
} as Env;

test("exact origins are allowed", () => {
  assert.equal(isAllowedOrigin(env, "https://teamvinsible.com"), true);
  assert.equal(isAllowedOrigin(env, "https://teamvinsible-web.pages.dev"), true);
});

test("pages.dev preview deployments match the wildcard entry", () => {
  assert.equal(isAllowedOrigin(env, "https://e2560dc2.teamvinsible-web.pages.dev"), true);
  assert.equal(isAllowedOrigin(env, "https://a1970d25.teamvinsible-web.pages.dev"), true);
});

test("lookalike and foreign origins are rejected", () => {
  assert.equal(isAllowedOrigin(env, "https://evil.com"), false);
  assert.equal(isAllowedOrigin(env, "https://evilteamvinsible-web.pages.dev"), false);
  assert.equal(isAllowedOrigin(env, "https://a.b.teamvinsible-web.pages.dev"), false);
  assert.equal(isAllowedOrigin(env, "http://e2560dc2.teamvinsible-web.pages.dev"), false);
  assert.equal(isAllowedOrigin(env, ""), false);
});
