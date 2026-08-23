#!/usr/bin/env python3
"""Bounded live ROS observer for the Husarion Gazebo acceptance workflow."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ready-file", required=True)
    args = parser.parse_args()
    if not math.isfinite(args.duration) or args.duration < 1 or args.duration > 60:
        raise ValueError("duration_out_of_range")

    rclpy.init()
    node = rclpy.create_node("rlsok_husarion_acceptance_monitor")
    commands: list[dict[str, object]] = []
    odometry: list[dict[str, float]] = []
    sources: list[str] = []
    rlsok_publishers: set[str] = set()

    node.create_subscription(
        TwistStamped,
        "/cmd_vel",
        lambda message: commands.append({
            "linearX": message.twist.linear.x,
            "angularZ": message.twist.angular.z,
            "frameId": message.header.frame_id,
        }),
        QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE),
    )
    node.create_subscription(
        Odometry,
        "/odometry/filtered",
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
        "/twist_mux_controller/source",
        lambda message: sources.append(message.data),
        QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        ),
    )

    Path(args.ready_file).touch()
    deadline = time.monotonic() + args.duration
    try:
        while rclpy.ok() and time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.02)
            for endpoint in node.get_publishers_info_by_topic("/cmd_vel"):
                if endpoint.node_name == "rlsok_husarion_rosbot_gateway":
                    namespace = endpoint.node_namespace.rstrip("/")
                    rlsok_publishers.add(f"{namespace}/{endpoint.node_name}")
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
