> Archived historical document. This does not describe the current RLSOK product.

# Marketplace trust model

Status: v0.6 Marketplace distribution foundation. The desktop app provides a
local signed-package browser, durable install/trust state, disabled-by-default
installation, separate simulation enablement, publisher revocation, clean
uninstall, governed signed-catalog acquisition, and local publish-back draft
export. Owner-controlled production credentials and the hosted catalog/review
service remain release work, so this document does not yet claim the commercial
Marketplace is complete.

Marketplace packages are declarative data. They never contain adapters,
scripts, commands, hooks, endpoints, credentials, or post-install behavior.
The package signature proves which reviewed key signed the exact bytes; it
does not prove that the package is safe and never grants execution authority.

## Trust and validation order

1. Parse the strict, versioned package envelope. Unknown envelope fields are
   rejected rather than stripped.
2. Reject non-JSON data, cycles, executable/secret-bearing keys, and
   prototype-pollution keys.
3. Resolve exactly one publisher key from the consumer's local trust store.
   Unknown, ambiguous, or revoked keys are rejected.
4. Verify the Ed25519 signature over canonical JSON.
5. Run the authoritative Reality Asset validator. A valid signature cannot
   override `realAdapterEnabled: false`, support-level boundaries, capability
   rules, or any later runtime safety check.
6. Derive `official`, `verified`, or `community` from the local trust entry.
   A package cannot declare or promote its own tier.

## Lifecycle

- Install requires explicit confirmation and always creates
  `installed_disabled`.
- A second explicit confirmation may enable a validated `simulation_only`
  asset. This does not create a real adapter or execution authority.
- The stored signature and digest are revalidated at enablement time.
- Runtime lookup revalidates the current signature, digest, publisher, and
  trust-store status every time. Revocation therefore removes runtime
  visibility immediately, including after restart.
- Uninstall removes the complete package record; runtime lookup immediately
  returns no manifest afterward.
- Install, simulation enablement, and uninstall emit audit events with
  `hardwareSignalSent: false` and `executionAuthorityGranted: false`.

## Desktop persistence and recovery

- Only public community publisher keys may be imported locally, and they are
  always assigned the `community` tier. Local data cannot create or modify an
  `official` or `verified` trust entry.
- Marketplace state is written through an exclusive temporary file, flushed,
  and atomically renamed. Restore rejects unknown fields, changed signed
  bytes, changed metadata, duplicate identities, and authority escalation.
- A rejected state file is quarantined as evidence. Marketplace mutations stay
  blocked until the operator explicitly confirms an empty-state reset; there
  is no silent repair, downgrade, or retry.
- The desktop browser accepts JSON package/key files through bounded main-
  process dialogs. The preload bridge exposes no filesystem access.

## Signed catalog boundary

- A catalog is strict versioned JSON signed with Ed25519 by a key already in
  the consumer's local trust store. Catalog trust tiers are local policy.
- Catalogs have mandatory generation and expiry timestamps. Expired or
  implausibly future catalogs are rejected and are never presented as current.
- Every package URL must use HTTPS. Catalog signing refuses HTTP listings.
- Every entry binds both the exact downloaded file SHA-256 and the canonical
  signed-package digest. Package id, version, asset id/name/type/support level,
  signature, and current publisher trust must all match before review.
- A valid catalog signature never substitutes for package signature or Reality
  Asset validation. Any mismatch refuses the package; nothing is repaired,
  narrowed, retried, or silently sourced elsewhere.
- Production builds accept the catalog URL and Official public key only from
  the release-provisioned `resources/marketplace/distribution.json`. The
  renderer/preload cannot supply a URL. Network refresh and verified-cache use
  are separate explicit actions; network failure never triggers cache fallback.

Provision a release config from public key material only:

```bash
npm run marketplace:provision -- --public-key publisher-ed25519-public.pem \
  --key-id official-catalog-v1 --name "RealityWarden Official Catalog" \
  --tier official --catalog-url https://catalog.example/v1/catalog.json \
  --out marketplace/distribution.json
```

