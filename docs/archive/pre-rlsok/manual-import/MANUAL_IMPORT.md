> Archived historical document. This does not describe the current RLSOK product.

# Manual / PDF Import (v0.5)

RealityWarden can turn a text-bearing PDF, Markdown file, or plain-text device
manual into an **untrusted DeviceProfile and Action Manifest proposal** using
the local Ollama model. The workflow is available from **File → Import Device
Manual…**.

## Trust and execution boundary

- PDF parsing only extracts text. A scanned PDF without a text layer fails
  explicitly; there is no OCR guess or silent fallback.
- The complete extracted text, its SHA-256 digest, local model name, elapsed
  time, and raw model output are retained in the project audit record.
- Model output passes a strict schema. Unknown fields, cross-device
  capabilities, invalid limits, unknown primitives, targets, values, and
  action envelopes are rejected rather than repaired or clamped.
- A human must review the complete JSON and explicitly confirm it. Editing the
  JSON clears the confirmation and save performs the full validation again.
- Saved records force `supported_adapters: ["simulator"]`, conservative safety
  flags, `profile_source: "manual_import"`, and `simulation_only: true`.
- Manual imports do not register a real adapter, enable REAL HARDWARE, bypass
  the evidence lock, or gain an alternate actuation path.

The proposal is stored under `workspace.manual_imports` in the desktop project
file. Every stored record and proposed manifest is revalidated when the project
is loaded. A tampered record that adds any adapter other than `simulator` is
rejected in full and reported to the operator.

## Review and Virtual Lab enablement

The review surface provides three authoritative views: extracted source beside
the structured fields, editable proposal JSON, and the verbatim model output.
It also renders a semantic 3D preview using the trusted built-in template for
the proposed device type. This geometry is visibly identified as a generic
template: it is not vendor CAD and does not prove dimensions, kinematics, or a
physical outcome.

Saving the reviewed proposal does **not** enable it. The operator must reopen
the saved record and pass a second confirmation covering source usage rights,
generic-geometry limitations, and simulation-only execution. Only then is a
user-owned asset added to the Asset Library and 3D Workspace.

The generated asset:

- has `execution_mode: "simulation"` and `real_device_enabled: false`;
- exposes only the capabilities already accepted during manual review;
- uses a trusted geometry template with an exactly matching device type;
- retains the proposal workspace constraints rather than expanding them to the
  template's constraints;
- is removed on proposal edits, requiring the second gate again; and
- is rejected and removed from a restored workspace if its enablement or
  template reference is missing, malformed, or mismatched.

## Optional action installation (third gate)

Enabling a manual-derived asset does **not** install any proposed actions. To
copy an action into the local custom-action library, the operator must select
the enabled simulation asset and explicitly enter **Action Composer** review.
The review shows the retained source file and SHA-256, every primitive step,
safety envelope, required sensors, and any existing-ID conflict.

Installation is a separate third confirmation with these invariants:

- the stored manual record and every selected Action Manifest are revalidated
  again at the installation commit point;
- the current Action Composer profile must be the exact enabled manual profile
  and must structurally expose only the `simulator` adapter;
- existing action IDs, duplicate selections, unknown selections, invalid
  targets, primitives, values, and envelopes are rejected without overwrite,
  clamping, or partial installation of the selected batch;
- only explicitly checked, conflict-free actions are copied; no action is
  installed merely because a proposal or Virtual Lab asset was approved; and
- the result contains Action Manifests only. It creates no adapter association,
  grants no real-hardware authority, and every later run is expanded to
  primitives and re-enters the normal governed runtime pipeline.
