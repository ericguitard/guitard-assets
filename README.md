# guitard.ca — Static Assets

> ⚠️ **Proprietary content.** Public access does not grant any licence to use these materials. See [Licence Notice](#licence-notice).

---

## About

This repository contains the public image and identity assets distributed from [assets.guitard.ca](https://assets.guitard.ca) for Guitard Inc. websites, applications, social previews, and email authentication.

The repository is published through GitHub Pages and proxied by Cloudflare. It is an asset origin rather than a browsable file directory: the root redirects to [guitard.ca](https://guitard.ca/), while unknown file addresses return the custom image-focused `404` page.

---

## Contents

- Brand marks and BIMI artwork
- Favicons, application icons, and maskable icons
- Open Graph and social preview images
- Responsive screenshot images
- General UI and decorative imagery
- Custom missing-asset page and stylesheet
- Manifest-driven local, deployment, and production validation
- Header documentation and gated GitHub Pages deployment

*(Structure may change without notice.)*

---

## Validation and Deployment

`assets.manifest.json` is the source of truth for every published resource, its
MIME type, cache policy, and expected image dimensions. Pull requests run the
repository checks, while the production workflow validates the repository,
packages only declared public files, deploys to GitHub Pages, and smoke-tests the
Cloudflare-proxied origin.

Run `pnpm run check` for repository validation, `pnpm run stage:pages` to preview
the Pages artifact, and `pnpm run validate:live` to test production.

Security concerns should be reported according to [SECURITY.md](SECURITY.md).
Maintainer setup and release instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Licence Notice

The complete proprietary rights notice is available in [RIGHTS.md](RIGHTS.md).

All content in this repository—including source code, configuration files, documentation, text, designs, images, names, logos, trademarks, branding, visual identity, and related materials—is proprietary and remains the exclusive property of its respective rights holders.

Access to this repository or its deployed content does not grant any licence or permission to copy, modify, reproduce, distribute, publish, sublicence, create derivative works from, or otherwise use its contents for any commercial or non-commercial purpose.

Any third-party use requires prior written authorization from the applicable rights holder.

**All rights reserved.**

## Permissions

To request authorization to use an asset or other repository content, contact Eric Guitard at [eric@guitard.ca](mailto:eric@guitard.ca).
