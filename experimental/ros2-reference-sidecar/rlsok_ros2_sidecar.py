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
    from rclpy.action.graph import (
        get_action_names_and_types,
        get_action_server_names_and_types_by_node,
    )
    from rclpy.node import Node
    from rclpy.qos import (
        DurabilityPolicy,
        QoSProfile,
        ReliabilityPolicy,
        qos_profile_sensor_data,
    )
    from sensor_msgs.msg import JointState
    from std_msgs.msg import String
    from trajectory_msgs.msg import JointTrajectoryPoint
except ImportError as import_error:
    rclpy = None
    ROS_IMPORT_ERROR = str(import_error)
else:
    ROS_IMPORT_ERROR = ""

if rclpy is not None:
    try:
        from controller_manager_msgs.srv import ListControllers
    except ImportError:
        ListControllers = None
else:
    ListControllers = None

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
        # JointState is sensor data. Request Best Effort so this subscriber is
        # compatible with both Best Effort ros2_control publishers and
        # Reliable publishers; requesting Reliable cannot match a Best Effort
        # writer and previously produced a false "no valid sample" failure.
        self.create_subscription(
            JointState,
            args.joint_state_topic,
            self._joint_state,
            qos_profile_sensor_data,
        )
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
        names = list(message.name)
        positions = list(message.position)
        requested_order = self.args.joint_order
        if requested_order and set(names) == set(requested_order):
            by_name = dict(zip(names, positions))
            names = list(requested_order)
            positions = [by_name[name] for name in requested_order]
        state = {
            "names": names,
            "positions": positions,
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

    def inspect_graph(self) -> Dict[str, Any]:
        return {
            "nodes": sorted(
                name for name, _namespace in self.get_node_names_and_namespaces()
            ),
            "topics": sorted(
                name for name, _types in self.get_topic_names_and_types()
            ),
            "services": sorted(
                name for name, _types in self.get_service_names_and_types()
            ),
            "actionServerAvailable": self.action_client.server_is_ready(),
            "latestJointState": self.latest_state,
        }


class DiscoveryNode(NodeBase):
    """Read-only ROS graph discovery used by the first-run product flow."""

    def __init__(self) -> None:
        super().__init__("rlsok_environment_discovery")
        self.samples: Dict[str, Dict[str, Any]] = {}
        self.robot_descriptions: Dict[str, str] = {}
        self.controller_managers: Dict[str, Dict[str, Any]] = {}
        self.controller_futures: Dict[str, Any] = {}
        self.controller_clients: Dict[str, Any] = {}
        self.graph_subscriptions = []
        self.joint_subscriptions = []
        self.subscribed_joint_topics = set()
        self.subscribed_robot_description_topics = set()

    def subscribe_graph_sources(self) -> None:
        for name, types in self.get_topic_names_and_types():
            if "sensor_msgs/msg/JointState" in types:
                if name in self.subscribed_joint_topics:
                    continue
                subscription = self.create_subscription(
                    JointState,
                    name,
                    lambda message, topic=name: self._sample(topic, message),
                    qos_profile_sensor_data,
                )
                self.graph_subscriptions.append(subscription)
                self.joint_subscriptions.append(subscription)
                self.subscribed_joint_topics.add(name)
            if "std_msgs/msg/String" in types and name.endswith("/robot_description"):
                if name in self.subscribed_robot_description_topics:
                    continue
                qos = QoSProfile(
                    depth=1,
                    durability=DurabilityPolicy.TRANSIENT_LOCAL,
                    reliability=ReliabilityPolicy.RELIABLE,
                )
                self.graph_subscriptions.append(
                    self.create_subscription(
                        String,
                        name,
                        lambda message, topic=name: self._robot_description(
                            topic, message
                        ),
                        qos,
                    )
                )
                self.subscribed_robot_description_topics.add(name)
        if ListControllers is not None:
            for name, types in self.get_service_names_and_types():
                if "controller_manager_msgs/srv/ListControllers" not in types:
                    continue
                if name in self.controller_clients:
                    continue
                client = self.create_client(ListControllers, name)
                self.controller_clients[name] = client

    def start_ready_controller_requests(self) -> None:
        """Call each discovered controller manager once after DDS matching."""
        for service_name, client in self.controller_clients.items():
            if (
                service_name in self.controller_futures
                or service_name in self.controller_managers
            ):
                continue
            if client.service_is_ready():
                self.controller_futures[service_name] = client.call_async(
                    ListControllers.Request()
                )

    def controller_services_matched(self) -> bool:
        """Return true when every graph-discovered manager has a live request."""
        return all(
            service_name in self.controller_futures
            or service_name in self.controller_managers
            for service_name in self.controller_clients
        )

    def joint_sources_matched(self) -> bool:
        """Return true only after every discovered JointState reader is matched."""
        return bool(self.joint_subscriptions) and all(
            subscription.get_publisher_count() > 0
            for subscription in self.joint_subscriptions
        )

    def _sample(self, topic: str, message: Any) -> None:
        self.samples[topic] = {
            "jointNames": list(message.name),
            "positions": list(message.position),
            "observedAt": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        }

    def _robot_description(self, topic: str, message: Any) -> None:
        self.robot_descriptions[topic] = str(message.data)

    @staticmethod
    def _namespace_for_controller_service(service_name: str) -> str:
        suffix = "/controller_manager/list_controllers"
        namespace = service_name[: -len(suffix)] if service_name.endswith(suffix) else ""
        return namespace or "/"

    def collect_controller_responses(self) -> None:
        for service_name, future in list(self.controller_futures.items()):
            if not future.done():
                continue
            response = future.result()
            if response is not None:
                self.controller_managers[service_name] = {
                    "namespace": self._namespace_for_controller_service(service_name),
                    "serviceName": service_name,
                    "controllers": [
                        {
                            "name": controller.name,
                            "type": controller.type,
                            "state": controller.state,
                            "claimedInterfaces": list(controller.claimed_interfaces),
                        }
                        for controller in response.controller
                    ],
                }
            del self.controller_futures[service_name]

    def publishers(self, topic: str) -> list[Dict[str, str]]:
        return [
            {
                "nodeName": endpoint.node_name,
                "nodeNamespace": endpoint.node_namespace,
            }
            for endpoint in self.get_publishers_info_by_topic(topic)
        ]

    def action_servers(self, action_name: str) -> list[Dict[str, str]]:
        servers = []
        for node_name, node_namespace in self.get_node_names_and_namespaces():
            try:
                actions = get_action_server_names_and_types_by_node(
                    self, node_name, node_namespace
                )
            except Exception:
                continue
            if any(name == action_name for name, _types in actions):
                servers.append(
                    {"nodeName": node_name, "nodeNamespace": node_namespace}
                )
        return servers

    def auxiliary_discovery_complete(self) -> bool:
        robot_description_topics = [
            name
            for name, types in self.get_topic_names_and_types()
            if "std_msgs/msg/String" in types and name.endswith("/robot_description")
        ]
        return not self.controller_futures and all(
            topic in self.robot_descriptions for topic in robot_description_topics
        )

    def report(self) -> Dict[str, Any]:
        topics = [
            {"name": name, "types": sorted(types)}
            for name, types in self.get_topic_names_and_types()
        ]
        actions = [
            {"name": name, "types": sorted(types)}
            for name, types in get_action_names_and_types(self)
        ]
        self.collect_controller_responses()
        return {
            "rosAvailable": True,
            "rosDistro": os.environ.get("ROS_DISTRO"),
            "rmwImplementation": get_rmw_implementation_identifier(),
            "rosDomainId": os.environ.get("ROS_DOMAIN_ID", "0"),
            "jointStateSources": [
                {
                    "name": topic["name"],
                    "types": topic["types"],
                    "publishers": self.publishers(topic["name"]),
                    "sample": self.samples.get(topic["name"]),
                }
                for topic in topics
                if "sensor_msgs/msg/JointState" in topic["types"]
            ],
            "trajectoryActionServers": [
                {
                    **action,
                    "servers": self.action_servers(action["name"]),
                }
                for action in actions
                if "control_msgs/action/FollowJointTrajectory" in action["types"]
            ],
            "nodes": sorted(
                [
                    {"name": name, "namespace": namespace}
                    for name, namespace in self.get_node_names_and_namespaces()
                ],
                key=lambda node: (node["namespace"], node["name"]),
            ),
            "services": [
                {"name": name, "types": sorted(types)}
                for name, types in self.get_service_names_and_types()
            ],
            "controllerManagers": sorted(
                self.controller_managers.values(),
                key=lambda manager: manager["serviceName"],
            ),
            "robotDescriptions": [
                {
                    "topic": topic,
                    "publishers": self.publishers(topic),
                    "xml": xml,
                }
                for topic, xml in sorted(self.robot_descriptions.items())
            ],
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
    parser.add_argument("--joint-order-json")
    args = parser.parse_args()
    args.joint_order = (
        json.loads(args.joint_order_json) if args.joint_order_json else None
    )
    if args.joint_order is not None and (
        not isinstance(args.joint_order, list)
        or not args.joint_order
        or not all(isinstance(name, str) and name for name in args.joint_order)
        or len(set(args.joint_order)) != len(args.joint_order)
    ):
        parser.error("--joint-order-json must be a non-empty unique string array")
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
        warmup_deadline = (
            datetime.now(timezone.utc).timestamp()
            + min(2.0, args.discovery_timeout_seconds / 2)
        )
        while datetime.now(timezone.utc).timestamp() < warmup_deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
        node.subscribe_graph_sources()

        # Fast DDS endpoint matching is asynchronous for this new participant.
        # Do not spend the JointState sample budget before its subscriptions
        # have actually matched their already-discovered publishers.
        matching_deadline = (
            datetime.now(timezone.utc).timestamp()
            + args.discovery_timeout_seconds
        )
        while datetime.now(timezone.utc).timestamp() < matching_deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
            # Graph endpoints can appear after the fixed warmup. Refresh
            # idempotently so a late JointState publisher receives a reader
            # and its own full bounded DDS matching/sample window.
            node.subscribe_graph_sources()
            node.start_ready_controller_requests()
            if (
                node.joint_sources_matched()
                and node.controller_services_matched()
            ):
                break

        sample_deadline = (
            datetime.now(timezone.utc).timestamp()
            + args.discovery_timeout_seconds
        )
        while (
            node.joint_sources_matched()
            and datetime.now(timezone.utc).timestamp() < sample_deadline
        ):
            rclpy.spin_once(node, timeout_sec=0.1)
            report = node.report()
            sources = report["jointStateSources"]
            if (
                sources
                and all(source["sample"] for source in sources)
                and report["trajectoryActionServers"]
                and node.auxiliary_discovery_complete()
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
