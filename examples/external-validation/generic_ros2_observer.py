#!/usr/bin/env python3
"""Independent isolated ROS 2 graph and zero-dispatch observer.

This process deliberately owns the fake FollowJointTrajectory action server.
Use it only in an isolated ROS_DOMAIN_ID with no physical controller. It emits
fresh JointState samples, counts every action goal request, and writes a
machine-readable proof after the caller marks command start and finish.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import time
from typing import Any
import uuid

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action import ActionClient, ActionServer, CancelResponse, GoalResponse
from rclpy.node import Node
from sensor_msgs.msg import JointState


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label}_invalid") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{label}_timezone_required")
    return parsed


def normalize_name(value: str, label: str) -> str:
    parts = [part for part in value.strip().split("/") if part]
    if not parts or any(
        not all(character.isalnum() or character in "_-" for character in part)
        for part in parts
    ):
        raise ValueError(f"{label}_invalid")
    return "/" + "/".join(parts)


def read_marker(path: Path, label: str) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise ValueError(f"{label}_empty")
    parse_timestamp(value, label)
    return value


def write_private(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        raise ValueError(f"path_must_not_exist:{path}")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class IsolatedObserver(Node):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__("rlsok_external_zero_dispatch_observer")
        self.args = args
        self.goal_request_count = 0
        self.first_goal_request: dict[str, Any] | None = None
        self.cancel_requests = 0
        self.command_path_matched = False
        self.server_ready_at: str | None = None
        self.rlsok_client_matched_at: str | None = None
        self.maximum_command_server_count = 0
        self.joint_state_subscriber_matched_at: str | None = None
        self.joint_state_publications_before_pause = 0
        self.last_joint_state_published_at: str | None = None
        self.state_paused_at: str | None = None
        self.fresh_state_ready_written = False
        self.publisher = self.create_publisher(JointState, args.joint_state, 10)
        self.timer = self.create_timer(0.05, self.publish_state)
        self.action_server = ActionServer(
            self,
            FollowJointTrajectory,
            args.action,
            execute_callback=self.execute,
            goal_callback=self.goal,
            cancel_callback=self.cancel,
        )
        self.probe_client = ActionClient(self, FollowJointTrajectory, args.action)

    def publish_state(self) -> None:
        if self.args.pause_state_file.exists():
            if self.state_paused_at is None:
                self.state_paused_at = utc_now()
            return
        names = list(self.args.joints)
        if self.args.drift_state_file.exists():
            names[-1] = f"{names[-1]}_drifted"
        message = JointState()
        message.header.stamp = self.get_clock().now().to_msg()
        message.name = names
        message.position = [0.0 for _ in names]
        self.publisher.publish(message)
        published_at = utc_now()
        self.last_joint_state_published_at = published_at
        if self.args.start_file.exists() and not self.args.finish_file.exists():
            self.joint_state_publications_before_pause += 1
        if (
            self.args.case_id == "stale_state"
            and self.joint_state_subscriber_matched_at is not None
            and self.joint_state_publications_before_pause >= 10
            and not self.fresh_state_ready_written
        ):
            write_private(
                self.args.fresh_state_ready_file,
                {
                    "schema": "rlsok.io/fresh-joint-state-ready/v1",
                    "sessionId": self.args.session_id,
                    "caseId": self.args.case_id,
                    "subscriberMatchedAt": self.joint_state_subscriber_matched_at,
                    "publicationCount": self.joint_state_publications_before_pause,
                    "lastPublishedAt": published_at,
                },
            )
            self.fresh_state_ready_written = True

    def goal(self, request: FollowJointTrajectory.Goal) -> GoalResponse:
        self.goal_request_count += 1
        if self.first_goal_request is None:
            self.first_goal_request = {
                "observedAt": utc_now(),
                "jointNames": list(request.trajectory.joint_names),
                "pointCount": len(request.trajectory.points),
            }
        # The isolated observer never executes a received trajectory. Merely
        # reaching this callback violates the Shadow zero-dispatch invariant.
        return GoalResponse.REJECT

    def cancel(self, _goal_handle: Any) -> CancelResponse:
        self.cancel_requests += 1
        return CancelResponse.REJECT

    async def execute(self, _goal_handle: Any) -> FollowJointTrajectory.Result:
        return FollowJointTrajectory.Result()

    def update_server_state(self) -> None:
        service = f"{self.args.action}/_action/send_goal"
        self.maximum_command_server_count = max(
            self.maximum_command_server_count,
            self.count_services(service),
        )
        if not self.command_path_matched and self.probe_client.server_is_ready():
            self.command_path_matched = True
            self.server_ready_at = utc_now()

    def update_external_client_match(self, command_started: bool) -> None:
        self.update_server_state()
        if (
            command_started
            and self.rlsok_client_matched_at is None
            and self.count_clients(f"{self.args.action}/_action/send_goal") > 0
        ):
            self.rlsok_client_matched_at = utc_now()
        if (
            command_started
            and self.joint_state_subscriber_matched_at is None
            and self.count_subscribers(self.args.joint_state) > 0
        ):
            self.joint_state_subscriber_matched_at = utc_now()

    def finish_probe(self) -> None:
        self.probe_client.destroy()

    def close(self) -> None:
        self.action_server.destroy()
        self.destroy_node()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ready-file", required=True, type=Path)
    parser.add_argument("--start-file", required=True, type=Path)
    parser.add_argument("--finish-file", required=True, type=Path)
    parser.add_argument("--fresh-state-ready-file", required=True, type=Path)
    parser.add_argument("--pause-state-file", required=True, type=Path)
    parser.add_argument("--drift-state-file", required=True, type=Path)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--command-sha256", required=True)
    parser.add_argument("--invocation-sha256", required=True)
    parser.add_argument("--observer-instance-id", required=True)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--action", default="/joint_trajectory_controller/follow_joint_trajectory")
    parser.add_argument("--joint-state", default="/joint_states")
    parser.add_argument("--joints", default="joint_a,joint_b")
    parser.add_argument("--timeout-seconds", type=float, default=1800.0)
    parser.add_argument("--settle-seconds", type=float, default=1.0)
    args = parser.parse_args()
    args.action = normalize_name(args.action, "action")
    args.joint_state = normalize_name(args.joint_state, "joint_state")
    args.joints = [joint.strip() for joint in args.joints.split(",") if joint.strip()]
    for value, label in (
        (args.session_id, "session_id"),
        (args.observer_instance_id, "observer_instance_id"),
        (args.nonce, "nonce"),
    ):
        try:
            uuid.UUID(value)
        except ValueError as error:
            raise ValueError(f"{label}_invalid") from error
    if not args.case_id or len(args.case_id) > 128:
        raise ValueError("case_id_invalid")
    for value, label in (
        (args.command_sha256, "command_sha256"),
        (args.invocation_sha256, "invocation_sha256"),
    ):
        if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
            raise ValueError(f"{label}_invalid")
    if len(args.joints) < 2 or len(set(args.joints)) != len(args.joints):
        raise ValueError("joints_must_be_unique_and_contain_at_least_two_names")
    if not math.isfinite(args.timeout_seconds) or not 10 <= args.timeout_seconds <= 7200:
        raise ValueError("timeout_seconds_out_of_range")
    if not math.isfinite(args.settle_seconds) or not 0.1 <= args.settle_seconds <= 30:
        raise ValueError("settle_seconds_out_of_range")
    for path in (
        args.output,
        args.ready_file,
        args.start_file,
        args.finish_file,
        args.fresh_state_ready_file,
    ):
        if path.exists():
            raise ValueError(f"path_must_not_exist:{path}")

    rclpy.init()
    node = IsolatedObserver(args)
    armed_at = utc_now()
    ready_deadline = time.monotonic() + 10.0
    stable_exclusive_samples = 0
    while rclpy.ok() and time.monotonic() < ready_deadline:
        rclpy.spin_once(node, timeout_sec=0.02)
        node.update_server_state()
        server_count = node.count_services(f"{args.action}/_action/send_goal")
        stable_exclusive_samples = stable_exclusive_samples + 1 if server_count == 1 else 0
        if node.command_path_matched and stable_exclusive_samples >= 5:
            break
    if not node.command_path_matched or stable_exclusive_samples < 5:
        node.close()
        rclpy.shutdown()
        raise RuntimeError("exclusive_action_server_did_not_become_graph_stable")
    node.finish_probe()
    no_probe_clients = 0
    probe_cleanup_deadline = time.monotonic() + 5.0
    while rclpy.ok() and time.monotonic() < probe_cleanup_deadline:
        rclpy.spin_once(node, timeout_sec=0.02)
        node.update_server_state()
        if node.count_clients(f"{args.action}/_action/send_goal") == 0:
            no_probe_clients += 1
            if no_probe_clients >= 5:
                break
        else:
            no_probe_clients = 0
    if no_probe_clients < 5:
        node.close()
        rclpy.shutdown()
        raise RuntimeError("observer_probe_client_did_not_leave_graph")
    write_private(
        args.ready_file,
        {
            "schema": "rlsok.io/zero-dispatch-observer-ready/v1",
            "armedAt": armed_at,
            "observerId": node.get_name(),
            "commandPath": args.action,
            "jointStatePath": args.joint_state,
            "exclusiveCommandServer": True,
            "commandServerCountAtArm": 1,
        },
    )
    deadline = time.monotonic() + args.timeout_seconds
    command_started_at: str | None = None
    command_finished_at: str | None = None
    settle_deadline: float | None = None
    completed = False
    try:
        while rclpy.ok() and time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.02)
            node.update_external_client_match(command_started_at is not None)
            if command_started_at is None and args.start_file.exists():
                command_started_at = read_marker(args.start_file, "command_start_marker")
            if command_started_at is not None and command_finished_at is None and args.finish_file.exists():
                command_finished_at = read_marker(args.finish_file, "command_finish_marker")
                settle_deadline = time.monotonic() + args.settle_seconds
            if settle_deadline is not None and time.monotonic() >= settle_deadline:
                completed = True
                break
    finally:
        node.close()
        rclpy.shutdown()

    settle_finished_at = utc_now()
    result = {
        "schema": "rlsok.io/zero-dispatch-observer/v1",
        "sessionId": args.session_id,
        "caseId": args.case_id,
        "commandSha256": args.command_sha256,
        "invocationSha256": args.invocation_sha256,
        "observerInstanceId": args.observer_instance_id,
        "nonce": args.nonce,
        "observerId": "isolated-generic-follow-joint-trajectory-server",
        "implementation": "independent rclpy ActionServer goal-request counter",
        "independentFromRlsok": True,
        "commandPath": args.action,
        "armedBeforeCommand": command_started_at is not None and parse_timestamp(armed_at, "armed_at") <= parse_timestamp(command_started_at, "command_started_at"),
        "commandPathMatched": node.command_path_matched,
        "qosCompatible": node.command_path_matched,
        "armedAt": armed_at,
        "serverReadyAt": node.server_ready_at,
        "commandStartedAt": command_started_at,
        "rlsokClientMatchedAt": node.rlsok_client_matched_at,
        "jointStateSubscriberMatchedAt": node.joint_state_subscriber_matched_at,
        "jointStatePublicationsBeforePause": node.joint_state_publications_before_pause,
        "lastJointStatePublishedAt": node.last_joint_state_published_at,
        "statePausedAt": node.state_paused_at,
        "commandFinishedAt": command_finished_at,
        "settleFinishedAt": settle_finished_at,
        "commandServerCountAtArm": 1,
        "maximumCommandServerCount": node.maximum_command_server_count,
        "baselineDispatchCount": 0,
        "finalDispatchCount": node.goal_request_count,
        "rlsokDispatchesObserved": node.goal_request_count,
        # Bound hostile traffic: one sample is enough to invalidate zero-dispatch.
        "goalRequests": [] if node.first_goal_request is None else [node.first_goal_request],
        # rclpy invokes this callback only for cancel requests associated with
        # a known goal; it is supplementary and is not claimed as raw service
        # request coverage.
        "acceptedGoalCancelCallbacks": node.cancel_requests,
        "observerCompleted": completed,
        "terminationReason": "settle_complete" if completed else "timeout_or_shutdown",
        "statePausedDuringWindow": args.pause_state_file.exists(),
        "configurationDriftDuringWindow": args.drift_state_file.exists(),
    }
    write_private(args.output, result)
    print(json.dumps(result, separators=(",", ":")))
    return 0 if completed else 2


if __name__ == "__main__":
    raise SystemExit(main())
