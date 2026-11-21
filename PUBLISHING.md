# Publication procedure — release unpublished

1. Confirm the public repository name and accompanying stable-release licence. The current development licence is preserved for provenance; it does not supply production terms.
2. The separate repository has been created privately with Actions disabled. Before any public distribution, obtain explicit authorization to change visibility and publish, and review repository protection. Keep Actions disabled; releases require no jobs or deployment.
3. Prepare a draft release tagged `v1.5.36`. Upload exactly the four files from `releases/1.5.36`: the XPI, updates.json, provenance.json and SHA256SUMS.txt. Include the reviewed release notes. Exclude internal test evidence and development profiles. A draft release does not make the stable update feed publicly usable.
4. Verify all asset names, authenticated draft download hashes and feed URLs. Publish the completed release and explicitly mark it Latest only when authorized. For subsequent releases, leave the previous Latest release serving updates while the new release remains a draft.
5. Download the public Latest feed and versioned XPI, verify SHA256SUMS and update_hash, then check an isolated existing installation through Thunderbird's updater. This live delivery check is not covered by the local rehearsal.

## Future versions

Build from a reviewed candidate with a strictly higher version. Preserve the add-on ID and stable feed URL. Test native upgrades and permissions before publication. Attach the feed to every stable release. Avoid prereleases as the stable channel's Latest release. Retain previous tagged assets for recovery and provenance.

## Stop rollout and recover

If a new release is defective, explicitly restore the previous known-good release as Latest so users still on older versions stop discovering the defective one. Already upgraded users will not automatically downgrade. Publish a corrected, higher version to recover those users; test it first. Do not overwrite signed-off release assets or assume moving Latest rolls back installed code. An exceptional manual downgrade requires a separate isolated state-compatibility test and a user backup; it is not an automatic rollback mechanism.

## ATN

This package deliberately sets update_url and is for GitHub distribution. The Thunderbird linter reports only its ATN restriction on self-hosted updates. Do not submit this GitHub-channel XPI to ATN. The previously prepared ATN candidate is a separate artifact.
