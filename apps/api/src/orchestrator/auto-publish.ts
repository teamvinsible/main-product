import type { Env } from "../env";
import { publishProject, type PublishResult } from "../publish";
import { cfSetPreview } from "./cf";

/**
 * Publish-first live URL: copy workspace → R2 edge and store the shareable URL
 * on the project / Mediator. Used when a crew run finishes (no Sandbox required).
 */
export async function autoPublishProject(
  env: Env,
  opts: {
    userId: string;
    projectId: string;
    swarmName: string;
    title: string;
  },
): Promise<PublishResult | null> {
  if (!env.WORKSPACES) return null;

  const result = await publishProject(env, {
    userId: opts.userId,
    projectId: opts.projectId,
    swarmName: opts.swarmName,
    title: opts.title,
    slug: opts.swarmName,
  });

  if (result.ok) {
    await cfSetPreview(env, opts.projectId, result.url, null, "published");
  } else {
    console.warn(
      JSON.stringify({
        event: "auto_publish.failed",
        projectId: opts.projectId,
        message: result.message,
      }),
    );
  }

  return result;
}
