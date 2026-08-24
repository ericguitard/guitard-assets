import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveSafeRegularFile } from "./stage-pages.mjs";

test("the Pages packager accepts only regular files inside the repository", async (t) => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "guitard-assets-stage-"),
  );
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const root = path.join(fixture, "repository");
  await mkdir(root);
  await writeFile(path.join(root, "asset.txt"), "safe\n");
  assert.equal(
    await resolveSafeRegularFile(root, "asset.txt"),
    await realpath(path.join(root, "asset.txt")),
  );

  await assert.rejects(
    resolveSafeRegularFile(root, "../outside.txt"),
    /unsafe path/u,
  );

  const outside = path.join(fixture, "outside.txt");
  const link = path.join(root, "leak.txt");
  await writeFile(outside, "must not be published\n");
  try {
    await symlink(outside, link, "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.diagnostic(
        "symbolic-link assertion skipped because this host forbids creating test links",
      );
      return;
    }
    throw error;
  }

  await assert.rejects(
    resolveSafeRegularFile(root, "leak.txt"),
    /symbolic link/u,
  );
});
