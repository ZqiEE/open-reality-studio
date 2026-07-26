# ESP32 reference rig

The existing ESP32 + SG90 + HC-SR04 implementation under `lib/hardware` and
`firmware` is the reference implementation of the execution-gate contract.
It is not the primary product and is not safety-rated.

Its existing tests remain authoritative for zero signal after block, stale and
frozen sensor rejection, sequence interruption, and truthful audit evidence.
Source relocation is deferred until compatibility exports and build paths are
verified.
