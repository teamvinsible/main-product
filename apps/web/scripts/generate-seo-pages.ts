import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_ORIGIN, SITE_NAME, SOCIAL_IMAGE, SOCIAL_IMAGE_ALT } from "../src/lib/site-config.ts";
import { USE_CASES } from "../src/content/use-cases.ts";
import { AGENTS } from "../src/content/agents.ts";
import { COMPARISONS } from "../src/content/comparisons.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(appRoot, "dist");

type Breadcrumb = { name: string; path: string };

type RouteConfig = {
  output: string;
  route: string;
  title: string;
  description: string;
  robots: string;
  publicPage: boolean;
  faqs?: { question: string; answer: string }[];
  breadcrumb?: Breadcrumb[];
  extraGraphNodes?: Record<string, unknown>[];
  collectionOf?: { name: string; url: string }[];
  sitemapPriority?: number;
  sitemapChangefreq?: string;
};

const organizationGraph = () => [
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

function breadcrumbGraph(id: string, trail: Breadcrumb[]) {
  return {
    "@type": "BreadcrumbList",
    "@id": id,
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${SITE_ORIGIN}${crumb.path}`,
    })),
  };
}

function pageJsonLd(config: RouteConfig) {
  const url = `${SITE_ORIGIN}${config.route}`;
  const hasBreadcrumb = Boolean(config.breadcrumb?.length);
  return {
    "@context": "https://schema.org",
    "@graph": [
      ...organizationGraph(),
      ...(hasBreadcrumb ? [breadcrumbGraph(`${url}#breadcrumb`, config.breadcrumb!)] : []),
      {
        "@type": config.collectionOf ? "CollectionPage" : "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: config.title,
        description: config.description,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        ...(hasBreadcrumb ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
        ...(config.collectionOf
          ? { hasPart: config.collectionOf.map((item) => ({ "@type": "WebPage", name: item.name, url: item.url })) }
          : {}),
      },
      ...(config.extraGraphNodes ?? []),
      ...(config.faqs?.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${url}#faq`,
              mainEntity: config.faqs.map((faq) => ({
                "@type": "Question",
                name: faq.question,
                acceptedAnswer: { "@type": "Answer", text: faq.answer },
              })),
            },
          ]
        : []),
    ],
  };
}

