"""Minimal policy-side proposal surface for RLSOK.

The SDK publishes proposals only. Release identity, evaluation, and controller
authority remain in the separately running RLSOK gate.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

__all__ = ["ProposalClient", "propose"]


def _config_path() -> Path:
    explicit = os.environ.get("RLSOK_SETUP_CONFIG")
    if explicit:
        return Path(explicit)
    root = os.environ.get("RLSOK_CONFIG_HOME")
    if root:
        return Path(root) / "setup.json"
    xdg = os.environ.get("XDG_CONFIG_HOME")
    return (Path(xdg) / "rlsok" if xdg else Path.home() / ".config" / "rlsok") / "setup.json"


def _load_config(path: Path | None = None) -> dict[str, Any]:
    source = path or _config_path()
    try:
        value = json.loads(source.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError("No completed RLSOK setup was found. Run 'rlsok setup' first.") from error
    required = ("version", "releaseId", "deviceId", "jointNames", "proposalTopic", "proposerIdentity")
    if value.get("version") != 2 or any(not value.get(key) for key in required):
        raise RuntimeError("The saved RLSOK setup is incompatible. Run 'rlsok setup' again.")
    return value


def _positions(action: Any, joint_names: list[str]) -> tuple[list[float], list[float] | None, int]:
    if hasattr(action, "joint_names") and hasattr(action, "points"):
        if list(action.joint_names) != joint_names:
            raise ValueError("JointTrajectory joint_names must exactly match the RLSOK setup order.")
        if len(action.points) != 1:
            raise ValueError("This proposal surface accepts exactly one trajectory point per proposal.")
        point = action.points[0]
        duration = getattr(point, "time_from_start", None)
        milliseconds = int(getattr(duration, "sec", 0) * 1000 + getattr(duration, "nanosec", 0) / 1_000_000)
        return list(point.positions), list(point.velocities) or None, milliseconds or 1000
    if isinstance(action, Mapping):
        unknown = set(action) - set(joint_names)
        missing = set(joint_names) - set(action)
        if unknown or missing:
            raise ValueError(f"Action joints must exactly match setup; missing={sorted(missing)}, unknown={sorted(unknown)}")
        return [float(action[name]) for name in joint_names], None, 1000
    if isinstance(action, Sequence) and not isinstance(action, (str, bytes, bytearray)):
        return [float(value) for value in action], None, 1000
    raise TypeError("action must be a JointTrajectory, joint-to-position mapping, or position sequence")


def _build_envelope(action: Any, config: Mapping[str, Any]) -> dict[str, Any]:
    joint_names = list(config["jointNames"])
    positions, velocities, milliseconds = _positions(action, joint_names)
    if len(positions) != len(joint_names):
        raise ValueError(f"Expected {len(joint_names)} joint positions, received {len(positions)}.")
    point: dict[str, Any] = {"positions": positions, "timeFromStartMs": milliseconds}
    if velocities is not None:
        if len(velocities) != len(joint_names):
            raise ValueError("Velocity dimension does not match the configured joint order.")
        point["velocities"] = velocities
    return {
        "proposalId": f"sdk-{uuid.uuid4()}",
        "releaseId": config["releaseId"],
        "deviceId": config["deviceId"],
        "proposerIdentity": config["proposerIdentity"],
        "actionRepresentation": "trajectory",
        "actionPayload": {
            "representation": "trajectory",
            "jointNames": joint_names,
            "points": [point],
            "units": {"position": "radian", "velocity": "radian_per_second"},
        },
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


class ProposalClient:
    """Publish policy proposals to the boundary saved by ``rlsok setup``."""

    def __init__(self, config_path: str | Path | None = None) -> None:
        self.config = _load_config(Path(config_path) if config_path else None)
        try:
            import rclpy
            from rclpy.node import Node
            from std_msgs.msg import String
        except ImportError as error:
            raise RuntimeError("ROS 2 Jazzy Python packages are unavailable. Source /opt/ros/jazzy/setup.bash.") from error
        self._rclpy = rclpy
        self._string = String
        if not rclpy.ok():
            rclpy.init(args=None)
        self._node = Node(f"rlsok_policy_{os.getpid()}")
        self._publisher = self._node.create_publisher(String, self.config["proposalTopic"], 10)

    def propose(self, action: Any) -> str:
        envelope = _build_envelope(action, self.config)
        message = self._string()
        message.data = json.dumps(envelope, separators=(",", ":"))
        self._publisher.publish(message)
        self._rclpy.spin_once(self._node, timeout_sec=0.05)
        return str(envelope["proposalId"])

    def close(self) -> None:
        self._node.destroy_node()


_default_client: ProposalClient | None = None


def propose(action: Any) -> str:
    """Publish one proposal using the robot boundary saved by ``rlsok setup``."""
    global _default_client
    if _default_client is None:
        _default_client = ProposalClient()
    return _default_client.propose(action)
