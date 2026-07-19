import { Container, getContainer } from "@cloudflare/containers";
import type { Env } from "../env";

/**
 * Heavy agent runtime (shell-capable, DeepSeek). Image: Dockerfile.runtime
 * Worker talks to it via POST /build JSON.
 */
export class SwarmRuntime extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  override onStart() {
    console.log("SwarmRuntime container started");
  }

  override onStop() {
    console.log("SwarmRuntime container stopped");
  }

  override onError(error: unknown) {
    console.error("SwarmRuntime error", error);
  }
}

export function getSwarmRuntime(env: Env, projectId: string) {
  if (!env.SwarmRuntime) throw new Error("SwarmRuntime binding missing");
  return getContainer(env.SwarmRuntime, projectId);
}
