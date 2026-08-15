import type { DeepPageContent } from "./deep-content";

export const USE_CASES: DeepPageContent[] = [
  {
    slug: "founders",
    breadcrumbLabel: "For Founders",
    eyebrow: "Built for · Founders",
    heroTitleLines: ["You're the whole team.", "Now you have a crew."],
    heroSub:
      "Teamvinsible gives solo and early-stage founders a coordinated crew of specialist agents—so cross-functional work happens without cross-functional hires.",
    highlights: ["No hires required to start", "MVP-ready in days, not months", "You stay the final decision-maker"],
    seoTitle: "Teamvinsible for Founders — Ship Without a Full Team",
    seoDescription:
      "Founders use Teamvinsible to get research, product, brand, design, engineering, and review work done by a coordinated AI crew—before the first hire.",
    intro:
      "Founders don't lack ideas — they lack the eight-person crew a real idea usually needs to become something real. Teamvinsible gives you that crew: Research, Product, Design, Engineering, Review, Brand, Social, and Email, coordinated by Nexus, working from a single brief you write yourself.",
    howItWorks: [
      { title: "Write the brief", detail: "Describe what you're building in plain language — no spec-writing skills required." },
      { title: "The crew scopes and builds", detail: "Research grounds it, Product scopes it, Design and Engineering build a working preview." },
      { title: "Review catches gaps", detail: "Work is checked against acceptance criteria before it reaches you — not after." },
      { title: "You decide what ships", detail: "Approve, redirect, or publish — you stay the one making the call, not writing every line." },
    ],
    whatItSolves: [
      "No budget for a founding team, but the work still spans research, product, design, and engineering",
      "Every hour spent context-switching between roles is an hour not spent talking to customers",
      "Contractors and freelancers need specs you don't have time to write",
      "You need to move at the speed of conviction, not the speed of a hiring pipeline",
    ],
    beforeAfter: {
      beforeLabel: "Before",
      before: "You're prototyping alone at night, context-switching between market research, writing specs, wireframing, and coding — and something always gets skipped.",
      afterLabel: "With Teamvinsible",
      after: "One brief routes to a coordinated crew — research, spec, design, build, review — while you focus on talking to customers and making the calls only you can make.",
    },
    whenToUse: [
      { label: "Validating an idea before you quit your job", detail: "Get a working, reviewed preview fast enough to test real signal before making a bet." },
      { label: "Building toward a fundraising milestone", detail: "Turn a pitch deck claim into a working product a term sheet can actually reference." },
      { label: "Replacing a contractor you can't yet afford", detail: "Get founding-team-level output without payroll, then hire once you've validated demand." },
    ],
    bestFor: ["Solo founders before their first hire", "Two-person founding teams splitting too many roles", "Founders validating before fundraising"],
    relatedLinks: [
      { label: "Product agent", href: "/agents/product" },
      { label: "Engineering agent", href: "/agents/engineering" },
      { label: "Teamvinsible vs AI app builders", href: "/vs/ai-app-builders" },
    ],
    keywords: ["ai cofounder alternative", "ai for solo founders", "mvp without hiring a team", "ai product team for startups"],
    faqs: [
      { question: "Do I need to hire before I can use Teamvinsible?", answer: "No. Teamvinsible is built for the stage before your first hire—use it to get founding-team-level output solo, then bring on people once you've validated demand." },
      { question: "Can I use it to build an MVP end-to-end?", answer: "Yes. A brief can move from research and spec through a working sandbox preview and a live publish, with review loops in between." },
      { question: "What happens once I do hire a team?", answer: "Teamvinsible doesn't disappear—your human hires can review, redirect, and take over any piece of work the crew has already scoped and started." },
      { question: "How is this different from just using ChatGPT for everything?", answer: "ChatGPT is one thread you manually steer between roles — you copy-paste between \"act as a designer\" and \"act as an engineer.\" Teamvinsible coordinates dedicated Research, Product, Design, Engineering, and Review agents automatically, with a persistent, reviewable record of decisions." },
    ],
  },
  {
    slug: "agencies",
    breadcrumbLabel: "For Agencies",
    eyebrow: "Built for · Agencies",
    heroTitleLines: ["More client briefs.", "Same headcount."],
    heroSub:
      "Teamvinsible lets agencies run multiple concurrent engagements through a coordinated specialist crew, with a visible trail for every deliverable.",
    highlights: ["Run concurrent client projects", "A reviewable trail for every deliverable", "Extend capacity without new hires"],
    seoTitle: "Teamvinsible for Agencies — Run More Client Work Without More Headcount",
    seoDescription:
      "Agencies use Teamvinsible to run concurrent client briefs through a coordinated AI crew, with visible specs, decisions, and review loops for every engagement.",
    intro:
      "Agency capacity is usually capped by how many briefs your team can hold in their heads at once, not by how many clients want to work with you. Teamvinsible extends that capacity — each client brief runs as its own coordinated project, with a reviewable trail you can walk a client through instead of a black-box deliverable.",
    howItWorks: [
      { title: "Start a project per client brief", detail: "Each engagement runs on its own coordination spine — no crossed context between clients." },
      { title: "The crew handles the coordination overhead", detail: "Nexus routes work between Research, Product, Brand, Design, Engineering, Review, Social, and Email for each project." },
      { title: "Review keeps quality consistent", detail: "A quality bar is applied even on projects you can't personally review line by line." },
      { title: "Walk clients through the record", detail: "Specs, decisions, and artifacts are visible — useful for client reporting, not just internal use." },
    ],
    whatItSolves: [
      "Client capacity capped by how many briefs your team can hold in their heads at once",
      "Utilization drops between projects while specialists wait on handoffs from each other",
      "Clients ask \"what's actually happening\" and the honest answer is scattered across five tools",
      "Bringing on a new specialist role for one client's needs doesn't pencil out",
    ],
    beforeAfter: {
      beforeLabel: "Before",
      before: "Each new client brief competes for the same stretched team — utilization drops between handoffs, and client status updates mean digging through five different tools.",
      afterLabel: "With Teamvinsible",
      after: "Each client brief runs as its own coordinated project with a reviewable trail — capacity scales without proportionally scaling headcount.",
    },
    whenToUse: [
      { label: "Taking on a new client without new hires", detail: "Extend delivery capacity into a new engagement without a hiring cycle." },
      { label: "Reporting status to a client mid-project", detail: "Walk a client through specs, decisions, and artifacts instead of a vague status update." },
      { label: "Standardizing quality across account leads", detail: "Apply a consistent review bar across every project, not just the ones you personally oversee." },
    ],
    bestFor: ["Agencies running multiple concurrent client engagements", "Small studios without a specialist for every discipline", "Agencies that need a client-facing decision trail"],
    relatedLinks: [
      { label: "Review agent", href: "/agents/review" },
      { label: "Brand agent", href: "/agents/brand" },
      { label: "For product teams", href: "/for/product-teams" },
    ],
    keywords: ["ai agency workflow tool", "scale agency delivery with ai", "ai client project management", "agency ai crew"],
    faqs: [
      { question: "Can I run multiple client projects at once?", answer: "Yes—each brief runs as its own coordinated project on its own coordination spine, so client work doesn't get crossed." },
      { question: "Can I show clients the work in progress?", answer: "The Coordination Spine gives you a reviewable trail of specs, decisions, and artifacts you can walk a client through, instead of a black-box deliverable." },
      { question: "Does this replace my specialists?", answer: "It extends their capacity—your team directs, reviews, and makes the calls; the crew handles the coordination overhead between roles." },
      { question: "How is client work kept separate between projects?", answer: "Each brief runs on its own coordination spine — specs, artifacts, and decisions for one client's project don't bleed into another's." },
    ],
  },
  {
    slug: "product-teams",
    breadcrumbLabel: "For Product Teams",
    eyebrow: "Built for · Product Teams",
    heroTitleLines: ["Run more workstreams.", "Without more headcount."],
    heroSub:
      "Teamvinsible gives product teams a coordinated crew to parallelize research, spec, brand, and review work—so engineering time stays on the roadmap that matters.",
    highlights: ["Parallelize workstreams without new hires", "Working previews before committing engineers", "A reviewed spec before a sprint starts"],
    seoTitle: "Teamvinsible for Product Teams — Parallelize Execution Without Pulling Engineers Off Roadmap",
    seoDescription:
      "Product teams use Teamvinsible to run research, spec, design, and review work in parallel through a coordinated AI crew, without pulling engineers off the roadmap.",
    intro:
      "Good ideas usually don't die from lack of merit — they die in a backlog, unscoped, because nobody had the bandwidth to properly research and spec them before asking for engineering time. Teamvinsible runs that upfront work — research, spec, design — in parallel with your team's committed roadmap, so an idea arrives at the sprint planning table already scoped.",
    howItWorks: [
      { title: "Turn a backlog idea into a brief", detail: "Hand off an unscoped idea instead of letting it sit." },
      { title: "Research and Product scope it in parallel", detail: "Work happens alongside your team's committed roadmap, not competing for the same engineering time." },
      { title: "Engineering builds a sandbox preview", detail: "Once the spec clears Review, a working prototype exists — not just a slide." },
      { title: "Your team evaluates a working result", detail: "Decide what graduates to the real roadmap based on something real, not a proposal." },
    ],
    whatItSolves: [
      "Good ideas sit unscoped because there's no bandwidth to properly spec them",
      "Prototyping something unproven competes with committed engineering work",
      "Cross-functional handoffs between PM, design, and engineering drop context every time",
      "Leadership wants to see more experiments running, with the same team size",
    ],
    beforeAfter: {
      beforeLabel: "Before",
      before: "An unproven idea sits in the backlog because scoping it would mean pulling a PM or engineer off committed roadmap work — so it never gets a fair test.",
      afterLabel: "With Teamvinsible",
      after: "The idea gets scoped and built into a working sandbox preview in parallel, without touching your team's committed sprint — evaluated on something real, not a pitch.",
    },
    whenToUse: [
      { label: "Testing an idea before committing a sprint", detail: "Get a working preview before asking your team to prioritize it over committed work." },
      { label: "Clearing a backlog of unscoped ideas", detail: "Turn vague backlog entries into properly scoped, reviewed specs." },
      { label: "Showing leadership more experiments without more headcount", detail: "Run more parallel workstreams without pulling engineers off the roadmap that matters." },
    ],
    bestFor: ["Product teams with more ideas than bandwidth", "Teams that want to prototype without pulling engineers off roadmap", "Leaders who need to show experimentation velocity"],
    relatedLinks: [
      { label: "Design agent", href: "/agents/design" },
      { label: "Research agent", href: "/agents/research" },
      { label: "For agencies", href: "/for/agencies" },
    ],
    keywords: ["ai product prototyping tool", "parallelize product roadmap with ai", "ai product spec agent", "ai for product teams"],
    faqs: [
      { question: "Does this replace our product or engineering team?", answer: "No—it handles the coordination and first-draft execution between disciplines so your team can focus on judgment calls, prioritization, and anything that needs deep domain context." },
      { question: "Can we route work through our own review process?", answer: "Yes—Review agents catch gaps before work reaches you, but every artifact stays open for your team to redirect or take over." },
      { question: "Is this meant for production code?", answer: "It's built to get you from idea to a working, reviewable preview fast—your engineering team decides what graduates from there." },
      { question: "How does this fit into our existing sprint process?", answer: "It runs alongside your sprint, not inside it — ideas get scoped and previewed in parallel, then your team decides what actually enters the next planning cycle." },
    ],
  },
];

export function getUseCase(slug: string | undefined): DeepPageContent | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}
