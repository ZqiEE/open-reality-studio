#!/usr/bin/env python3
"""ROS-only transport for the RLSOK Husarion ROSbot Gazebo reference example."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import re
import select
import sys
import time
from typing import Any


MESSAGE_TYPE = "geometry_msgs/msg/TwistStamped"
ODOMETRY_TYPE = "nav_msgs/msg/Odometry"
COMMAND_TOPIC = "cmd_vel"
STATE_TOPIC = "odometry/filtered"
COMMAND_PATH_STABILITY_SECONDS = 1.0


def normalize_namespace(value: str) -> str:
    normalized = value.strip().strip("/")
    if not normalized:
        return ""
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(/[A-Za-z][A-Za-z0-9_]*)*", normalized):
        raise ValueError("ros_namespace_invalid")
    return normalized


def resolved_topic(namespace: str, logical_topic: str) -> str:
    if logical_topic not in (COMMAND_TOPIC, STATE_TOPIC):
        raise ValueError("rosbot_topic_not_allowed")
    prefix = f"/{normalize_namespace(namespace)}" if normalize_namespace(namespace) else ""
    return f"{prefix}/{logical_topic}"


def validate_action(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "representation", "messageType", "targetTopic", "frameId",
        "linear", "angular", "units"
    }:
        raise ValueError("twist_shape_invalid")
    if value["representation"] != "twist":
        raise ValueError("twist_representation_invalid")
    if value["messageType"] != MESSAGE_TYPE:
        raise ValueError("twist_message_type_invalid")
    if value["targetTopic"] != COMMAND_TOPIC:
        raise ValueError("twist_target_topic_invalid")
    if value["frameId"] != "base_link":
        raise ValueError("twist_frame_invalid")
    if value["units"] != {
        "linear": "meter_per_second",
        "angular": "radian_per_second",
    }:
        raise ValueError("twist_units_invalid")
    if not isinstance(value["linear"], dict) or set(value["linear"]) != {"x"}:
        raise ValueError("twist_linear_shape_invalid")
    if not isinstance(value["angular"], dict) or set(value["angular"]) != {"z"}:
        raise ValueError("twist_angular_shape_invalid")
    for component in (value["linear"]["x"], value["angular"]["z"]):
        if isinstance(component, bool) or not isinstance(component, (int, float)):
            raise ValueError("twist_component_invalid")
        if not math.isfinite(component):
            raise ValueError("twist_component_non_finite")
    return value


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def command_path_ready(node: Any, topic: str) -> bool:
    """Require the intended Husarion mux reader, not an unrelated observer."""
    return any(
        endpoint.node_name == "twist_mux_controller"
        for endpoint in node.get_subscriptions_info_by_topic(topic)
    )


def required_observer_ready(
    node: Any, topic: str, required_observer_node: str | None
) -> bool:
    """Optionally arm an independent acceptance observer before one-shot Run."""
    if required_observer_node is None:
        return True
    return any(
        endpoint.node_name == required_observer_node
        for endpoint in node.get_subscriptions_info_by_topic(topic)
    )


def self_test() -> int:
    assert normalize_namespace("") == ""
    assert normalize_namespace("/robot1/") == "robot1"
    assert resolved_topic("robot1", COMMAND_TOPIC) == "/robot1/cmd_vel"
    validate_action({
        "representation": "twist",
        "messageType": MESSAGE_TYPE,
        "targetTopic": COMMAND_TOPIC,
        "frameId": "base_link",
        "linear": {"x": 0.1},
        "angular": {"z": -0.2},
        "units": {
            "linear": "meter_per_second",
            "angular": "radian_per_second",
        },
    })
    try:
        resolved_topic("", "wheel_command")
        raise AssertionError("unexpected topic accepted")
    except ValueError as error:
        assert str(error) == "rosbot_topic_not_allowed"
    class Endpoint:
        def __init__(self, node_name: str) -> None:
            self.node_name = node_name

    class FakeNode:
        endpoints = [Endpoint("acceptance_monitor")]

        def get_subscriptions_info_by_topic(self, _topic: str) -> list[Endpoint]:
            return self.endpoints

    fake_node = FakeNode()
    assert command_path_ready(fake_node, "/cmd_vel") is False
    assert required_observer_ready(fake_node, "/cmd_vel", None) is True
    assert required_observer_ready(
        fake_node, "/cmd_vel", "acceptance_monitor"
    ) is True
    fake_node.endpoints.append(Endpoint("twist_mux_controller"))
    assert command_path_ready(fake_node, "/cmd_vel") is True
    assert required_observer_ready(fake_node, "/cmd_vel", "missing_monitor") is False
    print("husarion_rosbot_sidecar_self_test_passed")
    return 0


def run(namespace: str, use_sim_time: bool) -> int:
    try:
        import rclpy
        from geometry_msgs.msg import TwistStamped
        from nav_msgs.msg import Odometry
        from rclpy.parameter import Parameter
    except ImportError as error:
        emit({"event": "fatal", "error": f"ros2_import_failed:{error}"})
        return 2

    normalized_namespace = normalize_namespace(namespace)
    node_namespace = f"/{normalized_namespace}" if normalized_namespace else "/"
    rclpy.init(args=None)
    node = rclpy.create_node("rlsok_husarion_rosbot_gateway", namespace=node_namespace)
    if use_sim_time:
        results = node.set_parameters([
            Parameter("use_sim_time", Parameter.Type.BOOL, True)
        ])
        if not results or not results[0].successful:
            raise RuntimeError("rosbot_sim_time_configuration_failed")
    publisher = node.create_publisher(TwistStamped, COMMAND_TOPIC, 10)
    command_published = False
    required_observer_node: str | None = None
    command_topic = resolved_topic(normalized_namespace, COMMAND_TOPIC)

    def on_odometry(message: Any) -> None:
        source_seconds = message.header.stamp.sec + message.header.stamp.nanosec / 1_000_000_000
        state: dict[str, Any] = {
            "topic": STATE_TOPIC,
            "messageType": ODOMETRY_TYPE,
            "linearX": message.twist.twist.linear.x,
            "angularZ": message.twist.twist.angular.z,
            "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        if source_seconds > 0:
            state["sourceTimestamp"] = datetime.fromtimestamp(
                source_seconds, timezone.utc
            ).isoformat().replace("+00:00", "Z")
        emit({"event": "odometry", "state": state})

    node.create_subscription(Odometry, STATE_TOPIC, on_odometry, 10)
    running = True
    try:
        while running and rclpy.ok():
            rclpy.spin_once(node, timeout_sec=0.02)
            readable, _, _ = select.select([sys.stdin], [], [], 0.0)
            if not readable:
                continue
            line = sys.stdin.readline()
            if not line:
                break
            request: Any = None
            try:
                request = json.loads(line)
                request_id = request["id"]
                operation = request["operation"]
                params = request.get("params", {})
                if operation == "ping":
                    result: Any = {
                        "commandTopic": resolved_topic(normalized_namespace, COMMAND_TOPIC),
                        "stateTopic": resolved_topic(normalized_namespace, STATE_TOPIC),
                    }
                elif operation == "wait_command_path":
                    timeout_ms = params.get("timeoutMs")
                    requested_observer = params.get("requiredObserverNode")
                    if (
                        isinstance(timeout_ms, bool)
                        or not isinstance(timeout_ms, int)
                        or timeout_ms < 1
                        or timeout_ms > 120_000
                    ):
                        raise ValueError("command_path_timeout_invalid")
                    if requested_observer is not None and (
                        not isinstance(requested_observer, str)
                        or not requested_observer
                        or len(requested_observer) > 255
                        or not all(
                            character.isalnum() or character in "_-"
                            for character in requested_observer
                        )
                    ):
                        raise ValueError("command_path_observer_invalid")
                    required_observer_node = requested_observer
                    deadline = time.monotonic() + timeout_ms / 1000
                    ready_since = None
                    while time.monotonic() < deadline:
                        rclpy.spin_once(node, timeout_sec=min(0.02, max(0.0, deadline - time.monotonic())))
                        if (
                            command_path_ready(node, command_topic)
                            and required_observer_ready(
                                node, command_topic, required_observer_node
                            )
                        ):
                            if ready_since is None:
                                ready_since = time.monotonic()
                            if time.monotonic() - ready_since >= COMMAND_PATH_STABILITY_SECONDS:
                                break
                        else:
                            ready_since = None
                    stable_ready = (
                        ready_since is not None
                        and command_path_ready(node, command_topic)
                        and required_observer_ready(
                            node, command_topic, required_observer_node
                        )
                        and time.monotonic() - ready_since >= COMMAND_PATH_STABILITY_SECONDS
                    )
                    result = {
                        "ready": stable_ready,
                        "matchedSubscriptionNode": "twist_mux_controller",
                        "matchedObserverNode": required_observer_node,
                    }
                elif operation == "publish":
                    action = validate_action(params.get("action"))
                    message = TwistStamped()
                    message.header.stamp = node.get_clock().now().to_msg()
                    message.header.frame_id = action["frameId"]
                    message.twist.linear.x = float(action["linear"]["x"])
                    message.twist.angular.z = float(action["angular"]["z"])
                    if not command_path_ready(node, command_topic):
                        raise RuntimeError("command_path_unavailable")
                    if not required_observer_ready(
                        node, command_topic, required_observer_node
                    ):
                        raise RuntimeError("command_path_observer_unavailable")
                    publisher.publish(message)
                    command_published = True
                    result = {
                        "published": True,
                        "topic": resolved_topic(normalized_namespace, COMMAND_TOPIC),
                        "messageType": MESSAGE_TYPE,
                    }
                elif operation == "shutdown":
                    # Keep the already-published endpoint alive briefly so graph observers and
                    # the matched mux reader can process the one DDS sample. This is
                    # teardown only: it publishes no command and performs no retry.
                    linger_deadline = time.monotonic() + (0.25 if command_published else 0.0)
                    while rclpy.ok() and time.monotonic() < linger_deadline:
                        rclpy.spin_once(node, timeout_sec=min(
                            0.02, max(0.0, linger_deadline - time.monotonic())
                        ))
                    result = {"closed": True}
                    running = False
                else:
                    raise ValueError("sidecar_operation_unknown")
                emit({"id": request_id, "ok": True, "result": result})
            except Exception as error:  # Transport errors cross the JSONL boundary.
                emit({
                    "id": request.get("id") if isinstance(request, dict) else -1,
                    "ok": False,
                    "error": str(error),
                })
    finally:
        node.destroy_node()
        rclpy.shutdown()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", default="")
    parser.add_argument("--use-sim-time", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    return self_test() if args.self_test else run(args.namespace, args.use_sim_time)


if __name__ == "__main__":
    raise SystemExit(main())
