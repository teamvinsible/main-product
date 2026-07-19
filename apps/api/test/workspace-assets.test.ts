import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlRelativeAssets, normalizeWorkspaceAssets, safePath } from "../src/orchestrator/workspace-assets.ts";

describe("safePath", () => {
  it("flattens hallucinated home paths for root assets", () => {
    assert.equal(safePath("home/user/styles.css"), "styles.css");
    assert.equal(safePath("/Users/foo/app.js"), "app.js");
    assert.equal(safePath("./index.html"), "index.html");
  });

  it("keeps nested non-root assets", () => {
    assert.equal(safePath("assets/logo.svg"), "assets/logo.svg");
  });
});

describe("normalizeWorkspaceAssets", () => {
  it("copies misplaced styles.css to the HTML-linked path", async () => {
    const files = new Map<string, string>([
      ["index.html", `<link rel="stylesheet" href="styles.css"/><script src="app.js"></script>`],
      ["home/user/styles.css", "body{color:red}"],
    ]);
    const result = await normalizeWorkspaceAssets({
      list: async () => [...files.keys()],
      get: async (p) => files.get(p) ?? null,
      put: async (p, c) => {
        files.set(p, c);
      },
    });
    assert.ok(result.fixed.some((f) => f.includes("styles.css")));
    assert.equal(files.get("styles.css"), "body{color:red}");
    assert.ok(files.get("app.js")?.includes("auto-generated stub"));
  });
});

describe("htmlRelativeAssets", () => {
  it("ignores absolute URLs", () => {
    const refs = htmlRelativeAssets(
      `<link href="styles.css"/><link href="https://cdn.example/x.css"/><script src="./app.js"></script>`,
    );
    assert.deepEqual(refs.sort(), ["app.js", "styles.css"]);
  });
});
