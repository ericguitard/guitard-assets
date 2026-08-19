# Validation, Deployment, and Repository Configuration

This document is the single source of truth for validation, release, hosting configuration, and rollback procedures for `assets.guitard.ca`.

`assets.manifest.json` defines every public resource path, expected MIME type, cache policy, and image dimension. Pull requests run the repository checks, while production deploys only the resources declared in that manifest.

This guide configures `guitard-assets` so that pull requests are validated, production deploys only after validation, Cloudflare is purged after deployment, and the public origin is smoke-tested after every release and once per day.

## 1. Prepare and Validate

1. On GitHub, upload the changed files to a new branch created from the current `main` branch. GitHub web commits are signed by GitHub and satisfy the signed commit rule.
2. Open a pull request for the web-upload branch.
3. Install Node.js 24 and pnpm 11.19.0.
4. Run:

   ```text
   pnpm install --frozen-lockfile
   pnpm run check
   pnpm run stage:pages
   ```

5. Open a pull request for the web-upload branch.
6. Confirm the `Validate / Validate repository` check runs automatically and succeeds.

## 2. Configure the GitHub Pages source

Before merging the pull request:

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Keep the custom domain set to `assets.guitard.ca`.
5. Keep **Enforce HTTPS** enabled.

The current production deployment remains available while the new workflow is prepared. The next push to `main` will run `.github/workflows/deploy.yml`.

## 3. Protect `main`

Open **Settings → Rules → Rulesets → Protect main** and retain the current rules:

- Restrict deletions
- Require linear history
- Require signed commits
- Block force pushes

Add these rules after the pull-request validation check has appeared once:

1. **Require a pull request before merging**.
2. Set required approvals to `0` for a solo-maintainer repository, or `1` when a second reviewer is available.
3. Enable **Require conversation resolution before merging**.
4. Add **Require status checks to pass**.
5. Select `Validate / Validate repository`.
6. Enable the option requiring the branch to be current before merging, if it is available for the repository plan.

Do not add a bypass unless an emergency release procedure requires one.

## 4. Protect the Pages environment

1. Go to **Settings → Environments**.
2. Open or create the `github-pages` environment.
3. Under deployment branches and tags, allow only `main`.
4. For a solo maintainer, leave required reviewers disabled. For a team, add a reviewer and prevent self-review if independent approval is required.

The deploy job already grants only `contents: read`, `pages: write`, and `id-token: write` to the step that publishes the Pages artifact.

Under **Settings → Actions → General**:

1. Keep GitHub-authored actions enabled. The workflows do not require any third-party actions.
2. Set the default workflow permission to **Read repository contents and packages**.
3. Leave **Allow GitHub Actions to create and approve pull requests** disabled unless a separate automation explicitly requires it.

## 5. Configure the Cloudflare cache-purge credential

The purge is optional but recommended because it prevents a previously cached 404 or asset from surviving a deployment.

1. In Cloudflare, create a custom API token.
2. Grant only **Zone → Cache Purge → Purge**.
3. Restrict the token to the `guitard.ca` zone.
4. Copy the zone ID from the Cloudflare zone overview.
5. In GitHub, go to **Settings → Secrets and variables → Actions**.
6. Create repository secret `CLOUDFLARE_API_TOKEN` containing the token.
7. Create repository variable `CLOUDFLARE_ZONE_ID` containing the zone ID.

The workflow purges only exact URLs: declared public resources, the generated deployment marker, the root and error document, versioned query-string variants, and non-public paths that could have been cached by an earlier deployment. It batches requests at Cloudflare's 100-URL limit. If either value is absent, the purge is skipped and the smoke test still runs with retries.

## 6. Configure Cloudflare delivery rules

### DNS and TLS

Confirm the following existing settings:

1. The `assets` DNS record is a proxied CNAME to `ericguitard.github.io`.
2. SSL/TLS mode is **Full (strict)**.
3. **Always Use HTTPS** is enabled.
4. HSTS sends at least `max-age=31536000; includeSubDomains; preload`.

### Redirect Rules

Keep or create a 301 redirect rule named `assets.guitard.ca redirect` matching:

```text
lower(http.host) eq "assets.guitard.ca"
and http.request.method in {"GET" "HEAD"}
and http.request.uri.path eq "/"
```

Redirect to `https://guitard.ca/` and do not preserve the query string.

### Response Header Transform Rules - Content Security Policy

Create a Response Header Transform Rule named `assets.guitard.ca content security policy` matching:

