export type DeepPageContent = {
  slug: string;
  breadcrumbLabel: string;
  eyebrow: string;
  heroTitleLines: [string, string];
  heroSub: string;
  highlights: string[];
  seoTitle: string;
  seoDescription: string;
  intro: string;
  howItWorks: { title: string; detail: string }[];
  whatItSolves: string[];
  beforeAfter: { beforeLabel: string; before: string; afterLabel: string; after: string };
  whenToUse: { label: string; detail: string }[];
  bestFor: string[];
  relatedLinks: { label: string; href: string }[];
  keywords: string[];
  faqs: { question: string; answer: string }[];
};
