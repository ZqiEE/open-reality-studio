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
from typing import Any, Dict, Optional

try:
    import rclpy
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
        if seconds <= 0:
            seconds = self.get_clock().now().nanoseconds / 1_000_000_000
        from datetime import datetime, timezone
        observed_at = datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        state = {
            "names": list(message.name),
            "positions": list(message.position),
            "observedAt": observed_at,
        }
        self.latest_state = state
        emit({"event": "joint_state", "state": state})

    def dispatch(self, params: Dict[str, Any]) -> Dict[str, Any]:
        if not self.action_client.wait_for_server(timeout_sec=1.0):
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
        return {"accepted": True, "detail": "goal_accepted"}

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
            "rmwImplementation": os.environ.get("RMW_IMPLEMENTATION"),
            "rosDomainId": os.environ.get("ROS_DOMAIN_ID", "0"),
            "proposalTopic": self.args.proposal_topic,
            "jointStateTopic": self.args.joint_state_topic,
            "controllerAction": self.args.controller_action,
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
    args = parser.parse_args()

    if rclpy is None:
        report = unavailable_report(args)
        if args.doctor or args.inspect:
            print(json.dumps(report, indent=2))
        else:
            emit({"event": "unavailable", "report": report})
        return 2

    rclpy.init()
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
