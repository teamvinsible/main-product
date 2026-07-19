import type { DomainAgentNode, SpineStage } from "@teamvinsible/shared";

/**
 * Agency pod workflow — Idea → Growth.
 *
 * Maps the functional org chart into a linear crew run. SpineStage buckets stay
 * coarse for the dashboard; individual phases carry the real handoff labels.
 *
 *   Strategy → Design → Architecture → Engineering → Quality → DevOps → Launch → Growth
 */
export type CrewPhase = {
  stage: SpineStage;
  phase: string;
  agentId: string;
  label: string;
  /** Short brief injected into the markdown artifact prompt. */
  briefHint: string;
};

export const CREW_PHASES: CrewPhase[] = [
  {
    stage: "drafting",
    phase: "strategy",
    agentId: "product",
    label: "Strategy & product",
    briefHint:
      "Act as Business Analyst + Product Manager (+ light SEO). Document problem, goals, user stories, acceptance criteria, and search/intent notes for later growth.",
  },
  {
    stage: "drafting",
    phase: "design",
    agentId: "design",
    label: "Design & UX",
    briefHint:
      "Act as UX researcher + UI/UX designer (+ analytics placeholders). Cover flows, mobile/desktop layout, friction points, and CTR/tracking slots.",
  },
  {
    stage: "cross-review",
    phase: "architecture",
    agentId: "architect",
    label: "Architecture",
    briefHint:
      "Act as principal software architect (+ data notes). Choose stack, data model, sync strategy, API endpoints, and system boundaries.",
  },
  {
    stage: "cross-review",
    phase: "eng-backend",
    agentId: "eng",
    label: "Backend engineering",
    briefHint:
      "Act as backend developer. Specify APIs, data access, auth, and server responsibilities that the frontend will call.",
  },
  {
    stage: "cross-review",
    phase: "eng-frontend",
    agentId: "eng",
    label: "Frontend engineering",
    briefHint:
      "Act as frontend developer. Implement the visible UI against the architecture and backend contracts; this phase owns the app build.",
  },
  {
    stage: "consolidating",
    phase: "qa",
    agentId: "qa",
    label: "Quality assurance",
    briefHint:
      "Act as QA (manual + automation mindset). List test scenarios, edge cases, regressions to guard, and device/browser checks.",
  },
  {
    stage: "consolidating",
    phase: "devops",
    agentId: "devops",
    label: "DevOps & release",
    briefHint:
      "Act as DevOps / SRE. Cover CI/CD, staging→prod, autoscaling/reliability notes, and workspace completeness for ship.",
  },
  {
    stage: "ready",
    phase: "launch",
    agentId: "marketing",
    label: "Launch & marketing",
    briefHint:
      "Act as launch marketing (SEO + content + social + paid). Draft launch checklist, messaging, and traffic channels for go-live.",
  },
  {
    stage: "ready",
    phase: "growth",
    agentId: "growth",
    label: "Growth & analytics",
    briefHint:
      "Act as growth / web analyst. Define success metrics, instrumentation checks, and post-launch optimization experiments.",
  },
];

/** Pod roster — Mediator is the project lead; others are functional specialists. */
export function baseCrewAgents(): DomainAgentNode[] {
  return [
    {
      id: "mediator",
      label: "Mediator",
      role: "Project lead",
      detail: "Runs the pod, sequences phases, and gatekeeps ship",
      signal: "standby",
      swarmRoles: ["lead", "pm"],
    },
    {
      id: "product",
      label: "Product",
      role: "Strategy",
      detail: "BA + PM — brief, stories, acceptance criteria",
      signal: "standby",
      swarmRoles: ["pm", "analyst"],
    },
    {
      id: "design",
      label: "Design",
      role: "UX / UI",
      detail: "Research, flows, and visual layout",
      signal: "standby",
      swarmRoles: ["designer"],
    },
    {
      id: "architect",
      label: "Architect",
      role: "Principal",
      detail: "Stack, data, APIs, and system boundaries",
      signal: "standby",
      swarmRoles: ["architect"],
    },
    {
      id: "eng",
      label: "Engineering",
      role: "Build",
      detail: "Backend APIs and frontend implementation",
      signal: "standby",
      swarmRoles: ["engineer", "frontend", "backend"],
    },
    {
      id: "qa",
      label: "QA",
      role: "Quality",
      detail: "Manual checks and regression coverage",
      signal: "standby",
      swarmRoles: ["qa"],
    },
    {
      id: "devops",
      label: "DevOps",
      role: "Release",
      detail: "CI/CD, staging, and production readiness",
      signal: "standby",
      swarmRoles: ["devops"],
    },
    {
      id: "marketing",
      label: "Marketing",
      role: "Launch",
      detail: "SEO, content, and go-live channels",
      signal: "standby",
      swarmRoles: ["marketing"],
    },
    {
      id: "growth",
      label: "Growth",
      role: "Analytics",
      detail: "Metrics, instrumentation, and optimization",
      signal: "standby",
      swarmRoles: ["growth", "analyst"],
    },
  ];
}
