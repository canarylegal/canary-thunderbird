# Canary — file to matter

Development candidate 1.5.44 adds background completion of Canary tags after upload scanning. Version 1.5.43 is published on the GitHub release channel. Source and distribution repository: `canarylegal/canary-thunderbird`. Actions remain disabled. Build this candidate with `npm run build`; building does not publish it. Extension source and tests live under `extension/`; server integration APIs remain in canarycms.

## Install and connect

In Thunderbird 128 or later, open Add-ons and Themes, select the gear menu, then Install Add-on From File and select `canary-thunderbird-1.5.42.xpi`. Open Canary from the toolbar, enter your HTTPS Canary site, grant access to that site and connect. After approving in your browser, select **Open Thunderbird** to finish connecting. Open a message and use Canary to choose its matter and file it. In a compose window, use Canary to attach matter files or select the matter for filing on send. Only grant access to sites you trust.

## Browser sign-in recovery

If you close the authorization page, click Connect to Canary again to start a fresh attempt. Cancel connection stops the pending attempt without clearing your site permission. Abandoned browser callbacks cannot complete a replacement attempt. Mail add-in authorization follows the firm’s configured second-factor policy; Core must include the corresponding policy fix.

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

Failed queued email opens stop after the attempt; they are not automatically requeued. Security-blocked files remain unavailable. Retry from Canary only after the underlying issue is resolved.

## Tags after upload scanning

The background page owns filing uploads and checks the exact uploaded file's metadata until it is clean (or accepted with scanning disabled). Closing the popup does not stop upload completion or tagging. The pending queue is stored locally, scoped to the Canary site and staff identity, and contains no bearer token. Temporary scan, connection and tag failures retry with backoff; blocked files, deleted files and revoked matter access never receive a new tag. Existing Thunderbird tags are preserved.

Pending checks pause while signed out or connected as another user/site, and resume after the original user reconnects. Before tagging, the extension checks the Thunderbird message identity to avoid applying a tag to a reused numeric message ID. Deleted or mismatched messages are not tagged. Pending entries expire after seven days. This does not reconstruct pending uploads from older extension versions, which never recorded that queue.

Validation uses synthetic messages and server responses in isolation; it does not access live matter documents. Native Thunderbird restart/move behavior still determines whether an original message ID can be resolved after restart; the queue fails safely rather than tagging a different message.
