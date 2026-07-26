# Release lifecycle

```text
draft -> tested -> approved -> shadow -> canary -> released -> revoked
```

`draft` and `tested` cannot dispatch. Approval requires an approver identity
and evidence and binds the approval to the complete ExecSpec hash. `shadow`
may evaluate and record decisions but never dispatch. `canary` and `released`
are restricted to explicitly allowed devices. `revoked` is terminal and
immediately denies new requests.

Every transition is an evidence event. Skipped transitions are rejected.
Changing the model, normalizer, preprocessor, postprocessor, ActionContract,
RobotProfile, controller profile, runtime policy, or scenario evidence changes
the ExecSpec identity and invalidates the old approval. Display-name changes
cannot preserve approval for changed executable content.