const routes: RouteConfig[] = [
  {
    output: "features.html",
    route: "/features",
    title: "Features — Teamvinsible Coordination Spine",
    description:
      "See how Nexus coordinates Research, Product, Brand, Design, Engineering, Review, Social, and Email agents through one visible, reviewable coordination spine.",
    robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    publicPage: true,
    sitemapPriority: 0.8,
    sitemapChangefreq: "weekly",
  },
  {
    output: "agents.html",
    route: "/agents",
    title: "Agents — The Teamvinsible Specialist Crew",
    description:
      "Meet the eight specialist agents — Research, Product, Brand, Design, Engineering, Review, Social, and Email — that Nexus coordinates on every Teamvinsible project.",
    robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    publicPage: true,
    breadcrumb: [{ name: "Home", path: "/" }, { name: "Agents", path: "/agents" }],
    collectionOf: AGENTS.map((agent) => ({ name: agent.breadcrumbLabel, url: `${SITE_ORIGIN}/agents/${agent.slug}` })),
    sitemapPriority: 0.8,
    sitemapChangefreq: "weekly",
  },
  ...AGENTS.map(
    (agent): RouteConfig => ({
      output: `agents/${agent.slug}.html`,
      route: `/agents/${agent.slug}`,
      title: agent.seoTitle,
      description: agent.seoDescription,
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      publicPage: true,
      faqs: agent.faqs,
      breadcrumb: [
        { name: "Home", path: "/" },
        { name: "Agents", path: "/agents" },
        { name: agent.breadcrumbLabel, path: `/agents/${agent.slug}` },
      ],
      extraGraphNodes: [
        {
          "@type": "Service",
          "@id": `${SITE_ORIGIN}/agents/${agent.slug}#service`,
          name: agent.breadcrumbLabel,
          serviceType: "AI agent coordination platform",
          description: agent.seoDescription,
          provider: { "@id": `${SITE_ORIGIN}/#organization` },
          areaServed: "Worldwide",
          url: `${SITE_ORIGIN}/agents/${agent.slug}`,
        },
      ],
      sitemapPriority: 0.7,
      sitemapChangefreq: "weekly",
    }),
  ),
  ...COMPARISONS.map(
    (comparison): RouteConfig => ({
      output: `vs/${comparison.slug}.html`,
      route: `/vs/${comparison.slug}`,
      title: comparison.seoTitle,
      description: comparison.seoDescription,
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      publicPage: true,
      faqs: comparison.faqs,
      breadcrumb: [{ name: "Home", path: "/" }, { name: comparison.breadcrumbLabel, path: `/vs/${comparison.slug}` }],
      sitemapPriority: 0.7,
      sitemapChangefreq: "weekly",
    }),
  ),
  ...USE_CASES.map(
    (useCase): RouteConfig => ({
      output: `for/${useCase.slug}.html`,
      route: `/for/${useCase.slug}`,
      title: useCase.seoTitle,
      description: useCase.seoDescription,
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      publicPage: true,
      faqs: useCase.faqs,
      breadcrumb: [{ name: "Home", path: "/" }, { name: useCase.breadcrumbLabel, path: `/for/${useCase.slug}` }],
      sitemapPriority: 0.7,
      sitemapChangefreq: "weekly",
    }),
  ),
  {
    output: "terms.html",
    route: "/terms",
    title: "Terms of Service — Teamvinsible",
    description:
      "Read the terms governing access to and use of Teamvinsible's AI agent coordination platform.",
    robots: "index, follow, max-snippet:-1",
    publicPage: true,
    sitemapPriority: 0.3,
    sitemapChangefreq: "monthly",
  },
  {
    output: "privacy.html",
    route: "/privacy",
    title: "Privacy Policy — Teamvinsible",
    description:
      "Learn how Teamvinsible collects, uses, shares, retains, and protects information across its AI agent coordination platform.",
    robots: "index, follow, max-snippet:-1",
    publicPage: true,
    sitemapPriority: 0.3,
    sitemapChangefreq: "monthly",
  },
  {
    output: "login.html",
    route: "/login",
    title: "Sign in — Teamvinsible",
    description: "Sign in to your Teamvinsible workspace.",
    robots: "noindex, nofollow, noarchive, nosnippet",
    publicPage: false,
  },
  {
    output: "signup.html",
    route: "/signup",
    title: "Create an account — Teamvinsible",
    description: "Create your Teamvinsible workspace.",
    robots: "noindex, nofollow, noarchive, nosnippet",
    publicPage: false,
  },
  {
    output: "dashboard.html",
    route: "/dashboard",
    title: "Coordination dashboard — Teamvinsible",
    description: "Private Teamvinsible coordination workspace.",
    robots: "noindex, nofollow, noarchive, nosnippet",
    publicPage: false,
  },
  {
    output: "auth/callback.html",
    route: "/auth/callback",
    title: "Authentication — Teamvinsible",
    description: "Complete Teamvinsible authentication.",
    robots: "noindex, nofollow, noarchive, nosnippet",
    publicPage: false,
  },
];

const ogKeys = [
  "og:type",
  "og:site_name",
  "og:locale",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
] as const;

