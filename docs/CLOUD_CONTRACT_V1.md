# RLSOK cloud client contract v1

The explicit contract identifier is `rlsok-cloud/v1`. The client sends it in
`x-rlsok-contract-version` and uses only `/v1` API routes. A server that does
not accept that version must fail closed.

## Compatibility map

| Concept | ReleaseGate | Cloud API | v1 rule |
| --- | --- | --- | --- |
| ExecSpec | Strict `realitywarden.io/v1alpha1` `ExecutablePolicy` | Validated subset with extension preservation | The complete strict public document is registered unchanged. |
| Release ID | `metadata.releaseId` | `release_id` / `releaseId` | Exact string equality. |
| Canonical JSON | Recursive object-key ordering, array order preserved, undefined omitted, non-finite numbers rejected | Same | Shared fixtures must produce identical bytes before hashing. |
| Content hash | `executablePolicyHash` | `releaseContentHash` | SHA-256 of the validated complete ExecSpec. |
| Approval identity | Local approved actor plus approved content hash | Authenticated principal ID, stable display label, credential ID, timestamp, and approved content hash | Request JSON cannot choose the authoritative approver. Approval applies only to the current exact content. |
| Release state | Local staged states including `shadow` and `canary` | `draft`, `approved`, `revoked` | Cloud state controls authorization; local staged state may be stricter. |
| Revocation | Refreshed local release record | Persisted revocation and `revoked` state | Refresh and atomic Permit consumption happen immediately before dispatch. |
| Action hash | SHA-256 of canonical action | Lowercase SHA-256 | Exact equality. |
| Device/controller | Device ID and controller configuration hash | `deviceId`, `controllerId` | Exact equality with the Permit and current release. |
| Permit expiry | Opaque local Permit, at most one second | Persistent Permit, at most 60 seconds | Both must be valid. The local gate never accepts a weaker lifetime. |
| Single use | Local Permit removed before validation | Atomic `consumed_at IS NULL` update | Both are consumed once; replay fails closed. |
| Evidence decisions | `allowed`, `blocked`, `approval_required`, `failed` | `allowed`, `blocked`, `failed` | `approval_required` is uploaded as `blocked`, with the detailed local reason in the bounded payload. |
| `hardwareSignalSent` | Boolean plus detailed signal state | Boolean | The boolean must report the observed dispatch fact, not eligibility. |
| Evidence chain | Per-bundle `sequence`, `previousHash`, `hash` | Per-organization sequence and previous hash | Cloud records use their own explicit envelope and are independently verified. |
| Errors | Stable fail-closed reason strings | Stable non-2xx `{error}` codes | Non-2xx or malformed responses deny; credentials are never included. |
| Organization | Standalone has no tenant boundary | Credential resolves one organization and scoped principal | Every cloud query and mutation is scoped to that organization and explicit scope. |

The shared fixture is
[`fixtures/cloud-contract/v1/release.json`](../fixtures/cloud-contract/v1/release.json).
Both repositories validate it and assert the same content and action hashes.

## Client security behavior

- `rlsok pair` is the default Hosted Cloud setup. The runtime generates the
  high-entropy credential locally; the Cloud stores only its hash, and the
  short browser code has no API authority before approval.
- `RLSOK_CLOUD_API_URL` and `RLSOK_CLOUD_API_KEY` remain available for advanced
  self-hosted configuration and override stored paired credentials.
- `RLSOK_CLOUD_API_KEY_FILE` may replace the key environment variable with a
  non-symlink protected file.
- API keys are never accepted as CLI arguments or logged.
- TLS verification uses the platform default and remains enabled. Plain HTTP is
  accepted only for loopback isolated tests.
- Requests time out after five seconds and responses are capped at 1 MiB.
- Safe `GET` requests receive one bounded retry. Registration, Permit issuance,
  and Evidence submission carry an organization-scoped idempotency key and may
  retry once with that same key after an ambiguous network result.
- Approval, revocation, and Permit consumption are not blindly retried. A
  timeout directs the operator to query current release/Permit state before
  deciding the next action.
- Redirects, cross-origin targets, non-2xx responses, and malformed responses
  fail closed.

Cloud Evidence payloads contain bounded execution facts and hashes, not
arbitrary proposal contents. They are authenticated runtime-gateway assertions:
the chain makes later mutation, deletion, duplication, or reordering detectable,
but does not prove the asserted physical event was truthful.
