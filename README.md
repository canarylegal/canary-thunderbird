# Canary — file to matter

Unpublished GitHub distribution candidate 1.5.36. Source and distribution repository: `canarylegal/canary-thunderbird`. This repository owns the Thunderbird extension source, regression tests, release packages and offline build tools. It contains no Canary CMS server source or Git history. The GitHub repository is public, Actions are disabled, and no GitHub Release has been published. The XPI is available in the repository, but the configured update feed is not live until GitHub Release assets are published. Extension source and tests live under `extension/`; server integration APIs remain in canarycms.

## Install and connect

In Thunderbird 128 or later, open Add-ons and Themes, select the gear menu, then Install Add-on From File and select `canary-thunderbird-1.5.36.xpi`. Open Canary from the toolbar, enter your HTTPS Canary site, grant access to that site and connect. Open a message and use Canary to choose its matter and file it. In a compose window, use Canary to attach matter files or select the matter for filing on send. Only grant access to sites you trust.

## Existing installations

Install the GitHub XPI once using Install Add-on From File. It has the same add-on ID, `canary-file@canarylegal.co.uk`, and retains existing settings and permissions. An existing ATN-channel installation does not automatically discover this GitHub channel. Do not uninstall first. Leave automatic updates enabled in Thunderbird; users can disable them in the add-on settings.

## Automatic updates

The manifest uses `https://github.com/canarylegal/canary-thunderbird/releases/latest/download/updates.json`. The feed points to an immutable versioned release asset and includes its SHA-256 digest. Keep this repository and feed asset available. Each stable release must include `updates.json`; do not mark unrelated releases as Latest. Do not replace an already published XPI in place. Use a higher version for every change.

The same-ID 1.5.35 to 1.5.36 native automatic upgrade, manual channel migration and restart persistence were rehearsed with synthetic profiles on Thunderbird 128 and 159. The GitHub domains and redirects were simulated over HTTPS inside network namespaces without outbound routes. Live GitHub delivery remains to be checked after an authorized publication.

## Build and verify

Use Node.js 20 or later and Python 3.10 or later. The unit tests and offline build require no npm dependencies. Optional browser tests require an externally installed `@playwright/test` and its Chromium browser. Set `NODE_PATH` to that installation's node_modules directory, then run `npm run test:browser`; evidence defaults to `dist/browser/`. These tests use synthetic API fixtures and can run with networking disabled.

```sh
npm test
npm run build
```

The build uses the explicit runtime allowlist and writes the versioned XPI, feed, provenance and checksums into `dist/<version>/`. It never uploads, signs, publishes or deploys. For 1.5.36, the standalone regression test requires byte-for-byte equality with the previously reviewed XPI.

Edit source in `extension/`, not inside release archives. Keep the add-on ID and update feed stable. Bump the source version for future changes and add upgrade fixtures for the new version before replacing the 1.5.36 build contract. Existing release assets are immutable.

`SOURCE-MIGRATION.txt` records source provenance and retired tooling. Linux protocol-handler support lives in `extension/linux/`. No CMS checkout is needed to build or test this repository. GitHub Actions remain disabled and no workflow has been added.

See PUBLISHING.md for the unpublished release procedure and rollback approach. See LICENSE-NOTICE.txt before public release.
