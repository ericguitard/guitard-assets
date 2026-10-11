import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { validateOriginTls } from "./validate-origin-tls.mjs";

const now = Date.UTC(2026, 9, 11);

async function probe(outcomes) {
  const sockets = [];
  const results = await validateOriginTls("assets.guitard.ca", {
    now,
    resolveAddresses: async (host) => {
      assert.equal(host, "ericguitard.github.io");
      return Object.keys(outcomes);
    },
    connectTls(options) {
      assert.equal(options.servername, "assets.guitard.ca");
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.port, 443);
      const outcome = outcomes[options.host];
      const socket = new EventEmitter();
      socket.authorized = true;
      socket.destroy = () => {
        socket.destroyed = true;
      };
      socket.getPeerCertificate = () => ({
        valid_to: new Date(now + outcome.days * 86_400_000).toUTCString(),
      });
      socket.setTimeout = (delay, callback) => {
        assert.equal(delay, 15_000);
        socket.timeout = callback;
      };
      sockets.push(socket);
      queueMicrotask(() => {
        if (outcome.error) socket.emit("error", { code: outcome.error });
        else if (outcome.timeout) socket.timeout();
        else if (outcome.close) socket.emit("close");
        else socket.emit("secureConnect");
      });
      return socket;
    },
  });
  assert.ok(sockets.every((socket) => socket.destroyed));
  return results;
}

test("checks every Pages address and detects expired origin despite healthy peers", async () => {
  const results = await probe({
    first: { days: 60 },
    second: { error: "CERT_HAS_EXPIRED" },
  });
  assert.equal(results[0].failure, undefined);
  assert.match(results[1].failure, /CERT_HAS_EXPIRED/u);
});

test("alerts before expiration and accepts the 30-day boundary", async () => {
  const results = await probe({
    soon: { days: 29 },
    boundary: { days: 30 },
    expired: { days: -1 },
  });
  assert.match(results[0].failure, /29.0 days/u);
  assert.equal(results[1].failure, undefined);
  assert.match(results[2].failure, /-1.0 days/u);
});

test("fails closed on timeout, early disconnect, invalid expiry and hostname rejection", async () => {
  const results = await probe({
    timeout: { timeout: true },
    close: { close: true },
    invalid: {},
    wrongHost: { error: "ERR_TLS_CERT_ALTNAME_INVALID" },
  });
  assert.ok(results.every(({ failure }) => failure));
});

test("DNS failures and empty origin pools cannot pass", async () => {
  await assert.rejects(
    validateOriginTls("assets.guitard.ca", {
      resolveAddresses: async () => [],
    }),
    /no IPv4/u,
  );
  await assert.rejects(
    validateOriginTls("assets.guitard.ca", {
      resolveAddresses: async () => {
        throw new Error("DNS unavailable");
      },
    }),
    /DNS unavailable/u,
  );
});
