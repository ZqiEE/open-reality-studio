## Summary

Describe the change and why it is needed.

## Safety Checklist

- [ ] Untrusted proposers have no execution authority
- [ ] Missing, stale, invalid, frozen, or mismatched state fails closed
- [ ] Blocked and shadow decisions cannot dispatch an adapter call
- [ ] Evidence truthfully records whether a hardware signal was sent
- [ ] Stable RealityWarden / `rw` / `realitywarden.io` identifiers remain compatible
- [ ] No credentials, tokens, private endpoints, or secrets are included
- [ ] Product copy makes no safety-rating, certification, or hard-real-time claim
- [ ] Any Core/CLI/daemon dependency-boundary change is explained

## Validation

List the commands you ran:

```text
npm run typecheck
npm run build
npm run test:releasegate
npm run verify
```