`npm run desktop:pack:production` refuses an absent/unprovisioned config or an
absent Windows code-signing certificate before packaging. The developer
`desktop:pack` path remains available for internal acceptance and is not a
publishable production artifact.

## Maintainer signing

Signing is an offline maintainer action. Private keys are never packaged with
the app or committed to this repository.

```bash
npm run marketplace:sign -- --draft reviewed-package-draft.json \
  --private-key publisher-ed25519-private.pem \
  --out signed-marketplace-package.json
```

The command refuses invalid assets and non-declarative content before signing,
uses exclusive output creation to avoid overwriting an existing package, and
does not serialize a trust tier. Consumer trust policy remains independent of
publisher claims.

## Offline catalog publication

The production catalog is also an offline maintainer artifact. Prepare a strict
build order beside the signed package files; it contains only catalog timing,
relative package filenames, and their final HTTPS download URLs:

```json
{
  "schema": "realitywarden.marketplace-catalog-build-order",
  "schema_version": 1,
  "catalog_id": "realitywarden.production.v1",
  "generated_at": "2026-07-16T10:00:00.000Z",
  "expires_at": "2026-08-16T10:00:00.000Z",
  "packages": [{
    "package_file": "packages/reviewed-device-1.0.0.json",
    "package_url": "https://catalog.example/v1/packages/reviewed-device-1.0.0.json"
  }]
}
```

```bash
npm run marketplace:catalog:publish -- --order catalog-build-order.json \
  --distribution marketplace/distribution.json \
  --private-key official-catalog-ed25519-private.pem \
  --out catalog.json
```

The command requires the private key to match the non-revoked Official catalog
public key in the production distribution config. It loads bounded package
files relative to the build order, verifies every package signature and Reality
Asset under that same bundled trust policy, and derives all listing metadata,
the exact file SHA-256, and canonical package digest from those bytes. Build
orders cannot supply those fields. HTTP URLs, path escape, tampering, duplicate
identities, wrong keys, invalid production config, and existing output files are
refused. The private key is read only for signing and is never serialized.

After the catalog and packages are hosted, verify the exact live distribution
before creating the public release:

```bash
npm run marketplace:live:verify -- \
  --distribution marketplace/distribution.json \
  --out release/RealityWarden-0.5.0-Marketplace-Live-Evidence.json
```

This explicit network check accepts HTTPS only, refuses redirects, bounds every
response, and performs no retry or cache fallback. It verifies the current
catalog against the configured Official key and then verifies the exact bytes
of every listed package against both catalog digests and package signatures.
The output and companion `.sha256` are created exclusively and contain no key
material. A failed or partial live snapshot is not release evidence.

The final `npm run release:prepare-public` gate revalidates this evidence
against the current production distribution and requires it to be no more than
24 hours old and still inside the signed catalog validity interval. It also
binds the catalog digest and package count into the final checksummed upload
manifest; a checksum file alone cannot promote stale or wrong-key evidence.

## Publish-back submission drafts

The desktop Marketplace can review an improved Reality Asset JSON and export a
strict `realitywarden.marketplace-submission-draft` file. This is a local handoff
to the independent maintainer review/signing process, not an upload channel.

- The main process reuses the authoritative declarative Marketplace asset
  validator before export.
- If the user claims an installed Marketplace package as the source, its
  current signature, digest, trust, asset identity, and version are rechecked.
  The improved asset must retain the asset id and increase its semantic version;
  mismatches are refused, never rewritten.
- The file states `local_draft_unsubmitted`, `signature_present: false`, null
  granted trust, `execution_authority_granted: false`,
  `real_adapter_enabled: false`, and `hardwareSignalSent: false`.
- Export requires an explicit checkbox and an OS save choice, creates a new
  file exclusively, and never uploads, retries, signs, or installs anything.
