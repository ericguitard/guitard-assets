import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const braces = require("braces");
const fromStylelint = createRequire(require.resolve("stylelint"));
const micromatch = fromStylelint("micromatch");

test("patched braces preserves glob alternatives, ranges, escaping, and nested groups", () => {
  assert.deepEqual(braces.expand("src/{app,lib}/{1..3}.ts"), [
    "src/app/1.ts",
    "src/app/2.ts",
    "src/app/3.ts",
    "src/lib/1.ts",
    "src/lib/2.ts",
    "src/lib/3.ts",
  ]);
  assert.deepEqual(braces.expand("{a,{b,c}}"), ["a", "b", "c"]);
  assert.equal(
    braces.stringify(braces.parse("src/{app,lib}/*.tsx")),
    "src/{app,lib}/*.tsx",
  );
  assert.deepEqual(
    micromatch(["app/a.ts", "lib/b.ts", "public/c.js"], "{app,lib}/**/*.ts"),
    ["app/a.ts", "lib/b.ts"],
  );
});

test("rejects deeply nested braces and parentheses before recursive walking", () => {
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
  ]) {
    for (const count of [64, 1000, 10000]) {
      const pattern = open.repeat(count) + "a,b" + close.repeat(count);
      for (const operation of [
        braces,
        braces.parse,
        braces.compile,
        braces.expand,
        braces.stringify,
      ]) {
        assert.throws(() => operation(pattern, { maxLength: Infinity }), {
          name: "SyntaxError",
        });
      }
      assert.throws(() => micromatch.braceExpand(pattern + "{c,d}"), {
        name: "SyntaxError",
      });
    }
  }
});

test("guards caller-supplied ASTs, cycles, and direct walker imports", () => {
  let ast = { type: "text", value: "a" };
  for (let i = 0; i < 1000; i++) ast = { type: "root", nodes: [ast] };
  const cycle = { type: "root", nodes: [] };
  cycle.nodes.push(cycle);
  for (const operation of [
    braces.compile,
    braces.expand,
    braces.stringify,
    require("braces/lib/compile"),
    require("braces/lib/expand"),
    require("braces/lib/stringify"),
  ]) {
    for (const input of [ast, cycle]) {
      assert.throws(() => operation(input), { name: "SyntaxError" });
    }
  }
});

test("micromatch resolves the locally patched braces dependency", () => {
  const fromMicromatch = createRequire(fromStylelint.resolve("micromatch"));
  assert.equal(fromMicromatch.resolve("braces"), require.resolve("braces"));
  assert.equal(require("braces/package.json").version, "3.0.3-guitard.1");
});
