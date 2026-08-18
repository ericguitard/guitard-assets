import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];

const expectedPngDimensions = new Map([
  ["android-chrome-192x192.png", [192, 192]],
  ["android-chrome-512x512.png", [512, 512]],
  ["android-chrome-maskable-192x192.png", [192, 192]],
  ["android-chrome-maskable-512x512.png", [512, 512]],
  ["apple-touch-icon.png", [180, 180]],
  ["favicon-16x16.png", [16, 16]],
  ["favicon-32x32.png", [32, 32]],
  ["favicon-96x96.png", [96, 96]],
  ["og-image.png", [1200, 630]],
  ["screenshot-mobile.png", [750, 1334]],
  ["screenshot-wide.png", [1280, 720]],
]);

const expectedCsp =
  "default-src 'none'; script-src https://static.cloudflareinsights.com; script-src-attr 'none'; connect-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function exists(relativePath) {
  try {
    return (await stat(path.join(root, relativePath))).isFile();
  } catch {
    return false;
  }
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? match[2] : null;
}

function localTarget(reference) {
  if (!reference?.startsWith("/") || reference.startsWith("//")) return null;
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const normalized = path.posix.normalize(pathname);
  if (!normalized.startsWith("/") || normalized.includes("..")) return null;
  return normalized.slice(1);
}

const cname = (await readFile(path.join(root, "CNAME"), "utf8")).trim();
if (cname !== "assets.guitard.ca") {
  failures.push(
    `CNAME must contain assets.guitard.ca, found ${JSON.stringify(cname)}`,
  );
}

const html = await readFile(path.join(root, "404.html"), "utf8");
for (const tag of html.match(/<(?:a|img|link|script)\b[^>]*>/gi) ?? []) {
  const reference = attribute(tag, "href") ?? attribute(tag, "src");
  const target = localTarget(reference);
  if (target && !(await exists(target))) {
    failures.push(`404.html references missing local resource ${reference}`);
  }
}

if (/<script\b(?![^>]*\bsrc\s*=)/i.test(html)) {
  failures.push("404.html must not contain inline scripts");
}
if (/<style\b/i.test(html) || /\sstyle\s*=/i.test(html)) {
  failures.push("404.html must not contain inline styles");
}
if (/\son[a-z]+\s*=/i.test(html)) {
  failures.push("404.html must not contain inline event handlers");
}

for (const [file, [expectedWidth, expectedHeight]] of expectedPngDimensions) {
  const data = await readFile(path.join(root, file));
  const signature = data.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    failures.push(`${file} is not a valid PNG file`);
    continue;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    failures.push(
      `${file} must be ${expectedWidth}x${expectedHeight}, found ${width}x${height}`,
    );
  }
}

const ico = await readFile(path.join(root, "favicon.ico"));
if (
  ico.readUInt16LE(0) !== 0 ||
  ico.readUInt16LE(2) !== 1 ||
  ico.readUInt16LE(4) < 1
) {
  failures.push("favicon.ico does not contain a valid ICO directory");
}

for (const file of ["bimi-logo.svg", "favicon.svg"]) {
  const svg = await readFile(path.join(root, file), "utf8");
  if (!/<svg\b/i.test(svg) || !/<title\b/i.test(svg)) {
    failures.push(`${file} must contain an SVG root and accessible title`);
  }
  if (/<script\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    failures.push(`${file} must not contain executable script content`);
  }
}

const robots = await readFile(path.join(root, "robots.txt"), "utf8");
for (const directive of [
  "User-agent: *",
  "Content-Signal: search=yes, ai-input=no, ai-train=no",
  "Allow: /",
]) {
  if (!robots.includes(directive))
    failures.push(`robots.txt is missing ${directive}`);
}

const headers = await readFile(path.join(root, "_headers"), "utf8");
for (const value of [
  "Access-Control-Allow-Origin: *",
  "Cross-Origin-Resource-Policy: cross-origin",
  `Content-Security-Policy: ${expectedCsp}`,
  "Cache-Control: max-age=14400",
  "Content-Type: text/html; charset=utf-8",
]) {
  if (!headers.includes(value)) failures.push(`_headers is missing ${value}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Asset files, dimensions, local references, robots rules, and header documentation are valid.",
  );
}
