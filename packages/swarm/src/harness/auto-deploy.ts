import { Deployer } from "../deploy/deployer.js";
import { isDeployProvider } from "../deploy/credentials.js";
import type { DeployTarget } from "../deploy/types.js";
import type { SwarmLogger } from "../utils/logger.js";
import type { SwarmState } from "../types.js";
import { deployAutonomyAllowsProd, deployAutonomyAllowsStaging, loadPolicy } from "./policy.js";
import { detectDeployIntent } from "./preflight.js";
import type { WorkGate } from "./work-spec.js";

export async function maybeAutoDeploy(args: {
  workspaceDir: string;
  state: SwarmState;
  request: string;
  logger?: SwarmLogger;
}): Promise<{ deployed: boolean; url?: string; gate: WorkGate }> {
  const policy = loadPolicy();
  const provider = (args.state.deployProvider || "").trim();
  const deployWanted = detectDeployIntent(args.request) || Boolean(provider);

  // PR is the delivery path for change workflows — skip deploy when tracked.
  if (policy.autonomy.skipDeployWhenPrTracked && args.state.prUrl) {
    return {
      deployed: false,
      gate: {
        id: "gate:deploy-staging",
        kind: "gate",
        name: "deploy-staging",
        status: "skipped",
        detail: `PR delivery tracked: ${args.state.prUrl}`,
      },
    };
  }

  if (!deployWanted || !provider || !isDeployProvider(provider)) {
    return {
      deployed: false,
      gate: {
        id: "gate:deploy-staging",
        kind: "gate",
        name: "deploy-staging",
        status: "skipped",
        detail: deployWanted ? "No deploy provider bound" : "Deploy not requested",
      },
    };
  }

  const prodRequested = /\b(prod|production)\b/i.test(args.request);
  if (prodRequested && !deployAutonomyAllowsProd(policy)) {
    return {
      deployed: false,
      gate: {
        id: "gate:deploy-staging",
        kind: "gate",
        name: "deploy-staging",
        status: "skipped",
        detail: "Production deploy requires human approval (swarm.policy.json)",
      },
    };
  }

  if (!prodRequested && !deployAutonomyAllowsStaging(policy)) {
    return {
      deployed: false,
      gate: {
        id: "gate:deploy-staging",
        kind: "gate",
        name: "deploy-staging",
        status: "skipped",
        detail: "Auto staging deploy disabled by policy",
      },
    };
  }

  const deployer = new Deployer(args.workspaceDir, args.logger);
  const result = await deployer.deploy({
    provider,
    profile: args.state.deployProfile || "default",
    target: (args.state.deployTarget || {}) as DeployTarget,
    prod: prodRequested && deployAutonomyAllowsProd(policy),
    runId: args.state.runId,
    repoUrl: args.state.repoUrl,
    defaultBranch: args.state.defaultBranch,
  });

  return {
    deployed: result.ok,
    url: result.url,
    gate: {
      id: "gate:deploy-staging",
      kind: "gate",
      name: prodRequested ? "deploy-production" : "deploy-staging",
      status: result.ok ? "passed" : "failed",
      detail: result.ok ? (result.url || result.detail) : result.detail,
    },
  };
}
