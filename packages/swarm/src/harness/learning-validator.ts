import type { KnowledgeBaseStore } from "../learning/knowledge-base.js";
import type { SwarmMetrics } from "../types.js";

export interface LearningValidationResult {
  boosted: number;
  decayed: number;
}

// Close the learning loop: learnings injected at run start get confidence
// adjusted based on whether the run succeeded.
export function validateLearningOutcomes(args: {
  kb: KnowledgeBaseStore;
  appliedIds: string[];
  success: boolean;
  metrics: SwarmMetrics;
}): LearningValidationResult {
  let boosted = 0;
  let decayed = 0;

  for (const id of args.appliedIds) {
    if (args.success) {
      if (args.kb.adjustConfidence(id, 0.05)) boosted++;
    } else {
      if (args.kb.adjustConfidence(id, -0.1)) decayed++;
    }
  }

  if (!args.success) {
    for (const [role, retries] of Object.entries(args.metrics.agentRetries || {})) {
      if (!retries) continue;
      for (const l of args.kb.getLearnings({ category: "process-improvement" })) {
        if (l.source === role && args.kb.adjustConfidence(l.id, -0.05)) decayed++;
      }
    }
  }

  return { boosted, decayed };
}
