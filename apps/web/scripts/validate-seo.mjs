import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(appRoot, "dist");
const SITE_ORIGIN = "https://teamvinsible.com";

function assert(condition, message) {
  if (!condition) throw new Error(`SEO validation failed: ${message}`);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function meta(html, attributeName, key) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  const tag = tags.find((candidate) => attribute(candidate, attributeName) === key);
  return tag ? attribute(tag, "content") : undefined;
}

function canonical(html) {
  const tags = html.match(/<link\s+[^>]*>/gi) ?? [];
  const tag = tags.find((candidate) => attribute(candidate, "rel") === "canonical");
  return tag ? attribute(tag, "href") : undefined;
}

function jsonLd(html) {
  const match = html.match(
    /<script\s+[^>]*id=["']seo-json-ld["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  return match ? JSON.parse(match[1]) : undefined;
}

async function htmlFile(route) {
  return readFile(path.join(distDir, `${route}.html`), "utf8");
}

const publicRoutes = [
  { file: "index", url: `${SITE_ORIGIN}/` },
  { file: "terms", url: `${SITE_ORIGIN}/terms` },
  { file: "privacy", url: `${SITE_ORIGIN}/privacy` },
];

for (const route of publicRoutes) {
  const html = await htmlFile(route.file);
  const data = jsonLd(html);
  assert(meta(html, "name", "robots")?.startsWith("index, follow"), `${route.file} must be indexable`);
  assert(canonical(html) === route.url, `${route.file} canonical must be ${route.url}`);
  assert(meta(html, "property", "og:url") === route.url, `${route.file} Open Graph URL must match its canonical`);
  assert(meta(html, "property", "og:image") === `${SITE_ORIGIN}/social-card.png`, `${route.file} must use the raster social card`);
  assert(meta(html, "name", "twitter:card") === "summary_large_image", `${route.file} must have a large Twitter card`);
  assert(data?.["@context"] === "https://schema.org", `${route.file} must contain valid schema.org JSON-LD`);
}

const privateRoutes = ["login", "signup", "dashboard", "auth/callback"];
for (const route of privateRoutes) {
  const html = await htmlFile(route);
  assert(meta(html, "name", "robots")?.startsWith("noindex"), `${route} must be noindex`);
  assert(!canonical(html), `${route} must not advertise a public canonical`);
  assert(!meta(html, "property", "og:url"), `${route} must not inherit public Open Graph data`);
  assert(!jsonLd(html), `${route} must not inherit public JSON-LD`);
}

const notFound = await htmlFile("404");
assert(meta(notFound, "name", "robots")?.startsWith("noindex"), "404 must be noindex");
assert(notFound.includes("Page not found"), "404 must contain a meaningful error message");

for (const [file, width, height] of [
  ["social-card.png", 1200, 630],
  ["logo-512.png", 512, 512],
]) {
  const png = await readFile(path.join(distDir, file));
  assert(png.subarray(1, 4).toString("ascii") === "PNG", `${file} must be a PNG`);
  assert(png.readUInt32BE(16) === width && png.readUInt32BE(20) === height, `${file} must be ${width}x${height}`);
}

const manifest = JSON.parse(await readFile(path.join(distDir, "site.webmanifest"), "utf8"));
assert(manifest.icons?.some((icon) => icon.src === "/logo-512.png"), "manifest must include the 512px logo");

const robots = await readFile(path.join(distDir, "robots.txt"), "utf8");
assert(robots.includes("User-agent: *") && robots.includes("Allow: /"), "robots.txt must allow public crawling");
assert(robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`), "robots.txt must declare the sitemap");

const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
for (const { url } of publicRoutes) assert(sitemap.includes(`<loc>${url}</loc>`), `sitemap must include ${url}`);
for (const route of privateRoutes) assert(!sitemap.includes(`<loc>${SITE_ORIGIN}/${route}`), `sitemap must exclude ${route}`);

const headers = await readFile(path.join(distDir, "_headers"), "utf8");
assert(headers.includes("pages.dev/*") && headers.includes("X-Robots-Tag: noindex"), "preview deployments must be noindex");
assert(headers.includes("/dashboard/*"), "dashboard routes must send an X-Robots-Tag header");

const redirects = await readFile(path.join(distDir, "_redirects"), "utf8");
assert(redirects.includes("/dashboard/* /dashboard.html 200"), "dynamic dashboard routes must use the private shell");

console.log(`SEO validation passed for ${publicRoutes.length + privateRoutes.length + 1} route shells.`);
