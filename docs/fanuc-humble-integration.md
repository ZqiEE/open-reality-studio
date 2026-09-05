# First FANUC / ROS 2 Humble Shadow evaluation

This integration covers the first isolated or simulated evaluation: observe a
ROS 2 graph, evaluate every declared action path, change calibration, and retain
the resulting allow/block evidence without sending goals. The same runtime
combines reusable adapters; an operator supplies a profile rather than a fork.

A physical controller, unpublished vision/Ollama packages and production
calibration files are not prerequisites for this simulation. They become inputs
when adapting the profile to an operator's deployed system. Do not confuse the
example action below with a declaration of somebody else's private interface.

## Current evaluation delivery and validation scope

Install the [v1.5.0-shadow.1 evaluation release](https://github.com/realitywarden/rlsok/releases/tag/v1.5.0-shadow.1)
and follow the [complete self-service path](fanuc-shadow-self-service.md).
It includes Linux Node, compiled CLI, four exported schemas, material templates,
controller-state fingerprinting, per-path assessments and source provenance.
It was built and reviewed without local tests, GitHub Actions, installation or
ROS acceptance runs. It is a prerelease for local Shadow evaluation.

Historical development notes at `f715a6456130091e20cb2f47e5742bd7082db5eb`
record runtime/composable tests and Linux collector/Jazzy graph checks. They
are not validation results for this newer evaluation package.

The Humble Docker runner and five-phase acceptance procedure are supplied but
have **not completed a Humble run**. Local container startup failed before ROS
installation/testing, and further environment work was stopped. No Humble,
private-interface or physical-robot validation is claimed. The first deployed
use should retain this zero-dispatch scope and capture any integration failures.

## Scope and deliverables

| Requested capability | Implementation / acceptance |
| --- | --- |
| Ubuntu 22.04 / ROS 2 Humble graph | Read-only `rclpy` collector; reproducible Humble validation kit under `experimental/composable-shadow`. |
| FollowJointTrajectory | Exact configured joint order, finite vectors and increasing ROS durations. |
| Custom absolute Cartesian action | Meter position and normalized quaternion, supporting ROS objects, arrays or ordered scalar pointers. |
| Allowlisted TP program action | Exact program-name selection; unlisted names block. |
| Tool / frame configuration | Bind complete configuration fingerprints, including selected IDs and active parameters, from timestamped simulation exports. |
| Controller software and calibration | Compare exported software revision and SHA256 of actual local calibration bytes with the reviewed baseline. |
| Every declared execution path | Missing proposals/observations prevent a complete pass; each of the three example paths depends on all six example facts. |
| Changed calibration, zero dispatch | Recollect after changing the file; all three paths must block under the original approval. |
| Supported interface schema | `profile schema` exports four JSON Schemas plus semantic conventions. |
| Hosted Shadow stored data | Inventory below; this local evaluation uploads nothing. |

## Build and examine the interface contracts

From this source checkout with Node 22.12+:

```sh
npm ci
npm run build
node dist/apps/cli/rlsok.js profile schema --output ./shadow-schemas
node dist/apps/cli/rlsok.js profile init --template fanuc-humble --output ./my-cell
```

The output directory must be new. After installation, `rlsok` replaces
`node dist/apps/cli/rlsok.js` in these commands. The source version containing
this feature is required; an earlier published package does not provide it.

| File | Contract |
| --- | --- |
| `profile.schema.json` | Environment, robot identity, ordered joints, fact sources, path adapters and expected fingerprints. |
| `observation.schema.json` | Actual collector environment, graph endpoint/type fingerprints, visible server-node counts, observed facts and timestamps. |
| `approval.schema.json` | Explicit local Shadow scope, profile hash, actor and validity interval. |
| `proposals.schema.json` | One proposal per declared path with its complete local goal object. |
| `manifest.json` | Units, field conventions and additional CLI semantic checks. |

The generated schemas validate structure. The CLI additionally checks unique
IDs, references, timestamps, goal values and coverage. A JSON Schema validator
alone cannot establish that the observation matches the approved configuration.

## Run the complete isolated Humble acceptance

On Linux or WSL with Docker available, after `npm run build`:

```sh
python3 -B experimental/composable-shadow/run_humble_validation.py \
  --repo . --artifacts artifacts/composable-shadow/humble-run
```

If the WSL system Docker service is not running, the optional `--private-daemon`
flag starts a separate task daemon and requires root. It uses its own socket
and storage and stops it afterwards. Neither mode starts a robot driver.

The runner records the resolved official Ubuntu 22.04/Humble and Node image
digests, builds only the pinned public FANUC interface package and the supplied
absolute-action example, then runs acceptance in a container with networking
disabled and the source checkout mounted read-only. Network access is used
during dependency/image preparation, not during the ROS evaluation.

It exercises collector tests, real ROS action discovery, all three original
action categories, CLI baseline approval/capture/evaluation, configuration
drift and Evidence verification. The mock servers count and reject any goal
or cancel; the final observer record must show zero goals, cancels and
executions. The negative test changes actual input files and recollects them.

The new artifact directory contains `manifest.json`, `versions.json`,
`summary.json`, command logs and the `e2e` workspace/reports. Inspect
`summary.json` and `e2e/observer.json` together. Use a new artifact directory on
each run so previous evidence is preserved. This is a real Humble middleware
test with simulated action servers and configuration data, not physical FANUC
controller validation.

## The three action representations

The first path uses `control_msgs/action/FollowJointTrajectory` at
`/fanuc_arm_controller/follow_joint_trajectory`, with pointers
`/trajectory/joint_names` and `/trajectory/points`. The example joint order is
`joint_1` through `joint_6`. The proposed joint positions are in radians.

The supplied **example**, `rlsok_shadow_example_interfaces/action/AbsoluteCartesian`,
has this ROS definition:

```text
geometry_msgs/PoseStamped target
---
bool success
---
string state
```

Its adapter fields are:

```json
{
  "position": "/target/pose/position",
  "orientation": "/target/pose/orientation",
  "frame": "/target/header/frame_id",
  "expectedFrame": "FIXTURE-frame-1"
}
```

`position` selects `{ "x": 0, "y": 0, "z": 0 }` in meters; `orientation`
selects `{ "x": 0, "y": 0, "z": 0, "w": 1 }`. Arrays `[x,y,z]` and
`[x,y,z,w]` are also supported. For a different custom action with scalar
fields, use `"position": ["/x", "/y", "/z"]` and
`"orientation": ["/qx", "/qy", "/qz", "/qw"]`. A W/P/R angle contract or
relative displacement must not be relabeled as an absolute quaternion pose.
The separate `cartesian_delta` adapter handles relative mm/degree jogging.

The third path uses the publicly documented
`fanucpy_ros2_interfaces/action/RunProgram` at `/fanuc/run_program`, with
`"program": "/program_name"` and the example allowlist `["FIXTURE_PICK"]`.
The operator replaces this list with independently reviewed program names.

For all three types, source Humble and the relevant interface workspace, then
run `rlsok profile describe-interface --type package/action/Name`. Review the
returned Goal/Result/Feedback type tree and put its `interfaceSha256` in the
profile before approval. Interface fingerprints describe the locally installed
definitions; the remote graph advertises the type name, not an authenticated
remote schema. A private absolute action can reuse this adapter when its
semantics and mapped fields fit; its actual type name and fields must be
confirmed before claiming that private interface was tested.

## Independent facts, approval and observation

`profile.json` contains the reviewed expected values. `controller-state.json`,
`eye-to-hand.yaml` and `robot.urdf` are separate observation sources. The
simulation seeds them with clearly marked example values; the collector reads
the sources and does not copy expected values into the observation.

The JSON export carries `observedAt`, `controllerSoftware`,
`toolConfigurationSha256`, `frameConfigurationSha256` and `stackRevision`.
Tool/frame digests must include both the selected ID and complete parameters.
A timestamp means when the exporter observed that state, not when an old file
was copied. The collector preserves it, so stale exports remain stale.
Calibration and URDF facts hash their actual file bytes. Every example action
lists controller, tool, frame, calibration, URDF and bridge revision in `checks`.

Once the profile matches the chosen **isolated** graph and reviewed sources:

```sh
rlsok profile inspect --profile ./my-cell/profile.json
rlsok profile approve --profile ./my-cell/profile.json --actor reviewer \
  --expires-at <future-RFC3339-time> --output ./my-cell/approval.json
rlsok profile capture --profile ./my-cell/profile.json --output ./my-cell/baseline-observation.json
rlsok profile shadow --profile ./my-cell/profile.json --approval ./my-cell/approval.json \
  --observation ./my-cell/baseline-observation.json --proposals ./my-cell/proposals.json \
  --output ./my-cell/baseline
```

Expect three `WOULD_ALLOW` decisions. Change bytes in `eye-to-hand.yaml`, leave
the profile and approval unchanged, then capture into a new file and evaluate
into a new directory. Expect exit code **2**, three `WOULD_BLOCK` decisions and
a `fact_mismatch:calibration` check in every path. Code 2 is the expected
negative result, not a missing report. Apply the same process to a changed
tool fingerprint, frame fingerprint or controller version to exercise those
bindings. Reapproving the changed expected values would test a different case.

Each run writes `report.json` and per-path `.release.json` and `.evidence.json`.
Check each pair with `rlsok verify-evidence <path.evidence.json> --release
<path.release.json>`. This checks hash-chain consistency with that local
release. It does not turn self-attested simulation data into hardware evidence.

## Hosted Shadow data inventory

The profile CLI performs no Cloud request, and its reports contain
`cloudUploaded: false`. Raw local goals and observation inputs stay in the
evaluation directory. Reports contain goal hashes, identifiers, adapter and
endpoint metadata, configuration fingerprints, per-check outcomes, timestamps,
the release specification and hash-chained evidence. Reviewer names and joint
names can appear; these reports are not anonymous.

The existing Hosted reference walkthrough is a separate fixed server-side
example, not an upload endpoint for this three-path local evaluation. At Cloud
source revision `08b6375f2200f0f5b18c03386f3829849645883e`:

| Hosted path | Stored data |
| --- | --- |
| Reference Shadow | Organization/principal linkage, release ID/hash and full generated ExecSpec; decision, runtime evidence and reference evidence bundle; action hash; permit and zero-dispatch flags; sequence, previous/current evidence hashes and timestamps; audit event. |
| Runtime evidence API | Per-action identity/release/configuration and permit bindings, decision/evidence payload and audit information. Allowed evidence requires the corresponding consumed Cloud permit; a local approval cannot substitute for it. |
| Artifact workflow | Draft metadata such as filename/type/size/SHA256 and associated release/configuration information; separate upload endpoints can retain artifact contents. |

Consequently the complete Hosted product should not be described as storing
only metadata. This first local simulation requires no artifact upload or
Cloud approval. See `apps/api/src/server.ts` and `reference-shadow.ts` at the
stated Cloud source revision for the reviewed implementation; this is not a
claim that a particular hosted deployment runs that exact revision.

## Moving from the simulation to the deployed graph

Confirm the deployed bridge revision, private absolute action definition,
ROS/RMW/domain, actual active tool/frame exports, controller software,
calibration/URDF sources and intended TP allowlist. The public bridge's
relative `JogCartesian` action does not establish the private absolute action.
Use the same modules and update the configuration and approved fingerprints.

Graph discovery cannot establish active FANUC controller state on its own.
An actual-state exporter and matching local interface definitions are needed
for a deployed-graph evaluation. Physical motion, collision checks and bypass
interfaces are outside this zero-dispatch evaluation; no physical connection
is required to complete the first simulated run.
