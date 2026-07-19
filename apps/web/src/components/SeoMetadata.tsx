import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://teamvinsible.com";
const SITE_NAME = "Teamvinsible";
const SOCIAL_IMAGE = `${SITE_ORIGIN}/social-card.png`;
const HOME_TITLE = "Teamvinsible — AI Agent Coordination for Product Teams";
const HOME_DESCRIPTION =
  "Turn one brief into coordinated execution with specialist AI agents for research, product, brand, engineering, review, and launch.";

const FAQS = [
  {
    question: "What is Teamvinsible?",
    answer:
      "Teamvinsible is an AI agent coordination platform that turns a brief into planned, reviewed, and publishable work. Nexus coordinates specialist agents while you retain visibility into their specs, files, decisions, and progress.",
  },
  {
    question: "How is Teamvinsible different from an AI app builder?",
    answer:
      "Most AI app builders optimize for a fast output from a single interface. Teamvinsible coordinates a cross-functional crew, exposes the work behind the output, and includes structured review, revision, preview, and publishing steps.",
  },
  {
    question: "Which AI agents are included?",
    answer:
      "A project can involve Research, Product, Brand, Design, Engineering, Review, Social, and Email specialists, with Nexus coordinating the right roles for the brief.",
  },
  {
    question: "Can I see what the agents are doing?",
    answer:
      "Yes. The Coordination Spine shows agent status, artifacts, data flows, activity, open decisions, revision loops, project health, and preview or publish state.",
  },
  {
    question: "Who is Teamvinsible for?",
    answer:
      "It is designed for founders, product teams, agencies, and small teams that need to move from idea to execution without hiring or manually coordinating every specialist role from day one.",
  },
] as const;

type SeoRoute = {
  title: string;
  description: string;
  canonical?: string;
  robots: string;
  publicPage: boolean;
  jsonLd?: Record<string, unknown>;
};

function organizationGraph() {
  return [
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_ORIGIN}/logo-512.png`,
        width: 512,
        height: 512,
      },
      description:
        "Teamvinsible builds transparent coordination infrastructure for specialist AI agent teams.",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      inLanguage: "en",
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
  ];
}

function homepageJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      ...organizationGraph(),
      {
        "@type": "WebPage",
        "@id": `${SITE_ORIGIN}/#webpage`,
        url: `${SITE_ORIGIN}/`,
        name: HOME_TITLE,
        description: HOME_DESCRIPTION,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: SOCIAL_IMAGE,
          width: 1200,
          height: 630,
        },
      },
      {
        "@type": "Service",
        "@id": `${SITE_ORIGIN}/#service`,
        name: "Teamvinsible AI agent coordination",
        serviceType: "AI agent coordination platform",
        description:
          "A visible coordination service for planning, reviewing, previewing, and publishing work produced by specialist AI agent teams.",
        provider: { "@id": `${SITE_ORIGIN}/#organization` },
        areaServed: "Worldwide",
        url: `${SITE_ORIGIN}/`,
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_ORIGIN}/#faq`,
        mainEntity: FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

