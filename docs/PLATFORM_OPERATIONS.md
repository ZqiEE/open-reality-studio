# Platform Operations — Review, Publish, Trust

The platform side of the marketplace. Developers submit governed adapter drafts
(see [`ADAPTER_QUICKSTART.md`](./ADAPTER_QUICKSTART.md)); this is how the platform
verifies and publishes them — trusting nothing the submitter claims.

```
  ...developer submits  →   sdk:review        →   sdk:publish         →   verify at install
                            re-verify a draft      grant + Ed25519 sign     trust store decides tier
                            (trust nothing)        (never grants execution) (real stays disabled)
```

---

## The one rule that never bends

**Trust tier is not execution authority.** A signed, verified, official-tier
package still carries `realAdapterEnabled: false`. Trust governs distribution
and visibility only. Real actuation is a separate, per-device gated path
(the reviewed reference rig) that the marketplace can never open — at any tier.

This is enforced structurally and pinned by tests:
`tests/adapter-sdk/sdkPublish.test.ts` and `tests/adapter-sdk/ecosystemChain.test.ts`
assert `realAdapterEnabled === false` on a verified package at community,
verified, and official tiers.

---

## 1. Review an incoming draft

Independently verify a submitted draft before doing anything with it:

```bash
npm run sdk:review -- path/to/submission.draft.json
```

`sdk:review` recomputes the asset digest (tamper detection), re-runs the
authoritative asset governance validator, and checks every forced literal
(zero execution authority, no real adapter, no self-granted trust tier,
unsubmitted/unsigned). `ACCEPTED` means it is authentic and governance-valid.
Any tamper — an edited asset, a self-granted authority or tier — is `REJECTED`.

## 2. Publish (grant + sign)

Turn an accepted draft into a signed marketplace package with the platform's
Ed25519 key:

```bash
npm run sdk:publish -- path/to/submission.draft.json \
  --key path/to/platform-ed25519.pem \
  --publisher-id acme.publisher.v1 \
  --publisher-name "Acme Robotics" \
  --out acme-arm.package.json
```

`sdk:publish` re-runs the review gate first (a rejected draft is never
published), builds the package envelope, and signs it. It refuses to emit a
package that would carry real execution authority.

Generate a signing key with Node:

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');require('fs').writeFileSync('platform-ed25519.pem',k.privateKey.export({type:'pkcs8',format:'pem'}).toString());require('fs').writeFileSync('platform-ed25519.pub.pem',k.publicKey.export({type:'spki',format:'pem'}).toString());"
```

## 3. Trust tiers

Trust lives in the trust store (`lib/marketplace/MarketplaceTrustStore.ts`),
not in the package. A consumer verifies a package against their trust store;
the matching key's tier (`official` / `verified` / `community`) is what the tier
resolves to at verification time. Granting or revoking trust is a deliberate
platform action — and it changes distribution, never execution.

---

## Verifying the platform tooling

```bash
npm run test:sdk-review        # independent draft verification (positive + 5 tampers)
npm run test:sdk-publish       # grant + sign + trust-is-not-execution invariant
npm run test:ecosystem-chain   # catalog -> scaffold -> conformance -> submit -> review -> publish -> verify
npm run test:fast              # the full local gate, including all of the above
```

`npm run verify` remains the canonical pre-release gate.
