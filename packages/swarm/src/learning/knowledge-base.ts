import type { KnowledgeBase, Learning, ProjectSummary, LearningCategory } from "../types.js";
import {
  getAllLearnings, upsertLearning, getAllProjectHistory, insertProjectSummary,
} from "../db/store.js";

// Postgres-backed knowledge base. Learnings + history load into memory once via
// init() so the hot-path reads (getLearningsContext during a run) stay sync;
// writes are mirrored to the DB through a serialized write-behind queue.
export class KnowledgeBaseStore {
  private kb: KnowledgeBase = { learnings: [], projectHistory: [], updatedAt: new Date().toISOString() };
  private writeQueue: Promise<unknown> = Promise.resolve();
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.kb.learnings = await getAllLearnings();
    this.kb.projectHistory = await getAllProjectHistory();
    this.loaded = true;
  }

  addLearning(learning: Learning) {
    // Deduplicate: if a very similar insight exists, boost confidence instead.
    const existing = this.kb.learnings.find(
      (l) => l.category === learning.category && this.similarity(l.insight, learning.insight) > 0.8
    );
    let toPersist: Learning;
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.appliedCount++;
      toPersist = existing;
    } else {
      this.kb.learnings.push(learning);
      toPersist = learning;
    }
    this.enqueue(() => upsertLearning(toPersist));
  }

  addProjectSummary(summary: ProjectSummary) {
    this.kb.projectHistory.push(summary);
    this.enqueue(() => insertProjectSummary(summary));
  }

  getLearnings(filter?: { category?: LearningCategory; minConfidence?: number; limit?: number }): Learning[] {
    let result = this.kb.learnings;
    if (filter?.category) result = result.filter((l) => l.category === filter.category);
    if (filter?.minConfidence) result = result.filter((l) => l.confidence >= filter.minConfidence!);
    result = [...result].sort((a, b) => b.confidence * (b.appliedCount + 1) - a.confidence * (a.appliedCount + 1));
    if (filter?.limit) result = result.slice(0, filter.limit);
    return result;
  }

  getProjectHistory(): ProjectSummary[] {
    return this.kb.projectHistory;
  }

  /** Learnings that would be injected into the next agent prompt. */
  learningsForInjection(): Learning[] {
    const categories: LearningCategory[] = [
      "tech-stack", "architecture", "design-pattern", "bug-pattern",
      "best-practice", "anti-pattern", "process",
    ];
    const general = this.getLearnings({ minConfidence: 0.3, limit: 20 })
      .filter((l) => categories.includes(l.category));
    const improvements = this.getLearnings({ category: "process-improvement", limit: 20 });
    const byId = new Map<string, Learning>();
    for (const l of [...improvements, ...general]) byId.set(l.id, l);
    return [...byId.values()];
  }

  /** Adjust confidence after a run validates (or refutes) an injected learning. */
  adjustConfidence(id: string, delta: number): boolean {
    const l = this.kb.learnings.find((x) => x.id === id);
    if (!l) return false;
    l.confidence = Math.max(0.1, Math.min(1, l.confidence + delta));
    l.appliedCount++;
    this.enqueue(() => upsertLearning(l));
    return true;
  }

  // Format learnings as context to inject into agent prompts
  getLearningsContext(relevantCategories?: LearningCategory[]): string {
    const categories = relevantCategories || [
      "tech-stack", "architecture", "design-pattern", "bug-pattern",
      "best-practice", "anti-pattern", "process",
    ];

    const learnings = this.getLearnings({ minConfidence: 0.3, limit: 20 })
      .filter((l) => categories.includes(l.category));

    // Role-targeted directives from past retrospectives. Rendered as their own
    // prominent block; `source` carries the target role so each agent heeds its
    // own directives (its system prompt names its role).
    const improvements = this.getLearnings({ category: "process-improvement", limit: 20 });

    if (learnings.length === 0 && improvements.length === 0) return "";

    const sections: string[] = [];

    if (improvements.length > 0) {
      sections.push("PROCESS IMPROVEMENTS FROM PAST RETROSPECTIVES (if the directive names your role, apply it):");
      for (const l of improvements) {
        sections.push(`- [${l.source}] ${l.insight}`);
      }
    }

    if (learnings.length > 0) {
      if (sections.length) sections.push("");
      sections.push("LEARNINGS FROM PREVIOUS PROJECTS (apply these insights):");
      for (const l of learnings) {
        sections.push(`- [${l.category}] ${l.insight} (confidence: ${(l.confidence * 100).toFixed(0)}%)`);
      }
    }

    return "\n\n" + sections.join("\n");
  }

  getStats() {
    return {
      totalLearnings: this.kb.learnings.length,
      totalProjects: this.kb.projectHistory.length,
      categoryCounts: this.kb.learnings.reduce<Record<string, number>>((acc, l) => {
        acc[l.category] = (acc[l.category] || 0) + 1;
        return acc;
      }, {}),
      avgConfidence: this.kb.learnings.length > 0
        ? this.kb.learnings.reduce((sum, l) => sum + l.confidence, 0) / this.kb.learnings.length
        : 0,
    };
  }

  /** Await all pending write-behind persists (call before process exit). */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private enqueue(fn: () => Promise<unknown>) {
    this.writeQueue = this.writeQueue.then(fn).catch((err) =>
      console.error(`[kb] persist failed: ${err instanceof Error ? err.message : err}`));
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
}
