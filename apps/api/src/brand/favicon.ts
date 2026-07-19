/** Platform brand mark — same asset as apps/web/public/favicon.svg */
export const PLATFORM_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#0b0a08"/>
  <path d="M15 18h34M32 18v29M19 33l13 14 13-14" fill="none" stroke="#f3eee5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="15" cy="18" r="4" fill="#eda84c"/>
  <circle cx="49" cy="18" r="4" fill="#eda84c"/>
  <circle cx="32" cy="47" r="4" fill="#eda84c"/>
</svg>
`;

export const PLATFORM_FAVICON_LINK =
  `<link rel="icon" href="favicon.svg" type="image/svg+xml" />`;

export function isFaviconPath(path: string): boolean {
  const base = path.replace(/^\/+/, "").toLowerCase();
  return base === "favicon.ico" || base === "favicon.svg" || base.endsWith("/favicon.ico") || base.endsWith("/favicon.svg");
}

export function platformFaviconResponse(cacheControl = "public, max-age=86400"): Response {
  return new Response(PLATFORM_FAVICON_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Ensure generated HTML references the platform favicon. */
export function ensureFaviconLink(html: string): string {
  if (/rel=["']icon["']/i.test(html)) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${PLATFORM_FAVICON_LINK}\n</head>`);
  }
  return `${PLATFORM_FAVICON_LINK}\n${html}`;
}
