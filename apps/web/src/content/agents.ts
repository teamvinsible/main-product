import type { DeepPageContent } from "./deep-content";

export const AGENTS: DeepPageContent[] = [
  {
    slug: "research",
    breadcrumbLabel: "Research Agent",
    eyebrow: "Specialist agent · Research",
    heroTitleLines: ["Market context,", "before a single line of spec."],
    heroSub:
      "The Research agent gathers competitor, market, and user context so the rest of the crew starts from evidence, not assumption.",
    highlights: ["Competitor scans", "User research synthesis", "Feeds every downstream spec"],
    seoTitle: "AI Research Agent — Market & Competitor Research | Teamvinsible",
    seoDescription:
      "Teamvinsible's Research agent gathers competitor, market, and user context automatically, so Product and Brand start every brief with evidence instead of assumption.",
    intro:
      "Most AI tools start writing the moment you give them a brief. Teamvinsible's Research agent starts by asking what's already true. Before Product drafts a spec or Brand shapes positioning, Research pulls together the competitor landscape, relevant market signals, and prior context tied to your brief — so every downstream decision is grounded rather than guessed.",
    howItWorks: [
      { title: "Reads the brief", detail: "Research parses your brief for the product category, target audience, and open questions worth investigating." },
      { title: "Scans the landscape", detail: "It surveys competitors, comparable products, and public market signals relevant to what you're building." },
      { title: "Synthesizes findings", detail: "Findings are distilled into a structured brief — not a wall of links — with the implications called out explicitly." },
      { title: "Hands off to Product", detail: "The research artifact becomes the starting context Nexus routes to the Product agent for spec-writing." },
    ],
    whatItSolves: [
      "Specs written on assumption instead of evidence",
      "Competitor blind spots discovered after launch, not before",
      "Redundant research repeated by every specialist independently",
      "No single place where \"what we know\" lives before work starts",
    ],
    beforeAfter: {
      beforeLabel: "Without a Research agent",
      before: "Product drafts a spec from the brief alone. Competitive gaps and market context surface late — often after Engineering has already built against the wrong assumptions.",
      afterLabel: "With the Research agent",
      after: "Product drafts the spec on top of a competitor scan and market context Research already gathered — gaps get caught at the spec stage, not after a preview ships.",
    },
    whenToUse: [
      { label: "Validating a new feature idea", detail: "Get a fast read on how competitors already solve this problem before committing engineering time." },
      { label: "Entering an unfamiliar market", detail: "Ground brand and product decisions in real signals instead of internal opinion." },
      { label: "Revisiting a stalled project", detail: "Refresh context before restarting work so decisions reflect the current landscape, not last quarter's." },
    ],
    bestFor: ["Founders validating a new idea", "Product teams scoping unfamiliar territory", "Agencies onboarding a new client vertical"],
    relatedLinks: [
      { label: "Product agent", href: "/agents/product" },
      { label: "Brand agent", href: "/agents/brand" },
      { label: "Features", href: "/features" },
    ],
    keywords: ["ai market research agent", "ai competitor analysis tool", "automated user research", "ai research assistant for product teams"],
    faqs: [
      { question: "Does the Research agent browse the live web?", answer: "Yes — it draws on current market and competitor signals relevant to your brief, not just static training knowledge, so findings reflect what's actually out there today." },
      { question: "Can I see the research before Product acts on it?", answer: "Yes. The research artifact is visible on the Coordination Spine before and after Product uses it — you can review, redirect, or add context at any point." },
      { question: "What if my brief doesn't need research?", answer: "Nexus scopes the crew to what a brief actually needs — a narrow, well-understood brief may route straight to Product without a research pass." },
    ],
  },
  {
    slug: "product",
    breadcrumbLabel: "Product Agent",
    eyebrow: "Specialist agent · Product",
    heroTitleLines: ["Your brief,", "turned into a scoped spec."],
    heroSub:
      "The Product agent turns a raw idea into a scoped spec with acceptance criteria — the shared contract the rest of the crew builds against.",
    highlights: ["Scoped specs, not vague briefs", "Explicit acceptance criteria", "Tradeoffs surfaced, not buried"],
    seoTitle: "AI Product Spec Agent — Turn Briefs into Scoped Specs | Teamvinsible",
    seoDescription:
      "Teamvinsible's Product agent converts a raw brief into a scoped spec with acceptance criteria, so Design, Engineering, and Review all build against the same shared contract.",
    intro:
      "A brief is a starting point, not a build plan. The Product agent takes what you — and Research, when involved — provide and turns it into a spec: what's in scope, what's explicitly out, and how the crew will know the work is done. That spec becomes the shared contract every other specialist builds against, so nobody is interpreting your intent from a two-line description.",
    howItWorks: [
      { title: "Absorbs context", detail: "Pulls in your brief plus any research findings Nexus has already routed to it." },
      { title: "Scopes the work", detail: "Defines what's in scope, what's explicitly deferred, and the constraints that matter — timeline, platform, must-haves." },
      { title: "Writes acceptance criteria", detail: "Turns fuzzy goals into concrete, checkable criteria Review will later verify against." },
      { title: "Surfaces open decisions", detail: "Flags anything genuinely ambiguous back to you instead of silently guessing." },
    ],
    whatItSolves: [
      "Engineering building against a vague, two-line brief",
      "Scope creep with no documented boundary",
      "\"Done\" meaning something different to every specialist",
      "Decisions made silently instead of surfaced for your input",
    ],
    beforeAfter: {
      beforeLabel: "Without a Product agent",
      before: "Engineering starts building from your raw brief, filling gaps with their own assumptions — gaps that surface as rework once you see the result.",
      afterLabel: "With the Product agent",
      after: "Engineering builds against a spec with explicit acceptance criteria — ambiguity gets resolved with you before code gets written, not after.",
    },
    whenToUse: [
      { label: "Turning a rough idea into buildable scope", detail: "Hand over a one-paragraph brief and get back a spec Engineering can actually build against." },
      { label: "Managing scope on a fixed timeline", detail: "Get an explicit in-scope/out-of-scope boundary before work starts, not a negotiation after." },
      { label: "Aligning a distributed crew", detail: "Give every specialist — human or agent — the same source of truth for what \"done\" means." },
    ],
    bestFor: ["Founders turning an idea into an MVP scope", "Product teams parallelizing multiple workstreams", "Agencies documenting scope for client sign-off"],
    relatedLinks: [
      { label: "Research agent", href: "/agents/research" },
      { label: "Engineering agent", href: "/agents/engineering" },
      { label: "Review agent", href: "/agents/review" },
    ],
    keywords: ["ai product spec generator", "ai product requirements document", "automated scoping tool", "ai acceptance criteria generator"],
    faqs: [
      { question: "Does the Product agent replace a PM?", answer: "No — it handles first-draft scoping and spec-writing so a PM (or founder acting as one) reviews and directs rather than writing every spec from scratch." },
      { question: "What happens when something is genuinely ambiguous?", answer: "The Product agent surfaces it as an open decision on the Coordination Spine instead of guessing — you resolve it, then work continues." },
      { question: "Can I edit the spec directly?", answer: "Yes. Specs are artifacts on the spine you can review, comment on, and redirect at any point before or during the build." },
    ],
  },
  {
    slug: "brand",
    breadcrumbLabel: "Brand Agent",
    eyebrow: "Specialist agent · Brand",
    heroTitleLines: ["Voice and positioning,", "consistent across every artifact."],
    heroSub:
      "The Brand agent keeps tone, positioning, and visual identity consistent across specs, copy, and launch material — without a style guide sitting unread in a drive folder.",
    highlights: ["Consistent voice across every artifact", "Positioning tied to real differentiation", "Style decisions documented, not tribal knowledge"],
    seoTitle: "AI Brand Agent — Consistent Voice & Positioning | Teamvinsible",
    seoDescription:
      "Teamvinsible's Brand agent keeps tone, positioning, and visual identity consistent across every spec, copy draft, and launch artifact a project produces.",
    intro:
      "Brand consistency usually degrades the moment more than one person is writing copy. The Brand agent holds the voice, positioning, and visual identity decisions for a project and applies them everywhere — the Product spec, the Social drafts, the Email copy — so a landing page and a launch email don't read like two different companies.",
    howItWorks: [
      { title: "Establishes the voice", detail: "Defines tone, positioning, and the specific language choices that differentiate this project from generic AI output." },
      { title: "Applies it across artifacts", detail: "Every downstream specialist — Social, Email, Design — inherits the same brand decisions instead of improvising its own." },
      { title: "Flags drift", detail: "When a draft strays from established positioning, Brand catches it in review rather than after it ships." },
    ],
    whatItSolves: [
      "Landing page copy and launch emails that read like different products",
      "Positioning that shifts depending on who wrote the last draft",
      "Visual identity decisions re-litigated on every new artifact",
      "No documented rationale for why the brand sounds the way it does",
    ],
    beforeAfter: {
      beforeLabel: "Without a Brand agent",
      before: "Each specialist makes its own tone and positioning calls — the result is functional but inconsistent, and nobody owns the throughline.",
      afterLabel: "With the Brand agent",
      after: "Every artifact — spec, copy, launch material — inherits one documented voice and positioning, reviewed for drift before it ships.",
    },
    whenToUse: [
      { label: "Launching with multiple content types at once", detail: "Keep landing copy, social drafts, and email launch content sounding like the same company." },
      { label: "Handing brand work to a small or solo team", detail: "Get positioning discipline usually reserved for teams with a dedicated brand hire." },
      { label: "Repositioning an existing product", detail: "Apply a new voice consistently across every future artifact instead of catching drift manually." },
    ],
    bestFor: ["Founders without a dedicated brand hire", "Agencies maintaining voice across multiple client deliverables", "Product teams launching multi-channel campaigns"],
    relatedLinks: [
      { label: "Social agent", href: "/agents/social" },
      { label: "Email agent", href: "/agents/email" },
      { label: "Design agent", href: "/agents/design" },
    ],
    keywords: ["ai brand voice tool", "ai positioning generator", "brand consistency ai", "ai tone of voice assistant"],
    faqs: [
      { question: "How does Brand learn our voice?", answer: "From your brief, any existing brand material you provide, and the decisions made and reviewed on earlier projects — it isn't starting from a generic template each time." },
      { question: "Can Brand veto other agents' output?", answer: "Brand flags drift during review; Nexus and you decide whether to revise. It's a check, not a silent override." },
      { question: "Does this replace a brand strategist?", answer: "For early-stage or resource-constrained teams, it can carry the day-to-day consistency work; for complex repositioning, it's a force-multiplier for a human strategist, not a replacement." },
    ],
  },
  {
    slug: "design",
    breadcrumbLabel: "Design Agent",
    eyebrow: "Specialist agent · Design",
    heroTitleLines: ["Interface decisions,", "reviewed before code exists."],
    heroSub:
      "The Design agent shapes the interface and experience decisions Engineering builds against — reviewed and revised before a single component gets written.",
    highlights: ["Experience decisions before code", "Reviewed against the approved spec", "Feeds Engineering a clear build target"],
    seoTitle: "AI Design Agent — Interface Decisions Before Code | Teamvinsible",
    seoDescription:
      "Teamvinsible's Design agent shapes interface and experience decisions against the approved spec, giving Engineering a clear, reviewed target before a build starts.",
    intro:
      "Building the wrong interface fast is still building the wrong thing. The Design agent takes the Product spec and works out the actual experience — layout, flow, interaction decisions — before Engineering starts. Because it's reviewed against the spec's acceptance criteria first, Engineering isn't reverse-engineering intent from a build; it's implementing a decision that's already been checked.",
    howItWorks: [
      { title: "Reads the approved spec", detail: "Starts from Product's acceptance criteria, not a blank page." },
      { title: "Shapes the experience", detail: "Works out layout, flow, and interaction decisions that satisfy the spec." },
      { title: "Goes through review", detail: "Review checks the design against acceptance criteria before it reaches Engineering." },
      { title: "Hands off a clear target", detail: "Engineering builds against a reviewed design, not an evolving guess." },
    ],
    whatItSolves: [
      "Engineering building UI that technically works but misses the intended experience",
      "Design decisions made silently inside a build, invisible until the preview",
      "Rework cycles because design and spec drifted apart",
      "No record of why an interface decision was made",
    ],
    beforeAfter: {
      beforeLabel: "Without a Design agent",
      before: "Engineering makes interface decisions on the fly while building — decisions nobody explicitly reviewed until the working preview surfaces them.",
      afterLabel: "With the Design agent",
      after: "Interface and experience decisions are made and reviewed against the spec before Engineering writes a component — the preview matches what was actually approved.",
    },
    whenToUse: [
      { label: "Moving from spec to a real interface", detail: "Get experience decisions made deliberately instead of improvised mid-build." },
      { label: "Iterating without a dedicated designer", detail: "Bring design-stage rigor to a team without a full-time design hire." },
      { label: "Reviewing before committing engineering time", detail: "Catch experience problems at the design stage, when they're cheap to fix." },
    ],
    bestFor: ["Founders without a dedicated designer", "Product teams that want design review before engineering time is spent", "Agencies producing client-facing prototypes"],
    relatedLinks: [
      { label: "Engineering agent", href: "/agents/engineering" },
      { label: "Product agent", href: "/agents/product" },
      { label: "Review agent", href: "/agents/review" },
    ],
    keywords: ["ai ui design agent", "ai product design assistant", "ai interface design tool", "design before code ai"],
    faqs: [
      { question: "Does Design produce final visuals or just decisions?", answer: "Both — it works out the interaction and layout decisions and expresses them concretely enough for Engineering to build against directly." },
      { question: "Can I redirect a design decision before it reaches Engineering?", answer: "Yes — design artifacts are reviewable on the spine before Engineering starts building against them." },
      { question: "Does this work for existing products, not just new builds?", answer: "Yes — Design can work within an existing interface's patterns when the brief is a feature addition rather than a new product." },
    ],
  },
  {
    slug: "engineering",
    breadcrumbLabel: "Engineering Agent",
    eyebrow: "Specialist agent · Engineering",
    heroTitleLines: ["From reviewed spec", "to a working preview."],
    heroSub:
      "The Engineering agent builds against the approved spec and design, then pushes to a sandbox preview — so you're evaluating working software, not a slide deck.",
    highlights: ["Builds against reviewed spec + design", "Ships to a working sandbox preview", "Surfaces implementation tradeoffs back to you"],
    seoTitle: "AI Engineering Agent — Spec to Working Preview | Teamvinsible",
    seoDescription:
      "Teamvinsible's Engineering agent builds against an approved spec and design, then ships a working sandbox preview — so you evaluate real software, not a mockup.",
    intro:
      "By the time Engineering starts, the spec is scoped and the design is reviewed — the ambiguity that usually causes rework has already been resolved. Engineering's job is to build against that reviewed target and get it into a working sandbox preview fast, so what you're evaluating is real, working software instead of a description of what it would do.",
    howItWorks: [
      { title: "Builds against the reviewed target", detail: "Implements the approved spec and design decisions directly — not a fresh interpretation of the original brief." },
      { title: "Pushes to a sandbox preview", detail: "Work becomes a live, working preview you can actually click through, not just read about." },
      { title: "Surfaces tradeoffs", detail: "Where implementation reality diverges from the spec, Engineering flags it back rather than silently deciding." },
      { title: "Hands off for review", detail: "The built artifact goes through Review before it's considered ready." },
    ],
    whatItSolves: [
      "Weeks of engineering time spent before anyone sees a working result",
      "Implementation decisions made silently, invisible until launch",
      "No fast way to sanity-check an idea against real, working software",
      "Feedback arriving after code is finished instead of during the build",
    ],
    beforeAfter: {
      beforeLabel: "Without this Engineering step",
      before: "You wait for a full build cycle to see anything real — feedback happens after most of the engineering time is already spent.",
      afterLabel: "With the Engineering agent",
      after: "A working sandbox preview exists early, built against an already-reviewed spec and design — feedback happens on real software, quickly.",
    },
    whenToUse: [
      { label: "Validating an idea before committing more resources", detail: "Get a working preview fast enough to sanity-check before deeper investment." },
      { label: "Prototyping without pulling a human engineer off roadmap", detail: "Move an unproven idea forward without competing for committed engineering time." },
      { label: "Iterating quickly on early feedback", detail: "Push revisions to the sandbox preview as review loops resolve, without a full re-build cycle." },
    ],
    bestFor: ["Founders building an MVP", "Product teams prototyping without pulling engineers off roadmap", "Agencies producing client-facing working demos"],
    relatedLinks: [
      { label: "Design agent", href: "/agents/design" },
      { label: "Review agent", href: "/agents/review" },
      { label: "Features", href: "/features" },
    ],
    keywords: ["ai coding agent for product teams", "ai app builder sandbox preview", "ai engineering agent", "spec to code ai"],
    faqs: [
      { question: "Is the sandbox preview production code?", answer: "It's built to get you from spec to a working, reviewable preview fast. What graduates to production is a decision your engineering team makes from there." },
      { question: "Can I see what Engineering built before it goes further?", answer: "Yes — the sandbox preview and the underlying artifacts are visible on the spine as soon as they exist, not just at a final handoff." },
      { question: "What if the spec turns out to be technically infeasible as written?", answer: "Engineering surfaces that tradeoff back to the spine instead of silently reinterpreting the spec — you and Product decide how to adjust." },
    ],
  },
  {
    slug: "review",
    breadcrumbLabel: "Review Agent",
    eyebrow: "Specialist agent · Review",
    heroTitleLines: ["Gaps caught", "before they reach you."],
    heroSub:
      "The Review agent checks work against acceptance criteria and sends it back into a revision loop before it's presented as done — so what reaches you has already survived a critical pass.",
    highlights: ["Checks against explicit acceptance criteria", "Sends work back into revision loops", "Closes the loop inside the spine, not a new thread"],
    seoTitle: "AI Review Agent — Acceptance Criteria & Revision Loops | Teamvinsible",
    seoDescription:
      "Teamvinsible's Review agent checks specs, designs, and builds against explicit acceptance criteria and sends gaps back into a revision loop before anything reaches you.",
    intro:
      "Most one-shot AI output skips a step: nobody checks the work against what it was supposed to do before it's presented as finished. The Review agent is that check. It compares specs, designs, and builds against the acceptance criteria Product wrote, and when something falls short, it sends the work back into a revision loop instead of quietly shipping a gap.",
    howItWorks: [
      { title: "Checks against acceptance criteria", detail: "Compares the artifact — spec, design, or build — against the criteria it was supposed to satisfy." },
      { title: "Flags specific gaps", detail: "Identifies exactly what falls short, not a vague \"needs work.\"" },
      { title: "Sends it back for revision", detail: "Routes the work back to the responsible specialist with specific feedback." },
      { title: "Confirms before sign-off", detail: "Only work that clears review is presented to you as ready." },
    ],
    whatItSolves: [
      "Output presented as finished that quietly misses the original requirements",
      "Feedback loops that start a new conversation instead of resolving in place",
      "No consistent quality bar applied before you see the result",
      "Gaps discovered by you instead of caught earlier",
    ],
    beforeAfter: {
      beforeLabel: "Without a Review agent",
      before: "Work is presented as done the moment it's produced — gaps against the original requirements surface only when you personally catch them.",
      afterLabel: "With the Review agent",
      after: "Work is checked against acceptance criteria and revised in a closed loop before it reaches you — what you see has already survived a critical pass.",
    },
    whenToUse: [
      { label: "Handing off work you can't personally verify line by line", detail: "Get a critical check applied consistently, without reviewing everything yourself." },
      { label: "Running multiple concurrent projects", detail: "Trust that a quality bar is applied even when you can't be in every review." },
      { label: "Reducing back-and-forth after delivery", detail: "Catch gaps in a closed revision loop instead of a new round-trip after you've already reviewed the output." },
    ],
    bestFor: ["Agencies maintaining quality across concurrent client work", "Founders who can't personally review every artifact", "Product teams wanting a consistent bar across parallel workstreams"],
    relatedLinks: [
      { label: "Product agent", href: "/agents/product" },
      { label: "Engineering agent", href: "/agents/engineering" },
      { label: "Features", href: "/features" },
    ],
    keywords: ["ai qa review agent", "ai acceptance testing tool", "automated work review ai", "ai revision loop"],
    faqs: [
      { question: "What does Review actually check against?", answer: "The acceptance criteria written by the Product agent (or by you, if you supplied your own) — a concrete, checkable standard rather than a subjective read." },
      { question: "Does a revision loop delay everything?", answer: "It closes inside the spine — the responsible specialist revises and resubmits without starting a new project or losing the original context." },
      { question: "Can I skip review for something I already trust?", answer: "You can direct Nexus to route lighter-weight briefs without a full review pass — review scope adapts to what a project actually needs." },
    ],
  },
  {
    slug: "social",
    breadcrumbLabel: "Social Agent",
    eyebrow: "Specialist agent · Social",
    heroTitleLines: ["Launch content", "that matches what actually shipped."],
    heroSub:
      "The Social agent drafts launch and channel content once the underlying product artifact is approved — so messaging matches reality instead of an earlier plan.",
    highlights: ["Drafted after the product artifact is approved", "Inherits Brand's voice and positioning", "Ready alongside the sandbox preview, not after"],
    seoTitle: "AI Social Content Agent — Launch Copy That Matches What Shipped | Teamvinsible",
    seoDescription:
      "Teamvinsible's Social agent drafts launch and channel content once the underlying product artifact is approved, so messaging matches what actually shipped.",
    intro:
      "Launch content written before the product is finished tends to describe a plan, not a result — and it shows the moment reality diverges. The Social agent waits until the underlying artifact is approved, then drafts channel content against what was actually built, using the voice and positioning Brand already established.",
    howItWorks: [
      { title: "Waits for the approved artifact", detail: "Drafts against what was actually built and reviewed, not an earlier plan." },
      { title: "Inherits brand voice", detail: "Uses the tone and positioning Brand already established, rather than improvising its own." },
      { title: "Drafts channel-specific content", detail: "Produces launch copy shaped for the channel it's headed to, not one generic paragraph repurposed everywhere." },
      { title: "Surfaces drafts for your review", detail: "Content lands on the spine for approval before anything goes out." },
    ],
    whatItSolves: [
      "Launch copy written for a feature that changed by the time it shipped",
      "Messaging that doesn't match the brand voice used elsewhere",
      "Social content as an afterthought bolted on after the real work is done",
      "No visibility into drafts before they're supposed to go live",
    ],
    beforeAfter: {
      beforeLabel: "Without a Social agent",
      before: "Launch copy gets written early, based on the plan — and needs a rewrite once the shipped result diverges from what was originally scoped.",
      afterLabel: "With the Social agent",
      after: "Launch copy is drafted against the approved, reviewed artifact — accurate to what actually shipped, in the voice already established.",
    },
    whenToUse: [
      { label: "Launching a new feature or product", detail: "Get channel-ready copy that reflects the shipped result, not the original pitch." },
      { label: "Coordinating launch across multiple channels", detail: "Keep messaging consistent across channels without drafting each one from scratch." },
      { label: "Running lean without a dedicated social hire", detail: "Get launch content produced as part of the same coordinated project, not a separate task." },
    ],
    bestFor: ["Founders launching without a marketing hire", "Agencies producing launch content as part of client delivery", "Product teams coordinating multi-channel announcements"],
    relatedLinks: [
      { label: "Brand agent", href: "/agents/brand" },
      { label: "Email agent", href: "/agents/email" },
      { label: "Engineering agent", href: "/agents/engineering" },
    ],
    keywords: ["ai social media content generator", "ai launch copy tool", "ai social post writer", "automated launch content"],
    faqs: [
      { question: "Does Social publish directly to channels?", answer: "It drafts content for your review on the spine — publishing is your call, not an automatic action." },
      { question: "How does Social know our brand voice?", answer: "It inherits the voice and positioning decisions Brand already established for the project, rather than starting from a generic tone." },
      { question: "Can Social work from a feature that's still in progress?", answer: "It's built to draft against approved artifacts so messaging stays accurate — draft content for in-progress work is possible but flagged as provisional." },
    ],
  },
  {
    slug: "email",
    breadcrumbLabel: "Email Agent",
    eyebrow: "Specialist agent · Email",
    heroTitleLines: ["Lifecycle and launch email,", "in the same coordinated pass."],
    heroSub:
      "The Email agent handles lifecycle and launch email copy as part of the same coordinated project — not a disconnected follow-up task days later.",
    highlights: ["Launch and lifecycle copy, same pass", "Inherits Brand's voice and positioning", "Reviewed alongside every other artifact"],
    seoTitle: "AI Email Copy Agent — Lifecycle & Launch Email | Teamvinsible",
    seoDescription:
      "Teamvinsible's Email agent drafts lifecycle and launch email copy as part of the same coordinated project, in the voice Brand already established.",
    intro:
      "Email copy is usually the last thing anyone gets to — drafted separately, days after launch, by whoever has time. The Email agent produces lifecycle and launch email copy as part of the same coordinated pass as everything else, working from the approved artifact and the voice Brand already established, so it's ready alongside the rest of the launch instead of trailing behind it.",
    howItWorks: [
      { title: "Works from the approved artifact", detail: "Drafts against what was actually built and reviewed, same as Social." },
      { title: "Inherits brand voice", detail: "Uses established tone and positioning instead of a fresh, disconnected style." },
      { title: "Covers the lifecycle, not just launch", detail: "Drafts onboarding, activation, or announcement sequences as the brief requires — not a single one-off blast." },
      { title: "Surfaces drafts for review", detail: "Copy lands on the spine for your approval before it's sent." },
    ],
    whatItSolves: [
      "Email copy as an afterthought, drafted separately after everything else ships",
      "Inconsistent voice between the product, the social launch, and the inbox",
      "No lifecycle email plan — just a single launch blast, if that",
      "Copy drafted from memory of the brief instead of what actually shipped",
    ],
    beforeAfter: {
      beforeLabel: "Without an Email agent",
      before: "Email gets drafted last, separately, often diverging in tone from everything else — or skipped entirely under time pressure.",
      afterLabel: "With the Email agent",
      after: "Lifecycle and launch email are drafted in the same coordinated pass, in the same voice, ready alongside the rest of the launch material.",
    },
    whenToUse: [
      { label: "Launching a new feature or product", detail: "Get launch email drafted alongside social content and the product artifact itself, not after." },
      { label: "Building an onboarding or activation sequence", detail: "Turn a one-off launch into a coordinated lifecycle sequence without a separate project." },
      { label: "Running lean without a dedicated lifecycle marketer", detail: "Get consistent, voice-matched email copy without a specialized hire." },
    ],
    bestFor: ["Founders without a lifecycle marketing hire", "Agencies delivering full launch packages for clients", "Product teams coordinating onboarding sequences with feature launches"],
    relatedLinks: [
      { label: "Social agent", href: "/agents/social" },
      { label: "Brand agent", href: "/agents/brand" },
      { label: "Features", href: "/features" },
    ],
    keywords: ["ai email copywriting agent", "ai lifecycle email generator", "ai launch email tool", "automated email marketing copy"],
    faqs: [
      { question: "Does Email send campaigns directly?", answer: "It drafts copy for your review on the spine — sending through your actual email platform is a step you control." },
      { question: "Can Email write a full onboarding sequence, not just one email?", answer: "Yes — the brief can scope a multi-email sequence, and Email drafts each step consistently." },
      { question: "How is this different from a generic AI email writer?", answer: "It works from the same approved artifact and brand voice as the rest of the coordinated project, so copy matches what actually shipped instead of a generic prompt's guess." },
    ],
  },
];

export function getAgent(slug: string | undefined): DeepPageContent | undefined {
  return AGENTS.find((agent) => agent.slug === slug);
}
