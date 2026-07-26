# ROS 2 ReleaseGate reference demo

This demo exercises the live ROS graph in Shadow Mode before any reference
execution. It is experimental, not safety-rated, and not hard realtime.

Prerequisites: ROS 2 Jazzy, `control_msgs`, Node.js 22+, and the repository
dependencies.

Terminal 1:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
python3 examples/ros2-releasegate-demo/mock_ros_graph.py
```

Terminal 2:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
npm run rlsok -- ros2 shadow \
  --release examples/ros2-releasegate-demo/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/demo-shadow.json
```

Terminal 3:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
ros2 topic pub --once /rlsok/action_proposals std_msgs/msg/String \
  "{data: '$(tr -d '\n' < examples/ros2-releasegate-demo/proposal.json)'}"
```

Expected: an allowed Shadow observation, `hardwareSignalSent: false`,
`controllerGoalCount: 0`, and the mock action server reports zero goals.
Then alter the release ID, joint order, proposer, and timestamp to observe
fail-closed results.

The included mock server accepts goals only for integration observation. Do
not treat it as a controller or safety test.
