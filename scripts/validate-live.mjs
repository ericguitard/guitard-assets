import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://assets.guitard.ca";
const root = process.cwd();
const failures = [];
const expectedCsp =
  "default-src 'none'; script-src https://static.cloudflareinsights.com; script-src-attr 'none'; connect-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function request(pathname) {
  return fetch(`${origin}${pathname}`, {
    redirect: "manual",
    headers: {
      "Cache-Control": "no-cache",
      "User-Agent": "guitard-assets-validator/1.0",
    },
  });
}

function expectHeader(response, name, expected, pathname) {
  const actual = response.headers.get(name);
  if (actual !== expected) {
    failures.push(
      `${pathname}: expected ${name} ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
}

const rootResponse = await request("/");
if (rootResponse.status !== 301) {
  failures.push(`/: expected 301, found ${rootResponse.status}`);
}
expectHeader(rootResponse, "location", "https://guitard.ca/", "/");

const assets = [
  ["/favicon.svg", "image/svg+xml"],
  ["/favicon.ico", "image/vnd.microsoft.icon"],
  ["/og-image.png", "image/png"],
  ["/bimi-logo.svg", "image/svg+xml"],
  ["/robots.txt", "text/plain; charset=utf-8"],
  ["/css/style.css", "text/css; charset=utf-8"],
];

for (const [pathname, contentType] of assets) {
  const response = await request(pathname);
  if (response.status !== 200) {
    failures.push(`${pathname}: expected 200, found ${response.status}`);
    continue;
  }
  expectHeader(response, "content-type", contentType, pathname);
  expectHeader(response, "cache-control", "max-age=14400", pathname);
  expectHeader(response, "access-control-allow-origin", "*", pathname);
  expectHeader(
    response,
    "cross-origin-resource-policy",
    "cross-origin",
    pathname,
  );
  expectHeader(response, "content-security-policy", expectedCsp, pathname);
  expectHeader(response, "x-content-type-options", "nosniff", pathname);
}

const missingPath = `/missing-asset-${Date.now()}.png`;
const missingResponse = await request(missingPath);
if (missingResponse.status !== 404) {
  failures.push(
    `${missingPath}: expected 404, found ${missingResponse.status}`,
  );
} else {
  expectHeader(
    missingResponse,
    "content-type",
    "text/html; charset=utf-8",
    missingPath,
  );
  const missingHtml = await missingResponse.text();
  if (!missingHtml.includes("Image Not Found.")) {
    failures.push(`${missingPath}: custom 404 page content was not returned`);
  }
}

const localRobots = (
  await readFile(path.join(root, "robots.txt"), "utf8")
).replaceAll("\r\n", "\n");
const liveRobotsResponse = await request("/robots.txt");
const liveRobots = (await liveRobotsResponse.text()).replaceAll("\r\n", "\n");
if (localRobots !== liveRobots) {
  failures.push(
    "/robots.txt does not match the committed file after line-ending normalization",
  );
}

if (failures.length) {
  console.error(
    `Live asset validation failed:\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "Live asset origin, redirects, MIME types, caching, CORS, CSP, and custom 404 are valid.",
  );
}
