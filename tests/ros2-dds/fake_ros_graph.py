#!/usr/bin/env python3
"""Real DDS fixture graph for the ROS 2 Jazzy CI job."""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import time

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action import ActionServer
from rclpy.action.server import GoalResponse
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import String


class FixtureGraph(Node):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__("rlsok_dds_fixture")
        self.args = args
        self.started = time.monotonic()
        self.proposal_sent = 0
        self.goal_count = 0
        self.joint_publisher = self.create_publisher(
            JointState, args.joint_state_topic, 10
        )
        self.proposal_publisher = self.create_publisher(
            String, args.proposal_topic, 10
        )
        self.action_server = ActionServer(
            self,
            FollowJointTrajectory,
            args.controller_action,
            execute_callback=self.execute,
            goal_callback=self.goal,
        )
        self.timer = self.create_timer(0.05, self.tick)

    def goal(self, _goal_request):
        self.goal_count += 1
        if self.args.goal_count_file:
            Path(self.args.goal_count_file).write_text(
                str(self.goal_count), encoding="utf-8"
            )
        if self.args.controller_behavior == "reject":
            return GoalResponse.REJECT
        return GoalResponse.ACCEPT

    async def execute(self, goal_handle):
        goal_handle.succeed()
        return FollowJointTrajectory.Result()

    def tick(self) -> None:
        state = JointState()
        state.header.stamp = self.get_clock().now().to_msg()
        state.name = ["joint_a", "joint_b"]
        state.position = [0.0, 0.0]
        self.joint_publisher.publish(state)
        elapsed = time.monotonic() - self.started
        if 1.0 < elapsed < 3.0 and self.proposal_sent < 20:
            proposal = String()
            proposal.data = base64.b64decode(self.args.proposal_base64).decode("utf8")
            self.proposal_publisher.publish(proposal)
            self.proposal_sent += 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proposal-topic", required=True)
    parser.add_argument("--joint-state-topic", required=True)
    parser.add_argument("--controller-action", required=True)
    parser.add_argument("--proposal-base64", required=True)
    parser.add_argument(
        "--controller-behavior", choices=["accept", "reject"], default="accept"
    )
    parser.add_argument("--goal-count-file")
    args = parser.parse_args()
    rclpy.init()
    node = FixtureGraph(args)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
