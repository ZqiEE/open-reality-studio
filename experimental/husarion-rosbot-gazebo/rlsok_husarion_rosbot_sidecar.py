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


def drain_published_command(publisher: Any, duration_factory: Any) -> bool:
    """Bound teardown until every matched reliable reader acknowledges the one command."""
    return bool(publisher.wait_for_all_acked(
        timeout=duration_factory(seconds=1.0)
    ))


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
    class FakePublisher:
        timeout: Any = None

        def wait_for_all_acked(self, *, timeout: Any) -> bool:
            self.timeout = timeout
            return True

    fake_publisher = FakePublisher()
    assert drain_published_command(fake_publisher, lambda **value: value) is True
    assert fake_publisher.timeout == {"seconds": 1.0}
    print("husarion_rosbot_sidecar_self_test_passed")
    return 0


def run(namespace: str, use_sim_time: bool) -> int:
    try:
        import rclpy
        from geometry_msgs.msg import TwistStamped
        from nav_msgs.msg import Odometry
        from rclpy.duration import Duration
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
                    if (
                        isinstance(timeout_ms, bool)
                        or not isinstance(timeout_ms, int)
                        or timeout_ms < 1
                        or timeout_ms > 120_000
                    ):
                        raise ValueError("command_path_timeout_invalid")
                    deadline = time.monotonic() + timeout_ms / 1000
                    while publisher.get_subscription_count() < 1 and time.monotonic() < deadline:
                        rclpy.spin_once(node, timeout_sec=min(0.02, max(0.0, deadline - time.monotonic())))
                    result = {"ready": publisher.get_subscription_count() >= 1}
                elif operation == "publish":
                    action = validate_action(params.get("action"))
                    message = TwistStamped()
                    message.header.stamp = node.get_clock().now().to_msg()
                    message.header.frame_id = action["frameId"]
                    message.twist.linear.x = float(action["linear"]["x"])
                    message.twist.angular.z = float(action["angular"]["z"])
                    if publisher.get_subscription_count() < 1:
                        raise RuntimeError("command_path_unavailable")
                    publisher.publish(message)
                    command_published = True
                    result = {
                        "published": True,
                        "topic": resolved_topic(normalized_namespace, COMMAND_TOPIC),
                        "messageType": MESSAGE_TYPE,
                    }
                elif operation == "shutdown":
                    delivery_acked = (
                        drain_published_command(publisher, Duration)
                        if command_published else True
                    )
                    # Keep the already-published endpoint alive briefly so graph observers and
                    # the matched mux reader can process the one reliable DDS sample. This is
                    # teardown only: it publishes no command and performs no retry.
                    linger_deadline = time.monotonic() + (0.25 if command_published else 0.0)
                    while rclpy.ok() and time.monotonic() < linger_deadline:
                        rclpy.spin_once(node, timeout_sec=min(
                            0.02, max(0.0, linger_deadline - time.monotonic())
                        ))
                    result = {
                        "closed": True,
                        "commandDeliveryAcknowledged": delivery_acked,
                    }
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
