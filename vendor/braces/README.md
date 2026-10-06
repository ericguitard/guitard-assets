# Local braces security patch

This is the MIT-licensed `braces@3.0.3` source from npm, with a local patch for
GHSA-vfj7-8cjw-p6xm (CVE-2026-93687). No upstream patched release was available
on 2026-10-05. The local version suffix identifies this fork; it does not claim
to be an upstream release.

The parser rejects nesting before its stack reaches 64 levels, including both
parentheses and braces. The compile, expand, and stringify entry points use an
iterative depth and cycle check before running their recursive AST walkers.
Ordinary patterns retain upstream behavior. Excessive nesting throws a
`SyntaxError`, even when a caller supplies its own AST or raises `maxLength`.

The root dependency and override route every micromatch consumer through this
copy. The pnpm lockfile records the local dependency for reproducible frozen installs.
Regression tests exercise normal glob behavior and hostile inputs through both
braces and micromatch. Keep these tests when replacing this fork with an upstream
fix. pnpm audit cannot assess locally patched source, so these tests are required
in addition to the unchanged security audit gate.

Upstream: https://github.com/micromatch/braces/tree/3.0.3
Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
Original copyright and MIT license are retained in LICENSE.
