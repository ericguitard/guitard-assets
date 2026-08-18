import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];
const manifest = JSON.parse(
  await readFile(path.join(root, "assets.manifest.json"), "utf8"),
);

function fail(message) {
  failures.push(message);
}

function isSafeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath) return false;
  if (path.isAbsolute(relativePath) || relativePath.includes("\\"))
    return false;
  const normalized = path.posix.normalize(relativePath);
  return normalized === relativePath && !normalized.startsWith("../");
}

async function isFile(relativePath) {
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
  try {
    const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    const normalized = path.posix.normalize(pathname);
    if (!normalized.startsWith("/") || normalized.includes("..")) return null;
    return normalized.slice(1);
  } catch {
    return null;
  }
}

async function walk(relativeDirectory = "") {
  const entries = await readdir(path.join(root, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    if ([".git", ".pages", "node_modules"].includes(entry.name)) continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function validatePng(data, resource) {
  if (
    data.length < 24 ||
    data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    fail(`${resource.path} is not a valid PNG file`);
    return;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== resource.width || height !== resource.height) {
    fail(
      `${resource.path} must be ${resource.width}x${resource.height}, found ${width}x${height}`,
    );
  }
}

function validateIco(data, relativePath) {
  if (
    data.length < 6 ||
    data.readUInt16LE(0) !== 0 ||
    data.readUInt16LE(2) !== 1
  ) {
    fail(`${relativePath} does not contain a valid ICO directory`);
    return;
  }
  const count = data.readUInt16LE(4);
  if (count < 1 || data.length < 6 + count * 16) {
    fail(`${relativePath} has an invalid ICO entry table`);
    return;
  }
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (size < 1 || offset < 6 + count * 16 || offset + size > data.length) {
      fail(`${relativePath} has an invalid ICO image entry at index ${index}`);
    }
  }
}

function validateSvg(svg, resource) {
  const rootTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!rootTag || !/<title\b/i.test(svg)) {
    fail(`${resource.path} must contain an SVG root and accessible title`);
  }
  if (/<script\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    fail(`${resource.path} must not contain executable script content`);
  }
  if (/\s(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i.test(svg)) {
    fail(`${resource.path} must not reference external resources`);
  }

  if (resource.profile === "bimi-tiny-ps" && rootTag) {
    if (attribute(rootTag, "version") !== "1.2") {
      fail(`${resource.path} must declare SVG version 1.2 for BIMI`);
    }
    if (attribute(rootTag, "baseProfile") !== "tiny-ps") {
      fail(`${resource.path} must declare baseProfile tiny-ps for BIMI`);
    }
    const viewBox = attribute(rootTag, "viewBox")
      ?.trim()
      .split(/\s+/)
      .map(Number);
    if (
      !viewBox ||
      viewBox.length !== 4 ||
      viewBox.some((value) => !Number.isFinite(value)) ||
      viewBox[2] !== viewBox[3]
    ) {
      fail(`${resource.path} must use a square BIMI viewBox`);
    }
    if (/<style\b/i.test(svg) || /\sstyle\s*=/i.test(svg)) {
      fail(`${resource.path} must not contain CSS in its BIMI Tiny-PS profile`);
    }
  }
}

if (manifest.version !== 1) fail("assets.manifest.json must use version 1");
if (manifest.origin !== "https://assets.guitard.ca") {
  fail("assets.manifest.json origin must be https://assets.guitard.ca");
}

const resourcePaths = new Set();
for (const resource of manifest.resources ?? []) {
  if (!isSafeRelativePath(resource.path)) {
    fail(
      `Manifest contains unsafe resource path ${JSON.stringify(resource.path)}`,
    );
    continue;
  }
  if (resourcePaths.has(resource.path)) {
    fail(`Manifest contains duplicate resource ${resource.path}`);
    continue;
  }
  resourcePaths.add(resource.path);
  if (typeof resource.contentType !== "string" || !resource.contentType) {
    fail(`${resource.path} is missing contentType in the manifest`);
  }
  if (typeof resource.cacheControl !== "string" || !resource.cacheControl) {
    fail(`${resource.path} is missing cacheControl in the manifest`);
  }
  if (!(await isFile(resource.path))) {
    fail(`Manifest resource is missing: ${resource.path}`);
    continue;
  }

  const data = await readFile(path.join(root, resource.path));
  if (resource.contentType === "image/png") validatePng(data, resource);
  if (resource.contentType === "image/vnd.microsoft.icon") {
    validateIco(data, resource.path);
  }
  if (resource.contentType === "image/svg+xml") {
    validateSvg(data.toString("utf8"), resource);
  }
}

for (const relativePath of manifest.siteFiles ?? []) {
  if (!isSafeRelativePath(relativePath) || !(await isFile(relativePath))) {
    fail(`Site file is missing or unsafe: ${JSON.stringify(relativePath)}`);
  }
}

const publicExtensions = new Set([
  ".css",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
]);
const discoveredPublicFiles = (await walk()).filter(
  (relativePath) =>
    publicExtensions.has(path.posix.extname(relativePath).toLowerCase()) ||
    relativePath === "robots.txt",
);
for (const relativePath of discoveredPublicFiles) {
  if (!resourcePaths.has(relativePath)) {
    fail(
      `Public resource is not declared in assets.manifest.json: ${relativePath}`,
    );
  }
}

const cname = (await readFile(path.join(root, "CNAME"), "utf8")).trim();
if (cname !== manifest.cname) {
  fail(`CNAME must contain ${manifest.cname}, found ${JSON.stringify(cname)}`);
}

const html = await readFile(
  path.join(root, manifest.errorDocument.path),
  "utf8",
);
const references = [];
for (const tag of html.match(/<(?:a|img|link|script)\b[^>]*>/gi) ?? []) {
  references.push(attribute(tag, "href") ?? attribute(tag, "src"));
}
for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
  const key = attribute(tag, "property") ?? attribute(tag, "name");
  if (["og:image", "twitter:image"].includes(key)) {
    references.push(attribute(tag, "content"));
  }
}
for (const reference of references) {
  const target = localTarget(reference);
  if (target && !(await isFile(target))) {
    fail(
      `${manifest.errorDocument.path} references missing local resource ${reference}`,
    );
  }
}
if (/<script\b(?![^>]*\bsrc\s*=)/i.test(html)) {
  fail(`${manifest.errorDocument.path} must not contain inline scripts`);
}
if (/<style\b/i.test(html) || /\sstyle\s*=/i.test(html)) {
  fail(`${manifest.errorDocument.path} must not contain inline styles`);
}
if (/\son[a-z]+\s*=/i.test(html)) {
  fail(`${manifest.errorDocument.path} must not contain inline event handlers`);
}

const robots = await readFile(path.join(root, "robots.txt"), "utf8");
for (const directive of [
  "User-agent: *",
  "Content-Signal: search=yes, ai-input=no, ai-train=no",
  "Allow: /",
]) {
  if (!robots.includes(directive)) fail(`robots.txt is missing ${directive}`);
}

const headers = await readFile(path.join(root, "_headers"), "utf8");
for (const value of [
  `Access-Control-Allow-Origin: ${manifest.headers.accessControlAllowOrigin}`,
  `Cross-Origin-Resource-Policy: ${manifest.headers.crossOriginResourcePolicy}`,
  `Content-Security-Policy: ${manifest.headers.contentSecurityPolicy}`,
  `X-Content-Type-Options: ${manifest.headers.xContentTypeOptions}`,
  `Cache-Control: ${manifest.errorDocument.cacheControl}`,
  `Content-Type: ${manifest.errorDocument.contentType}`,
]) {
  if (!headers.includes(value)) fail(`_headers is missing ${value}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${resourcePaths.size} manifested resources, deployment files, local references, BIMI requirements, robots rules, and header documentation.`,
  );
}
