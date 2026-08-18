import { readFile } from "node:fs/promises";
import path from "node:path";

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
if (!token || !zoneId) {
  throw new Error(
    "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required to purge the cache",
  );
}

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "assets.manifest.json"), "utf8"),
);
const urls = [
  ...new Set([
    new URL("/", manifest.origin).href,
    new URL(`/${manifest.errorDocument.path}`, manifest.origin).href,
    ...manifest.resources.map(
      ({ path: relativePath }) =>
        new URL(`/${relativePath}`, manifest.origin).href,
    ),
  ]),
];

const response = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "guitard-assets-deployer/1.0",
    },
    body: JSON.stringify({ files: urls }),
    signal: AbortSignal.timeout(30_000),
  },
);
const result = await response.json();
if (!response.ok || result.success !== true) {
  const messages = (result.errors ?? [])
    .map(({ code, message }) => `${code}: ${message}`)
    .join("; ");
  throw new Error(
    `Cloudflare cache purge failed with HTTP ${response.status}${messages ? ` (${messages})` : ""}`,
  );
}

console.log(`Purged ${urls.length} asset URLs from Cloudflare.`);
