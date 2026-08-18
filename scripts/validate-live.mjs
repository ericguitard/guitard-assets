import { readFile } from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "assets.manifest.json"), "utf8"),
);
const attempts = Math.max(
  1,
  Number.parseInt(process.env.LIVE_VALIDATE_ATTEMPTS ?? "1", 10),
);
const retryDelayMs = Math.max(
  0,
  Number.parseInt(process.env.LIVE_VALIDATE_DELAY_MS ?? "10000", 10),
);

function normalizedText(buffer) {
  return buffer.toString("utf8").replaceAll("\r\n", "\n");
}

function isTextResource(resource) {
  return (
    resource.contentType.startsWith("text/") ||
    resource.contentType === "image/svg+xml"
  );
}

async function request(base, pathname) {
  return fetch(new URL(pathname, base), {
    redirect: "manual",
    headers: {
      "Cache-Control": "no-cache",
      "User-Agent": "guitard-assets-validator/2.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function validateCertificate(hostname, minimumDays, failures) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: true,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        const validTo = Date.parse(certificate.valid_to);
        const remainingDays = (validTo - Date.now()) / 86_400_000;
        if (!Number.isFinite(remainingDays) || remainingDays < minimumDays) {
          failures.push(
            `TLS certificate must remain valid for at least ${minimumDays} days; found ${remainingDays.toFixed(1)}`,
          );
        }
        socket.end();
        finish();
      },
    );
    socket.setTimeout(15_000, () => {
      if (settled) return;
      failures.push("TLS certificate check timed out");
      socket.destroy();
      finish();
    });
    socket.on("error", (error) => {
      if (settled) return;
      failures.push(`TLS certificate check failed: ${error.message}`);
      finish();
    });
  });
}

function expectHeader(response, name, expected, pathname, failures) {
  const actual = response.headers.get(name);
  if (actual !== expected) {
    failures.push(
      `${pathname}: expected ${name} ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
}

function validateHsts(response, pathname, failures) {
  const value = response.headers.get("strict-transport-security") ?? "";
  const maxAge = Number.parseInt(
    value.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1] ?? "",
    10,
  );
  if (
    !Number.isFinite(maxAge) ||
    maxAge < manifest.monitoring.hstsMinimumMaxAge
  ) {
    failures.push(
      `${pathname}: Strict-Transport-Security max-age must be at least ${manifest.monitoring.hstsMinimumMaxAge}, found ${JSON.stringify(value)}`,
    );
  }
  if (
    manifest.monitoring.hstsIncludeSubDomains &&
    !/;\s*includeSubDomains(?:;|$)/i.test(value)
  ) {
    failures.push(
      `${pathname}: Strict-Transport-Security must include includeSubDomains`,
    );
  }
  if (manifest.monitoring.hstsPreload && !/;\s*preload(?:;|$)/i.test(value)) {
    failures.push(
      `${pathname}: Strict-Transport-Security must include preload`,
    );
  }
}

async function validateOnce() {
  const failures = [];
  const origin = new URL(manifest.origin);

  await validateCertificate(
    origin.hostname,
    manifest.monitoring.minimumCertificateValidityDays,
    failures,
  );

  const rootResponse = await request(origin, "/");
  if (rootResponse.status !== 301) {
    failures.push(`/: expected 301, found ${rootResponse.status}`);
  }
  expectHeader(rootResponse, "location", manifest.rootRedirect, "/", failures);

  const redirectPath = `/${manifest.resources[0].path}`;
  const httpOrigin = new URL(manifest.origin);
  httpOrigin.protocol = "http:";
  const httpResponse = await request(httpOrigin, redirectPath);
  if (![301, 308].includes(httpResponse.status)) {
    failures.push(
      `${redirectPath} over HTTP: expected 301 or 308, found ${httpResponse.status}`,
    );
  }
  expectHeader(
    httpResponse,
    "location",
    new URL(redirectPath, manifest.origin).href,
    `${redirectPath} over HTTP`,
    failures,
  );

  let hstsValidated = false;
  for (const resource of manifest.resources) {
    const pathname = `/${resource.path}`;
    const response = await request(origin, pathname);
    if (response.status !== 200) {
      failures.push(`${pathname}: expected 200, found ${response.status}`);
      continue;
    }
    expectHeader(
      response,
      "content-type",
      resource.contentType,
      pathname,
      failures,
    );
    expectHeader(
      response,
      "cache-control",
      resource.cacheControl,
      pathname,
      failures,
    );
    expectHeader(
      response,
      "access-control-allow-origin",
      manifest.headers.accessControlAllowOrigin,
      pathname,
      failures,
    );
    expectHeader(
      response,
      "cross-origin-resource-policy",
      manifest.headers.crossOriginResourcePolicy,
      pathname,
      failures,
    );
    expectHeader(
      response,
      "content-security-policy",
      manifest.headers.contentSecurityPolicy,
      pathname,
      failures,
    );
    expectHeader(
      response,
      "x-content-type-options",
      manifest.headers.xContentTypeOptions,
      pathname,
      failures,
    );
    if (!hstsValidated) {
      validateHsts(response, pathname, failures);
      hstsValidated = true;
    }

    const liveData = Buffer.from(await response.arrayBuffer());
    const localData = await readFile(path.join(root, resource.path));
    const matches = isTextResource(resource)
      ? normalizedText(liveData) === normalizedText(localData)
      : liveData.equals(localData);
    if (!matches) {
      failures.push(
        `${pathname}: deployed content does not match the committed file`,
      );
    }
  }

  const missingPath = `/missing-asset-${Date.now()}.png`;
  const missingResponse = await request(origin, missingPath);
  if (missingResponse.status !== 404) {
    failures.push(
      `${missingPath}: expected 404, found ${missingResponse.status}`,
    );
  } else {
    expectHeader(
      missingResponse,
      "content-type",
      manifest.errorDocument.contentType,
      missingPath,
      failures,
    );
    expectHeader(
      missingResponse,
      "cache-control",
      manifest.errorDocument.cacheControl,
      missingPath,
      failures,
    );
    const missingHtml = await missingResponse.text();
    if (!missingHtml.includes(manifest.errorDocument.marker)) {
      failures.push(`${missingPath}: custom 404 page content was not returned`);
    }
  }

  return failures;
}

let finalFailures = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    finalFailures = await validateOnce();
  } catch (error) {
    finalFailures = [`Unexpected live validation error: ${error.message}`];
  }
  if (!finalFailures.length) break;
  if (attempt < attempts) {
    console.warn(
      `Live validation attempt ${attempt}/${attempts} failed; retrying in ${retryDelayMs}ms.`,
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

if (finalFailures.length) {
  console.error(
    `Live asset validation failed:\n\n${finalFailures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${manifest.resources.length} live resources, deployed content, redirects, TLS, HSTS, MIME types, caching, CORS, CSP, and the custom 404.`,
  );
}
