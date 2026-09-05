#!/usr/bin/env python3
"""Reproduce local Humble validation in an isolated, network-disabled container.

Linux/WSL entry point, after the repository CLI has been built:
  python3 experimental/composable-shadow/run_humble_validation.py \
    --repo . --artifacts artifacts/composable-shadow/humble-run --private-daemon

--private-daemon needs root and creates a separate Docker socket/data/exec root;
it never starts or modifies the system Docker service. Otherwise use the current
Docker endpoint or --docker-host. Only image build/download has network access.
The test container has no network, devices, privileged mode, or writable repo.
No action client is created. Local test action servers reject and count requests.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from uuid import uuid4


FANUC_COMMIT = "ed04e2ca0eb7781168a08688c682fb314c85ba59"
ROS_IMAGE = "ros:humble-ros-base-jammy"
NODE_IMAGE = "node:22-bullseye-slim"
ABSOLUTE_ACTION = "rlsok_shadow_example_interfaces/action/AbsoluteCartesian"
TP_ACTION = "fanucpy_ros2_interfaces/action/RunProgram"
TRAJECTORY_ACTION = "control_msgs/action/FollowJointTrajectory"


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def canonical_hash(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Commands:
    def __init__(self, directory, environment=None):
        self.directory = Path(directory)
        self.environment = environment or dict(os.environ)

    def run(self, label, argv, expected=0, timeout=120, cwd=None, environment=None):
        start = timestamp()
        print(f"[{start}] {label}", flush=True)
        log = self.directory / f"{label}.log"
        with log.open("w", encoding="utf-8") as stream:
            result = subprocess.run(argv, cwd=cwd, env=environment or self.environment,
                                    text=True, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
        record = {"label": label, "argv": list(map(str, argv)), "cwd": str(cwd) if cwd else None,
                  "startedAt": start, "finishedAt": timestamp(), "exitCode": result.returncode,
                  "expectedExitCode": expected, "log": log.name}
        with (self.directory / "commands.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record) + "\n")
        if result.returncode != expected:
            print(log.read_text(encoding="utf-8")[-12000:], flush=True)
            raise RuntimeError(f"{label}: exit {result.returncode}, expected {expected}; see {log}")
        return log.read_text(encoding="utf-8")


@contextmanager
def docker_environment(args, artifacts):
    environment = dict(os.environ)
    if args.docker_host:
        environment["DOCKER_HOST"] = args.docker_host
    if not args.private_daemon:
        yield environment
        return
    if os.geteuid() != 0:
        raise RuntimeError("--private-daemon requires root in this Linux/WSL environment")
    if args.docker_host:
        raise RuntimeError("choose --private-daemon or --docker-host")
    with tempfile.TemporaryDirectory(prefix="rlsok-humble-docker-", ignore_cleanup_errors=True) as temporary:
        root = Path(temporary)
        socket = root / "docker.sock"
        containerd_socket = root / "containerd.sock"
        containerd_config = root / "containerd.toml"
        containerd_config.write_text(
            f'version = 2\nroot = "{root / "containerd-root"}"\n'
            f'state = "{root / "containerd-state"}"\n'
            'disabled_plugins = ["io.containerd.grpc.v1.cri"]\n'
            f'[grpc]\naddress = "{containerd_socket}"\n', encoding="utf-8")
        containerd_command = ["containerd", "--config", str(containerd_config)]
        environment["DOCKER_HOST"] = f"unix://{socket}"
        command = ["dockerd", "--host", environment["DOCKER_HOST"], "--data-root", str(root / "data"),
                   "--exec-root", str(root / "exec"), "--pidfile", str(root / "dockerd.pid"),
                   "--containerd", str(containerd_socket),
                   "--bridge=none", "--iptables=false", "--ip-forward=false", "--ip-masq=false",
                   "--storage-driver=vfs"]
        write_json(artifacts / "private-daemon.json", {"command": command,
                   "containerdCommand": containerd_command, "containerdConfig": containerd_config.read_text(),
                   "scope": "new isolated Docker and containerd daemons"})
        with (artifacts / "docker-daemon.log").open("w", encoding="utf-8") as log, \
             (artifacts / "containerd.log").open("w", encoding="utf-8") as containerd_log:
            process = None
            containerd = subprocess.Popen(containerd_command, stdout=containerd_log,
                                          stderr=subprocess.STDOUT, start_new_session=True)
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if containerd.poll() is not None:
                        raise RuntimeError("private containerd exited; inspect containerd.log")
                    if containerd_socket.exists():
                        try:
                            ready = subprocess.run(["ctr", "--address", str(containerd_socket), "version"],
                                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                            if ready.returncode == 0:
                                break
                        except subprocess.TimeoutExpired:
                            pass
                    time.sleep(0.25)
                else:
                    raise RuntimeError("private containerd did not become ready; inspect containerd.log")
                process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("private Docker daemon exited; inspect docker-daemon.log")
                    if socket.exists():
                        try:
                            ready = subprocess.run(["docker", "info"], env=environment,
                                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                            if ready.returncode == 0:
                                break
                        except subprocess.TimeoutExpired:
                            pass  # A listening socket can precede containerd readiness.
                    time.sleep(0.25)
                else:
                    raise RuntimeError("private Docker daemon did not become ready")
                yield environment
            finally:
                for owned_process in (process, containerd):
                    if owned_process is not None and owned_process.poll() is None:
                        owned_process.terminate()
                        try:
                            owned_process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            os.killpg(owned_process.pid, signal.SIGKILL)
                            owned_process.wait(timeout=10)
                # Docker bind-mounts its data directory to control propagation.
                # Unmount only this newly allocated task root after its daemon exits.
                subprocess.run(["umount", "--", str(root / "data")],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def host_validation(args):
    repo = args.repo.resolve(strict=True)
    artifacts = args.artifacts.resolve()
    artifacts.parent.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir()  # Never overwrite an earlier validation record.
    args.owns_artifacts = True
    if not (repo / "dist/apps/cli/rlsok.js").is_file():
        raise RuntimeError("build the CLI first: npm run build")
    context = repo / "experimental/composable-shadow"
    with docker_environment(args, artifacts) as environment:
        commands = Commands(artifacts, environment)
        docker_version = commands.run("docker-version", ["docker", "version", "--format", "{{json .}}"])
        image_refs = {}
        for name, reference in (("ros", ROS_IMAGE), ("node", NODE_IMAGE)):
            commands.run(f"pull-{name}", ["docker", "pull", reference], timeout=1200)
            details = json.loads(commands.run(f"inspect-{name}", ["docker", "image", "inspect", reference]))[0]
            image_refs[name] = {"requested": reference, "id": details["Id"], "digests": details["RepoDigests"]}
        image = f"rlsok-humble-validation:{uuid4().hex}"
        ros_pinned, node_pinned = image_refs["ros"]["digests"][0], image_refs["node"]["digests"][0]
        with tempfile.TemporaryDirectory(prefix="rlsok-humble-build-context-") as temporary:
            build_context = Path(temporary)
            shutil.copy2(context / "Dockerfile.humble-validation", build_context)
            shutil.copytree(context / "humble-example-interfaces", build_context / "humble-example-interfaces")
            (build_context / "npm").mkdir()
            for name in ("package.json", "package-lock.json"):
                shutil.copy2(repo / name, build_context / "npm" / name)
            commands.run("build-humble", ["docker", "build", "--network", "host", "--tag", image,
                         "--build-arg", f"ROS_IMAGE={ros_pinned}", "--build-arg", f"NODE_IMAGE={node_pinned}",
                         "--file", str(build_context / "Dockerfile.humble-validation"), str(build_context)], timeout=1800)
        built = json.loads(commands.run("inspect-built-image", ["docker", "image", "inspect", image]))[0]
        write_json(artifacts / "manifest.json", {
            "startedAt": timestamp(), "docker": json.loads(docker_version), "baseImages": image_refs,
            "validationImage": {"tag": image, "id": built["Id"]}, "fanucCommit": FANUC_COMMIT,
            "dockerfileSha256": hashlib.sha256((context / "Dockerfile.humble-validation").read_bytes()).hexdigest(),
            "packageLockSha256": hashlib.sha256((repo / "package-lock.json").read_bytes()).hexdigest(),
            "scope": "local isolated Ubuntu 22.04 / ROS 2 Humble; no hardware; no dispatch",
        })
        inside = ("source /opt/ros/humble/setup.bash && source /opt/validation-interfaces/install/setup.bash && "
                  "mkdir -p /tmp/rlsok-home && exec python3 -B /workspace/experimental/composable-shadow/"
                  "run_humble_validation.py --inside --repo /workspace --artifacts /artifacts")
        commands.run("container-validation", ["docker", "run", "--rm", "--name", f"rlsok-humble-{uuid4().hex}",
                     "--network", "none", "--ipc", "private", "--cap-drop", "ALL",
                     "--security-opt", "no-new-privileges", "--read-only", "--pids-limit", "256",
                     "--tmpfs", "/tmp:rw,exec,nosuid,size=1g",
                     "--mount", f"type=bind,source={repo},target=/workspace,readonly",
                     "--mount", f"type=bind,source={artifacts},target=/artifacts", image, inside], timeout=600)
    print(f"Humble validation complete: {artifacts / 'summary.json'}", flush=True)


@contextmanager
def mock_graph():
    import rclpy
    from rclpy.action import ActionServer, CancelResponse, GoalResponse
    from rclpy.context import Context
    from rclpy.executors import SingleThreadedExecutor
    from rclpy.utilities import get_rmw_implementation_identifier
    from rosidl_runtime_py.utilities import get_action

    context = Context()
    rclpy.init(args=[], context=context)
    node, executor, thread, servers = None, None, None, []
    counters = {"goalRequests": 0, "cancelRequests": 0, "executions": 0}
    namespace = f"/rlsok_humble_{uuid4().hex}"
    paths = [("trajectory", namespace + "/follow_joint_trajectory", TRAJECTORY_ACTION),
             ("cartesian", namespace + "/absolute_cartesian", ABSOLUTE_ACTION),
             ("tp_program", namespace + "/run_program", TP_ACTION)]
    try:
        node = rclpy.create_node("rlsok_humble_zero_request_observer", context=context,
                                 enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
        executor = SingleThreadedExecutor(context=context)
        executor.add_node(node)

        def goal(_request):
            counters["goalRequests"] += 1
            return GoalResponse.REJECT

        def cancel(_handle):
            counters["cancelRequests"] += 1
            return CancelResponse.REJECT

        def execute(_handle):
            counters["executions"] += 1
            raise AssertionError("the validation must not execute an action")

        for _path_id, endpoint, action_type in paths:
            servers.append(ActionServer(node, get_action(action_type), endpoint,
                                        execute_callback=execute, goal_callback=goal, cancel_callback=cancel))
        thread = threading.Thread(target=executor.spin, daemon=True)
        thread.start()
        yield {"paths": paths, "counters": counters,
               "environment": {"rosDistro": os.environ["ROS_DISTRO"],
                               "rmwImplementation": get_rmw_implementation_identifier(),
                               "domainId": int(os.environ.get("ROS_DOMAIN_ID", "0"))}}
    finally:
        try:
            if executor is not None:
                executor.shutdown(timeout_sec=5.0)
            if thread is not None:
                thread.join(timeout=5.0)
            for server in reversed(servers):
                server.destroy()
            if node is not None:
                node.destroy_node()
        finally:
            context.shutdown()


def e2e_validation(repo, artifacts):
    from rosidl_runtime_py.convert import message_to_ordereddict
    from rosidl_runtime_py.utilities import get_action
    from trajectory_msgs.msg import JointTrajectoryPoint

    directory = artifacts / "e2e"
    directory.mkdir()
    commands = Commands(directory)
    # Use dependencies installed from the current lock in the image, not host node_modules.
    runtime = Path(tempfile.mkdtemp(prefix="rlsok-cli-snapshot-"))
    shutil.copytree(repo / "dist", runtime / "dist")
    collector_directory = runtime / "experimental/composable-shadow"
    collector_directory.mkdir(parents=True)
    shutil.copy2(repo / "experimental/composable-shadow/collect.py", collector_directory)
    (runtime / "node_modules").symlink_to("/opt/rlsok-dependencies/node_modules", target_is_directory=True)
    cli = ["node", str(runtime / "dist/apps/cli/rlsok.js")]
    workspace = directory / "workspace"
    commands.run("init", cli + ["profile", "init", "--template", "fanuc-humble", "--output", str(workspace)])
    profile_file = workspace / "profile.json"
    profile = json.loads(profile_file.read_text())
    with mock_graph() as graph:
        profile["environment"] = graph["environment"]
        profile["id"] = "humble-isolated-three-path-validation"
        profile["robot"]["model"] = "RLSOK simulated cell (not a physical FANUC)"
        profile["robot"]["controller"] = "zero-request test action servers"
        profile["maxObservationAgeMs"] = 300000
        state = {"observedAt": timestamp(), "controllerSoftware": "isolated-humble-test-controller/v1",
                 "toolConfigurationSha256": canonical_hash({"testTool": 1, "tcp": [0, 0, 0, 0, 0, 0]}),
                 "frameConfigurationSha256": canonical_hash({"testFrame": "validation_world", "origin": [0, 0, 0]}),
                 "stackRevision": "isolated-validation:" + FANUC_COMMIT}
        write_json(workspace / "controller-state.json", state)
        calibration = workspace / "eye-to-hand.yaml"
        calibration_baseline = "simulation_only: true\ncalibration_revision: baseline\ntranslation: [0, 0, 0]\n"
        calibration.write_text(calibration_baseline)
        for fact in profile["facts"]:
            if fact["kind"] == "file_sha256":
                fact["expected"] = hashlib.sha256((workspace / fact["path"]).read_bytes()).hexdigest()
            else:
                fact["expected"] = state[fact["pointer"][1:]]
        for path in profile["paths"]:
            _path_id, endpoint, action_type = next(item for item in graph["paths"] if item[0] == path["id"])
            description = json.loads(commands.run(f"describe-{path['id']}",
                                      cli + ["profile", "describe-interface", "--type", action_type]))
            path.update({"endpoint": endpoint, "actionType": action_type,
                         "interfaceSha256": description["interfaceSha256"]})
            if path["id"] == "cartesian":
                path["fields"] = {"position": "/target/pose/position", "orientation": "/target/pose/orientation",
                                  "frame": "/target/header/frame_id", "expectedFrame": "validation_world"}
            if path["id"] == "tp_program":
                path["fields"]["allowedPrograms"] = ["SIMULATED_PICK"]
        write_json(profile_file, profile)
        trajectory = get_action(TRAJECTORY_ACTION).Goal()
        trajectory.trajectory.joint_names = profile["jointOrder"]
        point = JointTrajectoryPoint()
        point.positions = [0.0] * len(profile["jointOrder"])
        point.time_from_start.sec = 1
        trajectory.trajectory.points = [point]
        absolute = get_action(ABSOLUTE_ACTION).Goal()
        absolute.target.header.frame_id = "validation_world"
        absolute.target.pose.position.x = 0.1
        absolute.target.pose.position.y = 0.2
        absolute.target.pose.position.z = 0.3
        absolute.target.pose.orientation.w = 1.0
        program = get_action(TP_ACTION).Goal()
        program.program_name = "SIMULATED_PICK"
        proposals = {"schemaVersion": 1, "proposals": [
            {"id": f"observed-layout-{name}", "pathId": name, "goal": message_to_ordereddict(goal)}
            for name, goal in (("trajectory", trajectory), ("cartesian", absolute), ("tp_program", program))]}
        proposals_file = workspace / "proposals.json"
        write_json(proposals_file, proposals)
        approval = workspace / "approval.json"
        expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        commands.run("approve", cli + ["profile", "approve", "--profile", str(profile_file), "--actor",
                     "isolated-simulation-validator", "--expires-at", expiry, "--output", str(approval)])
        results = {}
        phases = (("baseline", None), ("changed-calibration", "calibration"), ("changed-tool", "tool"),
                  ("changed-frame", "frame"), ("changed-controller", "controller_software"))
        for phase, changed_fact in phases:
            expected_code, decision = (0, "WOULD_ALLOW") if phase == "baseline" else (2, "WOULD_BLOCK")
            calibration.write_text(calibration_baseline)
            current_state = dict(state, observedAt=timestamp())
            if phase == "changed-calibration":
                calibration.write_text("simulation_only: true\ncalibration_revision: changed\ntranslation: [0.001, 0, 0]\n")
            elif phase == "changed-tool":
                current_state["toolConfigurationSha256"] = canonical_hash({"testTool": 2, "tcp": [0.1, 0, 0, 0, 0, 0]})
            elif phase == "changed-frame":
                current_state["frameConfigurationSha256"] = canonical_hash({"testFrame": "validation_world", "origin": [0.1, 0, 0]})
            elif phase == "changed-controller":
                current_state["controllerSoftware"] = "isolated-humble-test-controller/v2-drifted"
            write_json(workspace / "controller-state.json", current_state)
            observation = workspace / f"{phase}-observation.json"
            commands.run(f"capture-{phase}", cli + ["profile", "capture", "--profile", str(profile_file), "--output", str(observation)])
            output = directory / phase
            commands.run(f"shadow-{phase}", cli + ["profile", "shadow", "--profile", str(profile_file),
                         "--approval", str(approval), "--observation", str(observation), "--proposals",
                         str(proposals_file), "--output", str(output)], expected=expected_code)
            report = json.loads((output / "report.json").read_text())
            assert report["decision"] == decision, report
            assert len(report["results"]) == 3 and all(item["decision"] == decision for item in report["results"]), report
            assert report["collector"] == "ros2-read-only/v1", report
            assert report["hardwareSignalSent"] is False and report["controllerGoalsAttempted"] == 0, report
            for item in report["results"]:
                failures = [check["id"] for check in item["checks"] if not check["passed"]]
                expected_failures = [f"fact.{changed_fact}.value"] if changed_fact else []
                assert failures == expected_failures, {"phase": phase, "path": item["pathId"], "failures": failures}
                matching_configuration = item["expectedConfigurationDigest"] == item["observedConfigurationDigest"]
                assert matching_configuration == (changed_fact is None), item
                commands.run(f"verify-{phase}-{item['pathId']}", cli + ["verify-evidence",
                             str(output / f"{item['pathId']}.evidence.json"), "--release",
                             str(output / f"{item['pathId']}.release.json")])
            assert all(value == 0 for value in graph["counters"].values()), graph["counters"]
            results[phase] = {"decision": decision, "pathDecisions": {item["pathId"]: item["decision"] for item in report["results"]},
                              "zeroRequests": dict(graph["counters"])}
            if changed_fact:
                actual_observation = json.loads(observation.read_text())
                expected_value = next(item["expected"] for item in profile["facts"] if item["id"] == changed_fact)
                observed_value = next(item["value"] for item in actual_observation["facts"] if item["id"] == changed_fact)
                assert observed_value != expected_value
                results[phase]["changedFact"] = {"id": changed_fact, "expected": expected_value, "observed": observed_value}
        original = json.loads((workspace / "baseline-observation.json").read_text())
        changed = json.loads((workspace / "changed-calibration-observation.json").read_text())
        before_hash = next(item["value"] for item in original["facts"] if item["id"] == "calibration")
        after_hash = next(item["value"] for item in changed["facts"] if item["id"] == "calibration")
        assert before_hash != after_hash
        assert original["facts"] != changed["facts"]
        observer = {"schema": "rlsok.validation.zero-requests/v1", "environment": graph["environment"],
                    "paths": graph["paths"], "phases": results, "finalCounts": dict(graph["counters"]),
                    "calibrationHashes": {"baseline": before_hash, "changed": after_hash}}
    observer["testNodesCleanedUp"] = True
    write_json(directory / "observer.json", observer)
    return observer


def inside_validation(args):
    repo, artifacts = args.repo, args.artifacts
    commands = Commands(artifacts)
    assert os.environ.get("ROS_DISTRO") == "humble", "this validation must execute Humble"
    versions = {"rosDistro": os.environ["ROS_DISTRO"], "python": sys.version,
                "rclpy": importlib.metadata.version("rclpy"), "fanucCommit": FANUC_COMMIT,
                "osRelease": Path("/etc/os-release").read_text(),
                "node": commands.run("node-version", ["node", "--version"]).strip()}
    commands.run("ros-package-versions", ["dpkg-query", "-W", "ros-humble-*"], timeout=30)
    write_json(artifacts / "versions.json", versions)
    commands.run("unit", ["python3", "-B", str(repo / "experimental/composable-shadow/test_collect.py"), "-v"])
    environment = dict(os.environ, RLSOK_RUN_ROS_GRAPH_TESTS="1")
    commands.run("standard-graph", ["python3", "-B", str(repo / "experimental/composable-shadow/test_ros_graph.py"), "-v"], environment=environment)
    environment.update({"RLSOK_TEST_CARTESIAN_ACTION": "fanucpy_ros2_interfaces/action/JogCartesian",
                        "RLSOK_TEST_TP_ACTION": TP_ACTION})
    commands.run("public-graph", ["python3", "-B", str(repo / "experimental/composable-shadow/test_ros_graph.py"), "-v"], environment=environment)
    observer = e2e_validation(repo, artifacts)
    summary = {"status": "PASS", "finishedAt": timestamp(), "versions": versions,
               "unitTests": "PASS", "standardGraphTests": "PASS", "publicFanucGraphTests": "PASS",
               "absoluteExampleType": ABSOLUTE_ACTION, "e2e": observer,
               "boundary": "isolated simulated acceptance; no physical robot or private customer interface claimed"}
    write_json(artifacts / "summary.json", summary)
    print(json.dumps({"status": "PASS", "rosDistro": "humble", "zeroRequests": observer["finalCounts"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--docker-host")
    parser.add_argument("--private-daemon", action="store_true")
    parser.add_argument("--inside", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.inside:
            inside_validation(args)
        else:
            host_validation(args)
    except Exception as error:
        if args.artifacts.is_dir() and (args.inside or getattr(args, "owns_artifacts", False)):
            write_json(args.artifacts / "failure.json", {"at": timestamp(), "error": str(error), "type": type(error).__name__})
        raise


if __name__ == "__main__":
    main()
