#!/usr/bin/env python3
"""Experimental ROS 2 transport sidecar for RLSOK ReleaseGate.

This process is intentionally untrusted: it owns ROS topic/action transport
only. Release resolution, policy, permits, revocation, and evidence stay in the
TypeScript Core process.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    import rclpy
    from rclpy.utilities import get_rmw_implementation_identifier
    from builtin_interfaces.msg import Duration
    from control_msgs.action import FollowJointTrajectory
    from rclpy.action import ActionClient
    from rclpy.node import Node
    from sensor_msgs.msg import JointState
    from std_msgs.msg import String
    from trajectory_msgs.msg import JointTrajectoryPoint
except ImportError as import_error:
    rclpy = None
    ROS_IMPORT_ERROR = str(import_error)
else:
    ROS_IMPORT_ERROR = ""

NodeBase = globals().get("Node", object)


OUTPUT_LOCK = threading.Lock()


def emit(message: Dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


class ReferenceTransportNode(NodeBase):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__("rlsok_reference_gateway")
        self.args = args
        self.latest_state: Optional[Dict[str, Any]] = None
        self.active_goal = None
        self.create_subscription(String, args.proposal_topic, self._proposal, 10)
        self.create_subscription(JointState, args.joint_state_topic, self._joint_state, 10)
        self.action_client = ActionClient(
            self, FollowJointTrajectory, args.controller_action
        )

    def _proposal(self, message: String) -> None:
        emit({"event": "proposal", "payload": message.data})

    def _joint_state(self, message: JointState) -> None:
        stamp = message.header.stamp
        seconds = stamp.sec + stamp.nanosec / 1_000_000_000
        # Freshness is measured from receipt at this trust boundary. ROS header
        # stamps can use simulation time (for example Gazebo starts at epoch 0)
        # and therefore must not be interpreted as UTC wall clock time.
        observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        state = {
            "names": list(message.name),
            "positions": list(message.position),
            "observedAt": observed_at,
        }
        if seconds > 0:
            state["sourceTimestamp"] = datetime.fromtimestamp(
                seconds, timezone.utc
            ).isoformat().replace("+00:00", "Z")
        self.latest_state = state
        emit({"event": "joint_state", "state": state})

    def dispatch(self, params: Dict[str, Any]) -> Dict[str, Any]:
        # A newly started DDS participant can need several discovery rounds
        # even when the controller was already running.
        if not self.action_client.wait_for_server(
            timeout_sec=self.args.discovery_timeout_seconds
        ):
            return {"accepted": False, "detail": "action_server_unavailable"}
        action = params["action"]
        goal = FollowJointTrajectory.Goal()
        goal.trajectory.joint_names = action["jointNames"]
        for source in action["points"]:
            point = JointTrajectoryPoint()
            point.positions = source["positions"]
            if "velocities" in source:
                point.velocities = source["velocities"]
            milliseconds = int(source["timeFromStartMs"])
            point.time_from_start = Duration(
                sec=milliseconds // 1000,
                nanosec=(milliseconds % 1000) * 1_000_000,
            )
            goal.trajectory.points.append(point)
        future = self.action_client.send_goal_async(goal)
        self._wait_for_future(future, 2.0)
        handle = future.result()
        if handle is None or not handle.accepted:
            return {"accepted": False, "detail": "goal_rejected"}
        self.active_goal = handle
        result_future = handle.get_result_async()
        try:
            self._wait_for_future(result_future, self.args.result_timeout_seconds)
        except TimeoutError:
            return {
                "accepted": True,
                "completed": False,
                "succeeded": False,
                "detail": "controller_result_timeout",
            }
        wrapped = result_future.result()
        if wrapped is None:
            return {
                "accepted": True,
                "completed": False,
                "succeeded": False,
                "detail": "controller_result_missing",
            }
        result = wrapped.result
        error_code = int(result.error_code)
        self.active_goal = None
        return {
            "accepted": True,
            "completed": True,
            "succeeded": error_code == 0,
            "status": int(wrapped.status),
            "errorCode": error_code,
            "errorString": str(result.error_string),
            "detail": "controller_succeeded" if error_code == 0 else "controller_reported_failure",
        }

    def cancel(self, _params: Dict[str, Any]) -> Dict[str, Any]:
        if self.active_goal is None:
            return {"requested": False, "detail": "no_active_goal"}
        future = self.active_goal.cancel_goal_async()
        self._wait_for_future(future, 2.0)
        response = future.result()
        requested = response is not None and len(response.goals_canceling) > 0
        if requested:
            self.active_goal = None
        return {
            "requested": requested,
            "detail": "cancel_requested" if requested else "cancel_rejected",
        }

    @staticmethod
    def _wait_for_future(future: Any, timeout_seconds: float) -> None:
        completed = threading.Event()
        future.add_done_callback(lambda _future: completed.set())
        if not completed.wait(timeout_seconds):
            raise TimeoutError("ros_action_request_timeout")

    def doctor(self) -> Dict[str, Any]:
        return {
            "rosAvailable": True,
            "rosDistro": os.environ.get("ROS_DISTRO"),
            "rmwImplementation": get_rmw_implementation_identifier(),
            "rosDomainId": os.environ.get("ROS_DOMAIN_ID", "0"),
            "proposalTopic": self.args.proposal_topic,
            "jointStateTopic": self.args.joint_state_topic,
            "controllerAction": self.args.controller_action,
            "discoveryTimeoutSeconds": self.args.discovery_timeout_seconds,
            "jointStateFresh": self.latest_state is not None,
            "actionServerAvailable": self.action_client.server_is_ready(),
            "sros2Enabled": (
                os.environ.get("ROS_SECURITY_ENABLE") == "true"
                and os.environ.get("ROS_SECURITY_STRATEGY") == "Enforce"
            ),
            "limitations": [
                "experimental_reference_only",
                "not_safety_rated",
                "not_hard_realtime",
                "protective_stop_requires_independent_safety_system",
            ],
        }


class DiscoveryNode(NodeBase):
    """Read-only ROS graph discovery used by the first-run product flow."""

    def __init__(self) -> None:
        super().__init__("rlsok_environment_discovery")
        self.samples: Dict[str, Dict[str, Any]] = {}
        self.subscriptions = []

    def subscribe_joint_states(self) -> None:
        for name, types in self.get_topic_names_and_types():
            if "sensor_msgs/msg/JointState" not in types:
                continue
            self.subscriptions.append(
                self.create_subscription(
                    JointState,
                    name,
                    lambda message, topic=name: self._sample(topic, message),
                    10,
                )
            )

    def _sample(self, topic: str, message: Any) -> None:
        self.samples[topic] = {
            "jointNames": list(message.name),
            "positions": list(message.position),
            "observedAt": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        }

    def report(self) -> Dict[str, Any]:
        topics = [
            {"name": name, "types": sorted(types)}
            for name, types in self.get_topic_names_and_types()
        ]
        actions = [
            {"name": name, "types": sorted(types)}
            for name, types in self.get_action_names_and_types()
        ]
        return {
            "rosAvailable": True,
            "rosDistro": os.environ.get("ROS_DISTRO"),
            "rmwImplementation": get_rmw_implementation_identifier(),
            "rosDomainId": os.environ.get("ROS_DOMAIN_ID", "0"),
            "jointStateSources": [
                {
                    "name": topic["name"],
                    "types": topic["types"],
                    "sample": self.samples.get(topic["name"]),
                }
                for topic in topics
                if "sensor_msgs/msg/JointState" in topic["types"]
            ],
            "trajectoryActionServers": [
                action
                for action in actions
                if "control_msgs/action/FollowJointTrajectory" in action["types"]
            ],
            "nodes": sorted(
                name for name, _namespace in self.get_node_names_and_namespaces()
            ),
        }

    def inspect_graph(self) -> Dict[str, Any]:
        return {
            "nodes": sorted(name for name, _namespace in self.get_node_names_and_namespaces()),
            "topics": sorted(name for name, _types in self.get_topic_names_and_types()),
            "services": sorted(name for name, _types in self.get_service_names_and_types()),
            "actionServerAvailable": self.action_client.server_is_ready(),
            "latestJointState": self.latest_state,
        }


def unavailable_report(args: argparse.Namespace) -> Dict[str, Any]:
    return {
        "rosAvailable": False,
        "rosDistro": os.environ.get("ROS_DISTRO"),
        "rmwImplementation": os.environ.get("RMW_IMPLEMENTATION"),
        "rosDomainId": os.environ.get("ROS_DOMAIN_ID", "0"),
        "proposalTopic": args.proposal_topic,
        "jointStateTopic": args.joint_state_topic,
        "controllerAction": args.controller_action,
        "discoveryTimeoutSeconds": args.discovery_timeout_seconds,
        "jointStateFresh": False,
        "actionServerAvailable": False,
        "sros2Enabled": (
            os.environ.get("ROS_SECURITY_ENABLE") == "true"
            and os.environ.get("ROS_SECURITY_STRATEGY") == "Enforce"
        ),
        "limitations": [
            "rclpy_unavailable",
            "experimental_reference_only",
            "not_safety_rated",
            "not_hard_realtime",
        ],
        "detail": ROS_IMPORT_ERROR,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proposal-topic", default="/rlsok/action_proposals")
    parser.add_argument("--joint-state-topic", default="/joint_states")
    parser.add_argument(
        "--controller-action",
        default="/joint_trajectory_controller/follow_joint_trajectory",
    )
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--result-timeout-seconds", type=float, default=30.0)
    parser.add_argument("--discovery-timeout-seconds", type=float, default=15.0)
    args = parser.parse_args()
    if not 1.0 <= args.discovery_timeout_seconds <= 120.0:
        parser.error("--discovery-timeout-seconds must be between 1 and 120")

    if rclpy is None:
        report = unavailable_report(args)
        if args.doctor or args.inspect or args.discover:
            print(json.dumps(report, indent=2))
        else:
            emit({"event": "unavailable", "report": report})
        return 2

    rclpy.init()
    if args.discover:
        node = DiscoveryNode()
        # First discover graph endpoints, then subscribe to every standard
        # JointState source and wait a bounded period for a real sample.
        discovery_deadline = (
            datetime.now(timezone.utc).timestamp()
            + args.discovery_timeout_seconds
        )
        warmup_deadline = min(
            discovery_deadline,
            datetime.now(timezone.utc).timestamp()
            + min(2.0, args.discovery_timeout_seconds / 2),
        )
        while datetime.now(timezone.utc).timestamp() < warmup_deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
        node.subscribe_joint_states()
        while datetime.now(timezone.utc).timestamp() < discovery_deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
            report = node.report()
            sources = report["jointStateSources"]
            if (
                sources
                and all(source["sample"] for source in sources)
                and report["trajectoryActionServers"]
            ):
                break
        print(json.dumps(node.report(), indent=2))
        node.destroy_node()
        rclpy.shutdown()
        return 0

    node = ReferenceTransportNode(args)
    if args.doctor:
        print(json.dumps(node.doctor(), indent=2))
        node.destroy_node()
        rclpy.shutdown()
        return 0
    if args.inspect:
        print(json.dumps(node.inspect_graph(), indent=2))
        node.destroy_node()
        rclpy.shutdown()
        return 0

    executor = rclpy.executors.MultiThreadedExecutor()
    executor.add_node(node)
    executor_thread = threading.Thread(target=executor.spin, daemon=True)
    executor_thread.start()

    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                operation = request.get("operation")
                params = request.get("params", {})
                if operation == "ping":
                    result = {"ready": True}
                elif operation == "doctor":
                    result = node.doctor()
                elif operation == "inspect":
                    result = node.inspect_graph()
                elif operation == "dispatch":
                    result = node.dispatch(params)
                elif operation == "cancel":
                    result = node.cancel(params)
                elif operation == "shutdown":
                    result = {"closed": True}
                else:
                    raise ValueError("unknown_operation")
                emit({"id": request.get("id"), "ok": True, "result": result})
                if operation == "shutdown":
                    break
            except Exception as error:
                emit(
                    {
                        "id": request.get("id") if "request" in locals() else None,
                        "ok": False,
                        "error": str(error),
                    }
                )
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
