export type UseCase = {
  slug: string;
  audience: string;
  seoTitle: string;
  seoDescription: string;
  heroKicker: string;
  heroTitleLines: [string, string];
  heroSub: string;
  painPoints: { label: string; detail: string }[];
  scenarioTitle: string;
  scenario: string;
  faqs: { question: string; answer: string }[];
};

export const USE_CASES: UseCase[] = [
  {
    slug: "founders",
    audience: "Founders",
    seoTitle: "Teamvinsible for Founders — Ship Without a Full Team",
    seoDescription:
      "Founders use Teamvinsible to get research, product, brand, design, engineering, and review work done by a coordinated AI crew—before the first hire.",
    heroKicker: "Built for founders",
    heroTitleLines: ["You're the whole team.", "Now you have a crew."],
    heroSub:
      "Teamvinsible gives solo and early-stage founders a coordinated crew of specialist agents—so cross-functional work happens without cross-functional hires.",
    painPoints: [
      {
        label: "No team yet",
        detail: "Work spans research, product, design, and engineering—before you can afford to hire for any of it.",
      },
      {
        label: "Context tax",
        detail: "Every hour spent switching roles is an hour not spent talking to customers.",
      },
      {
        label: "Unscoped work",
        detail: "Contractors and freelancers need specs you don't have time to write.",
      },
    ],
    scenarioTitle: "What it looks like",
    scenario:
      "Describe what you're building in one brief. Nexus routes it to Research for market context, Product for a scoped spec, Design and Engineering for a working preview, and Review to catch gaps—while you stay focused on the parts only you can do: talking to users and making the calls that matter.",
    faqs: [
      {
        question: "Do I need to hire before I can use Teamvinsible?",
        answer:
          "No. Teamvinsible is built for the stage before your first hire—use it to get founding-team-level output solo, then bring on people once you've validated demand.",
      },
      {
        question: "Can I use it to build an MVP end-to-end?",
        answer:
          "Yes. A brief can move from research and spec through a working sandbox preview and a live publish, with review loops in between.",
      },
      {
        question: "What happens once I do hire a team?",
        answer:
          "Teamvinsible doesn't disappear—your human hires can review, redirect, and take over any piece of work the crew has already scoped and started.",
      },
    ],
  },
  {
    slug: "agencies",
    audience: "Agencies",
    seoTitle: "Teamvinsible for Agencies — Run More Client Work Without More Headcount",
    seoDescription:
      "Agencies use Teamvinsible to run concurrent client briefs through a coordinated AI crew, with visible specs, decisions, and review loops for every engagement.",
    heroKicker: "Built for agencies",
    heroTitleLines: ["More client briefs.", "Same headcount."],
    heroSub:
      "Teamvinsible lets agencies run multiple concurrent engagements through a coordinated specialist crew, with a visible trail for every deliverable.",
    painPoints: [
      {
        label: "Capped capacity",
        detail: "Client throughput is limited by how many briefs your team can hold in their heads at once.",
      },
      {
        label: "Idle handoffs",
        detail: "Utilization drops between projects while specialists wait on each other.",
      },
      {
        label: "Opaque status",
        detail: "Clients ask what's actually happening, and the honest answer is scattered across five tools.",
      },
    ],
    scenarioTitle: "What it looks like",
    scenario:
      "Each client brief becomes its own coordinated project. Nexus assigns the right specialists, keeps a reviewable trail of specs and decisions you can walk a client through, and moves work through revision loops before anything reaches a client's inbox.",
    faqs: [
      {
        question: "Can I run multiple client projects at once?",
        answer:
          "Yes—each brief runs as its own coordinated project on its own coordination spine, so client work doesn't get crossed.",
      },
      {
        question: "Can I show clients the work in progress?",
        answer:
          "The Coordination Spine gives you a reviewable trail of specs, decisions, and artifacts you can walk a client through, instead of a black-box deliverable.",
      },
      {
        question: "Does this replace my specialists?",
        answer:
          "It extends their capacity—your team directs, reviews, and makes the calls; the crew handles the coordination overhead between roles.",
      },
    ],
  },
  {
    slug: "product-teams",
    audience: "Product Teams",
    seoTitle: "Teamvinsible for Product Teams — Parallelize Execution Without Pulling Engineers Off Roadmap",
    seoDescription:
      "Product teams use Teamvinsible to run research, spec, design, and review work in parallel through a coordinated AI crew, without pulling engineers off the roadmap.",
    heroKicker: "Built for product teams",
    heroTitleLines: ["Run more workstreams.", "Without more headcount."],
    heroSub:
      "Teamvinsible gives product teams a coordinated crew to parallelize research, spec, brand, and review work—so engineering time stays on the roadmap that matters.",
    painPoints: [
      {
        label: "Stalled backlog",
        detail: "Good ideas sit unscoped because there's no bandwidth to properly spec them.",
      },
      {
        label: "Roadmap tradeoff",
        detail: "Prototyping something unproven competes with committed engineering work.",
      },
      {
        label: "Lost context",
        detail: "Cross-functional handoffs between PM, design, and engineering drop context every time.",
      },
    ],
    scenarioTitle: "What it looks like",
    scenario:
      "A backlog idea becomes a brief. Research and Product agents scope it and produce a spec while your team stays on committed work; Engineering builds a sandbox preview once the spec clears Review, so your team evaluates a working prototype instead of a slide.",
    faqs: [
      {
        question: "Does this replace our product or engineering team?",
        answer:
          "No—it handles the coordination and first-draft execution between disciplines so your team can focus on judgment calls, prioritization, and anything that needs deep domain context.",
      },
      {
        question: "Can we route work through our own review process?",
        answer:
          "Yes—Review agents catch gaps before work reaches you, but every artifact stays open for your team to redirect or take over.",
      },
      {
        question: "Is this meant for production code?",
        answer:
          "It's built to get you from idea to a working, reviewable preview fast—your engineering team decides what graduates from there.",
      },
    ],
  },
];

export function getUseCase(slug: string | undefined): UseCase | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}
