# 1.5.36 — unpublished GitHub distribution candidate

- HTTPS-only Canary connections and optional per-site access.
- Reduced permissions and runtime-only packaging.
- Attachment recovery preserves file contents and avoids duplicate application.
- Reliable web-bridge activation for existing tabs after permission grants.
- GitHub-hosted automatic updates with a versioned XPI and SHA-256 verification.

Requires Thunderbird 128 or later. Native migration and update checks cover 128.0 and 159.0. Uses the same add-on ID as previous Canary releases. Existing users install this XPI once to switch to the GitHub update feed; settings remain in place.

Built from bad81ce238fdf06c46d712ce910ef15ca9b3d1a2. The only runtime change from the reviewed 1.5.36 ATN candidate is the manifest update URL.
