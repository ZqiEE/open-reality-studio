#!/usr/bin/env python3
"""Bounded live ROS observer for the Husarion Gazebo acceptance workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalized_namespace(value: str) -> str:
    parts = [part for part in value.strip().split("/") if part]
    if any(not all(character.isalnum() or character in "_-" for character in part) for part in parts):
        raise ValueError("namespace_invalid")
    return "/".join(parts)


def resolved_topic(namespace: str, topic: str) -> str:
    return f"/{namespace}/{topic}" if namespace else f"/{topic}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ready-file", required=True)
    parser.add_argument("--stop-file", required=True)
    parser.add_argument("--namespace", default="")
    args = parser.parse_args()
    if not math.isfinite(args.duration) or args.duration < 1 or args.duration > 600:
        raise ValueError("duration_out_of_range")
    namespace = normalized_namespace(args.namespace)
    command_topic = resolved_topic(namespace, "cmd_vel")
    odometry_topic = resolved_topic(namespace, "odometry/filtered")
    mux_source_topic = resolved_topic(namespace, "twist_mux_controller/source")
    stop_file = Path(args.stop_file)
    if stop_file.exists():
        raise ValueError("stop_file_must_not_exist_before_arm")

    rclpy.init()
    node = rclpy.create_node("rlsok_husarion_acceptance_monitor")
    commands: list[dict[str, object]] = []
    odometry: list[dict[str, float]] = []
    sources: list[str] = []
    rlsok_publishers: set[str] = set()

    node.create_subscription(
        TwistStamped,
        command_topic,
        lambda message: commands.append({
            "linearX": message.twist.linear.x,
            "angularZ": message.twist.angular.z,
            "frameId": message.header.frame_id,
        }),
        QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE),
    )
    node.create_subscription(
        Odometry,
        odometry_topic,
        lambda message: odometry.append({
            "x": message.pose.pose.position.x,
            "y": message.pose.pose.position.y,
            "linearX": message.twist.twist.linear.x,
            "angularZ": message.twist.twist.angular.z,
        }),
        QoSProfile(depth=100, reliability=ReliabilityPolicy.BEST_EFFORT),
    )
    node.create_subscription(
        String,
        mux_source_topic,
        lambda message: sources.append(message.data),
        QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        ),
    )

    started_at = utc_now()
    Path(args.ready_file).write_text(
        json.dumps({
            "schema": "rlsok.io/husarion-observer-ready/v1",
            "armedAt": started_at,
            "namespace": namespace,
            "resolvedTopics": {
                "command": command_topic,
                "odometry": odometry_topic,
                "muxSource": mux_source_topic,
            },
        }, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    deadline = time.monotonic() + args.duration
    termination_reason = "timeout"
    try:
        while rclpy.ok() and time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.02)
            for endpoint in node.get_publishers_info_by_topic(command_topic):
                if endpoint.node_name == "rlsok_husarion_rosbot_gateway":
                    endpoint_namespace = endpoint.node_namespace.rstrip("/")
                    rlsok_publishers.add(f"{endpoint_namespace}/{endpoint.node_name}")
            if stop_file.exists():
                termination_reason = "stop_requested"
                break
    finally:
        node.destroy_node()
        rclpy.shutdown()

    displacement = 0.0
    if odometry:
        origin = odometry[0]
        displacement = max(
            math.hypot(sample["x"] - origin["x"], sample["y"] - origin["y"])
            for sample in odometry
        )
    result = {
        "schema": "rlsok.io/husarion-command-observer/v1",
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "terminationReason": termination_reason,
        "observerCompleted": termination_reason == "stop_requested",
        "namespace": normalized_namespace(args.namespace),
        "resolvedTopics": {
            "command": command_topic,
            "odometry": odometry_topic,
            "muxSource": mux_source_topic,
        },
        "commandSubscriptionReliability": "reliable",
        "commandCount": len(commands),
        "commands": commands,
        "odometryCount": len(odometry),
        "maxDisplacementMeters": displacement,
        "maxLinearSpeed": max((abs(sample["linearX"]) for sample in odometry), default=0.0),
        "maxAngularSpeed": max((abs(sample["angularZ"]) for sample in odometry), default=0.0),
        "muxSources": sources,
        "rlsokPublisherNodes": sorted(rlsok_publishers),
    }
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, separators=(",", ":")))
    return 0 if termination_reason == "stop_requested" else 2


if __name__ == "__main__":
    raise SystemExit(main())