```text
lower(http.host) eq "assets.guitard.ca"
```

Use **Set static** for:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'none'; script-src-attr 'none'; connect-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |

Keep this rule scoped to the hostname so the policy applies to successful, redirect, and error responses.

### Response Header Transform Rules - Response Headers

Create a later Response Header Transform Rule named `assets.guitard.ca response headers` matching:

```text
lower(http.host) eq "assets.guitard.ca"
and http.request.method in {"GET" "HEAD"}
and http.response.code in {200 206 304}
```

Use **Set static** for:

| Header | Value |
| --- | --- |
| `Access-Control-Allow-Origin` | `*` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |
| `X-Content-Type-Options` | `nosniff` |

### Response Header Transform Rules - 404 Headers

Create a later Response Header Transform Rule named `assets.guitard.ca 404 headers` matching:

```text
lower(http.host) eq "assets.guitard.ca"
and http.request.method in {"GET" "HEAD"}
and http.response.code in {404}
```

Use **Set static** for:

| Header | Value |
| --- | --- |
| `Access-Control-Allow-Origin` | `*` |
| `Cache-Control` | `max-age=600` |
| `Content-Type` | `text/html; charset=utf-8` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-Robots-Tag` | `noindex, nofollow` |

Keep the three asset-specific Response Header Transform Rules in this order:

1. `assets.guitard.ca content security policy`
2. `assets.guitard.ca response headers`
3. `assets.guitard.ca 404 headers`

Later matching Transform Rules can overwrite values set by earlier rules. This order keeps the content security policy on every response, assigns cross-origin delivery headers to successful assets, and makes the custom 404 response self-contained. On plans supporting Cache Response Rules, also set the 404 edge TTL to 600 seconds. On other plans, the deployment purge removes newly created asset URLs from Cloudflare's edge cache.

### Asset Cache Policy

Keep the Cloudflare browser cache lifetime at four hours for stable asset names. The later 404 response rule overrides the visitor-facing error cache header to 10 minutes. If Cache Response Rules are available, use one to align the 404 edge TTL with the same 10-minute policy.

After changing rules, purge the affected URLs or purge the `assets.guitard.ca` hostname once.

## 7. Configure repository security and automation

Under **Settings → Code security and analysis**:

1. Enable the dependency graph.
2. Enable Dependabot alerts and security updates.
3. Enable secret scanning and push protection when available.
4. Optionally enable CodeQL default setup for JavaScript.

The generated Dependabot configuration checks both npm dependencies and pinned GitHub Actions weekly.

Under repository **General** settings, use:

- Description: `Static brand and identity assets for Guitard Inc.`
- Website: `https://assets.guitard.ca`
- Suggested topics: `assets`, `branding`, `cloudflare`, `github-pages`

Issues may remain disabled because `SECURITY.md` provides a private reporting channel.

## 8. Merge and verify the first deployment

1. Merge the pull request after `Validate / Validate repository` succeeds.
2. Open **Actions → Deploy production**.
3. Confirm the jobs complete in this order:

   ```text
   Validate before deployment
   → Package Pages artifact
   → Deploy GitHub Pages
   → Purge and validate production
   ```

4. Confirm the Cloudflare purge step ran when the token and zone variable were configured.
5. Run **Actions → Validate production → Run workflow** once manually.
6. Confirm the workflow validates the exact deployment commit, all 16 resources, all 13 non-public paths, content equality, HTTP and HTTPS behavior, TLS lifetime, HSTS, MIME types, cache headers, CORS, CSP, and the exact custom 404 response.

The scheduled monitor then runs daily at 11:27 UTC. GitHub may delay scheduled workflows during periods of high load, so the post-deployment smoke test remains the primary release check.

## 9. Ongoing asset changes

For every new or renamed public file:

1. Add or update its entry in `assets.manifest.json`.
2. Include MIME type and cache policy.
3. Include exact width and height for PNG files.
4. Run `pnpm run check` and `pnpm run stage:pages`.
5. Open a pull request and wait for validation.

An undeclared public image, stylesheet, icon, or `robots.txt` file causes CI to fail. Files not declared in the manifest are not included in the Pages artifact.

## 10. Rollback

If the custom deployment fails after merge:

1. Revert the merge with a new signed commit or pull request.
2. Run **Deploy production** manually on the reverted `main` branch.
3. If necessary, temporarily switch **Settings → Pages → Source** back to deployment from `main` while investigating.
4. Purge the affected Cloudflare URLs after the rollback deploys.
