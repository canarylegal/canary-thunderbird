# Canary — file to matter

Unpublished GitHub distribution candidate 1.5.36. Proposed repository: `canarylegal/canary-thunderbird`. This repository contains release packages and packaging tools, without the private Canary CMS repository or its history. No GitHub remote has been created and no release has been published.

## Install and connect

In Thunderbird 128 or later, open Add-ons and Themes, select the gear menu, then Install Add-on From File and select `canary-thunderbird-1.5.36.xpi`. Open Canary from the toolbar, enter your HTTPS Canary site, grant access to that site and connect. Open a message and use Canary to choose its matter and file it. In a compose window, use Canary to attach matter files or select the matter for filing on send. Only grant access to sites you trust.

## Existing installations

Install the GitHub XPI once using Install Add-on From File. It has the same add-on ID, `canary-file@canarylegal.co.uk`, and retains existing settings and permissions. An existing ATN-channel installation does not automatically discover this GitHub channel. Do not uninstall first. Leave automatic updates enabled in Thunderbird; users can disable them in the add-on settings.

## Automatic updates

The manifest uses `https://github.com/canarylegal/canary-thunderbird/releases/latest/download/updates.json`. The feed points to an immutable versioned release asset and includes its SHA-256 digest. Keep this repository and feed asset available. Each stable release must include `updates.json`; do not mark unrelated releases as Latest. Do not replace an already published XPI in place. Use a higher version for every change.

The same-ID 1.5.35 to 1.5.36 native automatic upgrade, manual channel migration and restart persistence were rehearsed with synthetic profiles on Thunderbird 128 and 159. The GitHub domains and redirects were simulated over HTTPS inside network namespaces without outbound routes. Live GitHub delivery remains to be checked after an authorized publication.

## Build and verify

From this repository, run:

```sh
python3 tools/prepare_release.py /path/to/reviewed-candidate.zip --source-commit FULL_COMMIT
python3 tools/test_release.py /path/to/reviewed-candidate.zip
```

The builder changes only the manifest update URL and records the input hash and source commit. The runtime remains readable inside the XPI. No CMS source tree, credentials, mail profiles, test certificates or CI workflow belongs in this repository.

See PUBLISHING.md for the unpublished release procedure and rollback approach. See LICENSE-NOTICE.txt before public release.