function legalJsonLd(title: string, description: string, path: string): Record<string, unknown> {
  const url = `${SITE_ORIGIN}${path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ...organizationGraph(),
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: title,
        description,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
      },
    ],
  };
}

function routeSeo(pathname: string): SeoRoute {
  if (pathname === "/") {
    return {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      canonical: `${SITE_ORIGIN}/`,
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      publicPage: true,
      jsonLd: homepageJsonLd(),
    };
  }

  if (pathname === "/terms") {
    const title = "Terms of Service — Teamvinsible";
    const description =
      "Read the terms governing access to and use of Teamvinsible's AI agent coordination platform.";
    return {
      title,
      description,
      canonical: `${SITE_ORIGIN}/terms`,
      robots: "index, follow, max-snippet:-1",
      publicPage: true,
      jsonLd: legalJsonLd(title, description, "/terms"),
    };
  }

  if (pathname === "/privacy") {
    const title = "Privacy Policy — Teamvinsible";
    const description =
      "Learn how Teamvinsible collects, uses, shares, retains, and protects information across its AI agent coordination platform.";
    return {
      title,
      description,
      canonical: `${SITE_ORIGIN}/privacy`,
      robots: "index, follow, max-snippet:-1",
      publicPage: true,
      jsonLd: legalJsonLd(title, description, "/privacy"),
    };
  }

  if (pathname === "/login") {
    return {
      title: "Sign in — Teamvinsible",
      description: "Sign in to your Teamvinsible workspace.",
      robots: "noindex, nofollow, noarchive, nosnippet",
      publicPage: false,
    };
  }

  if (pathname === "/signup") {
    return {
      title: "Create an account — Teamvinsible",
      description: "Create your Teamvinsible workspace.",
      robots: "noindex, nofollow, noarchive, nosnippet",
      publicPage: false,
    };
  }

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return {
      title: "Coordination dashboard — Teamvinsible",
      description: "Private Teamvinsible coordination workspace.",
      robots: "noindex, nofollow, noarchive, nosnippet",
      publicPage: false,
    };
  }

  if (
    pathname === "/auth/callback" ||
    pathname === "/spine" ||
    pathname.startsWith("/spine/") ||
    pathname === "/intake" ||
    pathname === "/files" ||
    pathname.startsWith("/files/")
  ) {
    return {
      title: "Teamvinsible",
      description: "Teamvinsible application route.",
      robots: "noindex, nofollow, noarchive, nosnippet",
      publicPage: false,
    };
  }

  return {
    title: "Page not found — Teamvinsible",
    description: "The requested Teamvinsible page could not be found.",
    robots: "noindex, nofollow, noarchive, nosnippet",
    publicPage: false,
  };
}

function setMeta(attribute: "name" | "property", key: string, content?: string) {
  const selector = `meta[${attribute}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    existing?.remove();
    return;
  }
  const meta = existing || document.createElement("meta");
  meta.setAttribute(attribute, key);
  meta.content = content;
  if (!existing) document.head.appendChild(meta);
}

function setCanonical(href?: string) {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    existing?.remove();
    return;
  }
  const canonical = existing || document.createElement("link");
  canonical.rel = "canonical";
  canonical.href = href;
  if (!existing) document.head.appendChild(canonical);
}

function setJsonLd(value?: Record<string, unknown>) {
  const existing = document.head.querySelector<HTMLScriptElement>("#seo-json-ld");
  if (!value) {
    existing?.remove();
    return;
  }
  const script = existing || document.createElement("script");
  script.id = "seo-json-ld";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(value);
  if (!existing) document.head.appendChild(script);
}

export function SeoMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    const seo = routeSeo(normalizedPathname);
    document.title = seo.title;
    setMeta("name", "description", seo.description);
    setMeta("name", "robots", seo.robots);
    setCanonical(seo.canonical);
    setJsonLd(seo.jsonLd);

    const openGraph: Record<string, string | undefined> = {
      "og:type": seo.publicPage ? "website" : undefined,
      "og:site_name": seo.publicPage ? SITE_NAME : undefined,
      "og:locale": seo.publicPage ? "en_US" : undefined,
      "og:title": seo.publicPage ? seo.title : undefined,
      "og:description": seo.publicPage ? seo.description : undefined,
      "og:url": seo.publicPage ? seo.canonical : undefined,
      "og:image": seo.publicPage ? SOCIAL_IMAGE : undefined,
      "og:image:secure_url": seo.publicPage ? SOCIAL_IMAGE : undefined,
      "og:image:type": seo.publicPage ? "image/png" : undefined,
      "og:image:width": seo.publicPage ? "1200" : undefined,
      "og:image:height": seo.publicPage ? "630" : undefined,
      "og:image:alt": seo.publicPage
        ? "Teamvinsible: one brief, a whole AI crew in motion"
        : undefined,
    };
    Object.entries(openGraph).forEach(([key, value]) => setMeta("property", key, value));

    const twitter: Record<string, string | undefined> = {
      "twitter:card": seo.publicPage ? "summary_large_image" : undefined,
      "twitter:title": seo.publicPage ? seo.title : undefined,
      "twitter:description": seo.publicPage ? seo.description : undefined,
      "twitter:image": seo.publicPage ? SOCIAL_IMAGE : undefined,
      "twitter:image:alt": seo.publicPage
        ? "Teamvinsible: one brief, a whole AI crew in motion"
        : undefined,
    };
    Object.entries(twitter).forEach(([key, value]) => setMeta("name", key, value));
  }, [pathname]);

  return null;
}
