export type ComparisonContent = {
  slug: string;
  breadcrumbLabel: string;
  eyebrow: string;
  heroTitleLines: [string, string];
  heroSub: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  comparisonRows: { dimension: string; them: string; us: string }[];
  whenTeamvinsibleWins: string[];
  whenTheyWin: string[];
  faqs: { question: string; answer: string }[];
};

export const COMPARISONS: ComparisonContent[] = [
  {
    slug: "ai-app-builders",
    breadcrumbLabel: "Teamvinsible vs AI App Builders",
    eyebrow: "Comparison",
    heroTitleLines: ["Not another", "one-shot app builder."],
    heroSub:
      "AI app builders optimize for a fast first draft from a single interface. Teamvinsible coordinates a specialist crew and keeps the work behind the output visible.",
    seoTitle: "Teamvinsible vs AI App Builders — What's Actually Different",
    seoDescription:
      "How Teamvinsible's coordinated specialist crew compares to one-shot AI app builders: visible specs, structured review, and a path from preview to publish.",
    intro:
      "AI app builders are excellent at a fast first draft — describe an app, get a working prototype in minutes. Teamvinsible solves a different, later problem: what happens after the first draft, when the work needs research grounding, a real spec, brand consistency, review, and a path to something you can actually publish and stand behind.",
    comparisonRows: [
      { dimension: "What you get", them: "A single generated app from one prompt", us: "A coordinated crew — research, spec, design, engineering, review — producing a reviewable body of work" },
      { dimension: "Visibility into the process", them: "A black box between prompt and output", us: "Specs, decisions, and artifacts visible on the Coordination Spine as they're produced" },
      { dimension: "Review before you see it", them: "None — output is presented as finished", us: "Review agents check work against acceptance criteria before it reaches you" },
      { dimension: "Revision", them: "Re-prompt and hope for a better result", us: "Structured revision loops that close inside the same project" },
      { dimension: "Brand and messaging", them: "Not addressed — you write copy separately", us: "Brand, Social, and Email agents produce voice-consistent launch material" },
      { dimension: "Path to publish", them: "Export and figure out deployment yourself", us: "Sandbox preview → publish to the edge, part of the same workflow" },
    ],
    whenTeamvinsibleWins: [
      "You need more than a working prototype — research, brand-consistent copy, and a reviewed spec matter",
      "You want to see the reasoning and decisions behind the output, not just the result",
      "The work needs to survive a review pass before you'd ship it",
    ],
    whenTheyWin: [
      "You genuinely just need a fast, disposable prototype to test an idea in the next five minutes",
      "The output doesn't need to be production-credible or brand-consistent",
      "You're the only stakeholder and don't need a visible decision trail",
    ],
    faqs: [
      { question: "Is Teamvinsible slower than a one-shot app builder?", answer: "Getting a first working artifact takes longer than a single prompt, because research, spec, and review happen first — the tradeoff is a result that's already been checked rather than one you have to debug after the fact." },
      { question: "Can I use Teamvinsible for a quick prototype too?", answer: "Yes — you can scope a lightweight brief that skips heavier review stages when you just need something fast; the coordination is there when you need it, not mandatory overhead." },
      { question: "Do I still need to write my own launch copy?", answer: "No — Social and Email agents draft launch material in the voice Brand establishes, as part of the same project." },
    ],
  },
  {
    slug: "chatgpt-workflows",
    breadcrumbLabel: "Teamvinsible vs ChatGPT Workflows",
    eyebrow: "Comparison",
    heroTitleLines: ["One thread", "was never a team."],
    heroSub:
      "Running product work through a single chat thread means you're the one holding context, switching roles, and remembering what was decided three messages ago. Teamvinsible coordinates that work across specialist agents instead.",
    seoTitle: "Teamvinsible vs ChatGPT Workflows — Coordinated Crew vs One Thread",
    seoDescription:
      "Why coordinating specialist AI agents on a visible spine outperforms running product, brand, and engineering work through a single generic ChatGPT thread.",
    intro:
      "A single chat thread is remarkably capable — and it's also where context gets lost, roles blur, and you become the one manually copy-pasting output between \"now act as a designer\" and \"now act as an engineer.\" Teamvinsible replaces the thread with a coordination spine: real specialist agents, each holding their own context, connected by Nexus instead of by you.",
    comparisonRows: [
      { dimension: "Switching roles", them: "You prompt \"act as a product manager,\" then \"act as a designer\" in the same thread", us: "Dedicated Research, Product, Design, Engineering, Review, Brand, Social, and Email agents, each holding their own context" },
      { dimension: "Context continuity", them: "Depends on what's still in the context window — long threads lose earlier decisions", us: "Artifacts and decisions persist on the Coordination Spine, not squeezed into a chat window" },
      { dimension: "Handoffs between roles", them: "You manually copy output from one \"role\" into the next prompt", us: "Nexus routes work between specialists automatically, preserving context" },
      { dimension: "Review", them: "Whatever you personally catch by reading the output", us: "A dedicated Review agent checks work against acceptance criteria" },
      { dimension: "Where the record lives", them: "Buried in a scrolling chat transcript", us: "Structured artifacts, specs, and decisions on a persistent spine" },
    ],
    whenTeamvinsibleWins: [
      "The work spans multiple disciplines and you're tired of being the human router between them",
      "You need a persistent, reviewable record — not a transcript that scrolls out of reach",
      "Context needs to survive across sessions, not just within one conversation",
    ],
    whenTheyWin: [
      "You want to quickly brainstorm or explore an idea with no need for a structured artifact",
      "The task is genuinely single-discipline and doesn't need coordination across roles",
      "You prefer full manual control over every intermediate step",
    ],
    faqs: [
      { question: "Isn't this just ChatGPT with extra steps?", answer: "The underlying capability is similar — the difference is coordination. Nexus routes work between specialist agents, preserves context between them, and keeps a structured, reviewable record, instead of you manually managing role-switches in one thread." },
      { question: "Can I still have a conversational back-and-forth?", answer: "Yes — you interact with Nexus and the crew throughout a project; the difference is that decisions and artifacts persist on the spine instead of scrolling out of a chat window." },
      { question: "What happens to context when I come back to a project days later?", answer: "It's still there — specs, decisions, and artifacts live on the spine, not in a chat history you have to scroll back through." },
    ],
  },
];

export function getComparison(slug: string | undefined): ComparisonContent | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
