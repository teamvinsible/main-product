import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderedStack } from "../render/types.js";

export interface Layout {
  /** deploy root: docker-compose.yml, Caddyfile, infra-config.json, services/, tofu/ */
  root: string;
  /** where OpenTofu runs (contains the root module + ./modules) */
  tofuDir: string;
}

// Writes a RenderedStack to disk as a deployable directory, plus the packaged
// `modules/` (under tofu/, since module sources are `./modules/*` relative to the
// tofu files) and `services/` trees (referenced by compose as `./services/*`).
export function materialize(stack: RenderedStack, workDir: string, assetsRoot: string = packageRoot()): Layout {
  mkdirSync(workDir, { recursive: true });

  const write = (rel: string, content: string) => {
    const abs = join(workDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };

  for (const f of stack.tofu) write(f.path, f.content);
  write(stack.compose.path, stack.compose.content);
  write(stack.caddy.path, stack.caddy.content);
  write(stack.infraConfig.path, stack.infraConfig.content);

  copyTree(join(assetsRoot, "modules"), join(workDir, "tofu", "modules"));
  copyTree(join(assetsRoot, "services"), join(workDir, "services"));

  return { root: workDir, tofuDir: join(workDir, "tofu") };
}

function copyTree(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(
      `asset directory not found: ${src}. The package must ship 'modules/' and 'services/' ` +
        `(check package.json "files" and the assetsRoot).`,
    );
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Resolve the package root (where modules/ and services/ live) by walking up from
// this file until a package.json is found. Works from dist/ and from src/ (tsx).
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}
