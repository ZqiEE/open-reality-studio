#!/usr/bin/env python3
"""Mock JointState publisher and FollowJointTrajectory action server."""

from __future__ import annotations

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action import ActionServer
from rclpy.node import Node
from sensor_msgs.msg import JointState


class MockGraph(Node):
    def __init__(self) -> None:
        super().__init__("rlsok_mock_ros_graph")
        self.goal_count = 0
        self.publisher = self.create_publisher(JointState, "/joint_states", 10)
        self.timer = self.create_timer(0.1, self.publish_state)
        self.server = ActionServer(
            self,
            FollowJointTrajectory,
            "/joint_trajectory_controller/follow_joint_trajectory",
            execute_callback=self.execute_goal,
        )

    def publish_state(self) -> None:
        message = JointState()
        message.header.stamp = self.get_clock().now().to_msg()
        message.name = ["joint_a", "joint_b"]
        message.position = [0.0, 0.0]
        self.publisher.publish(message)

    async def execute_goal(self, goal_handle):
        self.goal_count += 1
        self.get_logger().warning(f"REFERENCE GOAL RECEIVED count={self.goal_count}")
        goal_handle.succeed()
        return FollowJointTrajectory.Result()


def main() -> None:
    rclpy.init()
    node = MockGraph()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