const twitterKeys = [
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setMeta(html: string, attribute: string, key: string, content: string | undefined) {
  const pattern = new RegExp(
    `\\s*<meta\\s+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`,
    "i",
  );
  if (!content) return html.replace(pattern, "");
  const tag = `    <meta ${attribute}="${key}" content="${content.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" />`;
  if (pattern.test(html)) return html.replace(pattern, `\n${tag}`);
  return html.replace("  </head>", `${tag}\n  </head>`);
}

function setCanonical(html: string, canonical: string | undefined) {
  const pattern = /\s*<link\s+rel=["']canonical["'][^>]*>/i;
  if (!canonical) return html.replace(pattern, "");
  const tag = `    <link rel="canonical" href="${canonical}" />`;
  if (pattern.test(html)) return html.replace(pattern, `\n${tag}`);
  return html.replace("  </head>", `${tag}\n  </head>`);
}

function setJsonLd(html: string, jsonLd: unknown) {
  const pattern = /\s*<script\s+id=["']seo-json-ld["'][^>]*>[\s\S]*?<\/script>/i;
  if (!jsonLd) return html.replace(pattern, "");
  const tag = `    <script id="seo-json-ld" type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
  if (pattern.test(html)) return html.replace(pattern, `\n${tag}`);
  return html.replace("  </head>", `${tag}\n  </head>`);
}

function renderRoute(baseHtml: string, config: RouteConfig) {
  let html = baseHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${config.title}</title>`);
  html = setMeta(html, "name", "description", config.description);
  html = setMeta(html, "name", "robots", config.robots);
  html = setCanonical(html, config.publicPage ? `${SITE_ORIGIN}${config.route}` : undefined);

  if (config.publicPage) {
    const openGraph: Record<string, string> = {
      "og:type": "website",
      "og:site_name": SITE_NAME,
      "og:locale": "en_US",
      "og:title": config.title,
      "og:description": config.description,
      "og:url": `${SITE_ORIGIN}${config.route}`,
      "og:image": SOCIAL_IMAGE,
      "og:image:secure_url": SOCIAL_IMAGE,
      "og:image:type": "image/png",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": SOCIAL_IMAGE_ALT,
    };
    for (const [key, value] of Object.entries(openGraph)) {
      html = setMeta(html, "property", key, value);
    }
    const twitter: Record<string, string> = {
      "twitter:card": "summary_large_image",
      "twitter:title": config.title,
      "twitter:description": config.description,
      "twitter:image": SOCIAL_IMAGE,
      "twitter:image:alt": SOCIAL_IMAGE_ALT,
    };
    for (const [key, value] of Object.entries(twitter)) {
      html = setMeta(html, "name", key, value);
    }
    html = setJsonLd(html, pageJsonLd(config));
  } else {
    for (const key of ogKeys) html = setMeta(html, "property", key, undefined);
    for (const key of twitterKeys) html = setMeta(html, "name", key, undefined);
    html = setJsonLd(html, undefined);
  }

  return html;
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page not found — Teamvinsible</title>
    <meta name="description" content="The requested Teamvinsible page could not be found." />
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
    <meta name="theme-color" content="#0b0a08" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; background:#0b0a08; color:#f4f0e8; }
      body { min-height:100vh; margin:0; display:grid; place-items:center; background:radial-gradient(circle at 20% 10%,#30230f 0,transparent 38%),#0b0a08; }
      main { width:min(520px,calc(100vw - 40px)); padding:40px; border:1px solid #3f3931; border-radius:24px; background:#191713; box-sizing:border-box; }
      p { color:#aaa198; line-height:1.6; } small { color:#e6a83c; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      h1 { margin:12px 0 8px; font-size:clamp(32px,7vw,56px); letter-spacing:-.05em; }
      a { display:inline-flex; margin-top:18px; padding:10px 16px; border-radius:999px; background:#e6a83c; color:#211506; font-weight:700; text-decoration:none; }
    </style>
  </head>
  <body><main><small>Error 404</small><h1>Page not found</h1><p>The page you requested does not exist or has moved.</p><a href="/">Back to Teamvinsible</a></main></body>
</html>`;
}

function sitemapXml() {
  const entries = [
    { loc: `${SITE_ORIGIN}/`, changefreq: "weekly", priority: "1.0" },
    ...routes
      .filter((config) => config.publicPage)
      .map((config) => ({
        loc: `${SITE_ORIGIN}${config.route}`,
        changefreq: config.sitemapChangefreq ?? "monthly",
        priority: (config.sitemapPriority ?? 0.5).toFixed(1),
      })),
  ];
  const urls = entries
    .map((entry) => `  <url>\n    <loc>${entry.loc}</loc>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const baseHtml = await readFile(path.join(distDir, "index.html"), "utf8");
for (const config of routes) {
  const outputPath = path.join(distDir, config.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderRoute(baseHtml, config), "utf8");
}
await writeFile(path.join(distDir, "404.html"), notFoundHtml(), "utf8");
await writeFile(path.join(distDir, "sitemap.xml"), sitemapXml(), "utf8");
