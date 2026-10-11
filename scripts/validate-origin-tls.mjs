import { resolve4 } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { connect } from "node:tls";
import { pathToFileURL } from "node:url";

// Resolve Pages itself, not the proxied custom domain: the edge certificate
// can be healthy while Cloudflare rejects an expired origin certificate.
export async function validateOriginTls(
  hostname,
  { resolveAddresses = resolve4, connectTls = connect, now = Date.now() } = {},
) {
  const addresses = await resolveAddresses("ericguitard.github.io");
  if (!addresses.length)
    throw new Error("GitHub Pages returned no IPv4 addresses");
  return Promise.all(
    addresses.map(
      (address) =>
        new Promise((resolve) => {
          let socket;
          let settled = false;
          const finish = (failure) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ address, failure });
          };
          socket = connectTls({
            host: address,
            port: 443,
            servername: hostname,
            rejectUnauthorized: true,
          });
          socket.once("secureConnect", () => {
            if (!socket.authorized) {
              finish(`certificate rejected: ${socket.authorizationError}`);
              return;
            }
            const expires = Date.parse(socket.getPeerCertificate().valid_to);
            const days = (expires - now) / 86_400_000;
            finish(
              !Number.isFinite(days) || days < 30
                ? `origin certificate has ${Number.isFinite(days) ? days.toFixed(1) : "unknown"} days remaining; renew before the 30-day threshold`
                : undefined,
            );
          });
          socket.setTimeout(15_000, () => finish("origin TLS check timed out"));
          socket.once("error", (error) =>
            finish(`origin TLS failed: ${error.code ?? error.message}`),
          );
          socket.once("close", () => {
            if (!settled)
              finish("origin closed before TLS verification completed");
          });
        }),
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const hostname = (
      await readFile(new URL("../CNAME", import.meta.url), "utf8")
    ).trim();
    const results = await validateOriginTls(hostname);
    for (const { address, failure } of results) {
      if (failure) {
        console.error(
          `${hostname} via GitHub Pages ${address}: ${failure}. See DEPLOYMENT.md: Origin certificate recovery.`,
        );
        process.exitCode = 1;
      } else {
        console.log(
          `${hostname} via GitHub Pages ${address}: trusted certificate with at least 30 days remaining.`,
        );
      }
    }
  } catch (error) {
    console.error(`Origin certificate monitoring failed: ${error.message}`);
    process.exitCode = 1;
  }
}
