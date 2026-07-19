import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseSpec, renderPlan, runGates, computeRequiredEnv, buildDotenv } from "../src/index.js";

const example = await readFile(new URL("../examples/project.spec.yaml", import.meta.url), "utf8");

test("example spec parses into a resource graph", () => {
  const result = parseSpec(example);
  assert.deepEqual(result.errors, []);
  assert.equal(result.graph?.project, "acme-saas");
  assert.ok(result.graph?.nodes["db:main"]);
  assert.ok(result.graph?.nodes["svc:api"]);
});

test("invalid YAML and invalid specs return structured errors", () => {
  assert.equal(parseSpec("project: [").graph, null);
  const invalid = parseSpec("project: Bad Name\nservices: {}\nresources: {}\n");
  assert.equal(invalid.graph, null);
  assert.ok(invalid.errors.length > 0);
});

test("rendered development stack passes mandatory in-process gates", async () => {
  const { spec, graph } = parseSpec(example);
  assert.ok(spec && graph);
  const stack = renderPlan(graph, { region: spec.region, prod: false });
  const report = await runGates(stack);
  assert.equal(report.ok, true);
  assert.ok(report.results.some((result) => result.id === "compose/db-no-public-port" && result.level === "pass"));
  assert.ok(report.results.some((result) => result.id === "compose/images-pinned"));
});

test("gates reject a database host port", async () => {
  const { spec, graph } = parseSpec(example);
  assert.ok(spec && graph);
  const stack = renderPlan(graph, { region: spec.region, prod: false });
  stack.compose.content = stack.compose.content.replace(
    "postgres_main:\n",
    "postgres_main:\n    ports:\n      - 5432:5432\n",
  );
  const report = await runGates(stack);
  assert.equal(report.ok, false);
  assert.ok(report.results.some((result) => result.id === "compose/db-no-public-port" && result.level === "error"));
});

test("secret requirements and dotenv escaping are deterministic", () => {
  const { spec, graph } = parseSpec(example);
  assert.ok(spec && graph);
  const stack = renderPlan(graph, { region: spec.region, prod: false });
  const names = computeRequiredEnv(stack);
  assert.deepEqual([...names].sort(), names);
  assert.ok(names.includes("PG_PASSWORD"));
  assert.equal(buildDotenv({ SIMPLE: "ok", COMPLEX: 'a b"c' }), 'SIMPLE=ok\nCOMPLEX="a b\\"c"\n');
});
