#!/usr/bin/env python3
"""Protocol-compatible isolated simulator for the product demo.

This is not DDS and not a physical controller. Real DDS coverage runs in the
combined ROS 2 Jazzy CI job.
"""

import json
import sys
from datetime import datetime, timezone


def send(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def reply(message, result):
    send({"id": message["id"], "ok": True, "result": result})


for line in sys.stdin:
    message = json.loads(line)
    operation = message.get("operation")
    if operation == "ping":
        reply(message, {"pong": True})
    elif operation == "doctor":
        send(
            {
                "event": "joint_state",
                "state": {
                    "names": ["joint_a", "joint_b"],
                    "positions": [0.0, 0.0],
                    "observedAt": datetime.now(timezone.utc).isoformat(),
                },
            }
        )
        reply(
            message,
            {
                "rosAvailable": True,
                "rosDistro": "isolated-protocol-simulator",
                "rmwImplementation": None,
                "rosDomainId": "isolated",
                "proposalTopic": "/rlsok/action_proposals",
                "jointStateTopic": "/joint_states",
                "controllerAction": "/simulated/follow_joint_trajectory",
                "jointStateFresh": True,
                "actionServerAvailable": True,
                "sros2Enabled": False,
                "limitations": [
                    "protocol simulator only",
                    "not DDS",
                    "not physical motion",
                ],
            },
        )
    elif operation == "dispatch":
        reply(message, {"accepted": True, "detail": "simulated_goal_accepted"})
    elif operation == "cancel":
        reply(message, {"requested": True, "detail": "simulated_cancel"})
    elif operation == "shutdown":
        reply(message, {"closed": True})
        break
    else:
        send({"id": message["id"], "ok": False, "error": "unsupported_operation"})
