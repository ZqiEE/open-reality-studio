#!/usr/bin/env python3
"""Protocol-compatible isolated simulator for the product demo.

This is not DDS and not a physical controller. Real DDS coverage runs in the
combined ROS 2 Jazzy CI job.
"""

import json
import argparse
import os
import sys
import threading
from datetime import datetime, timezone


output_lock = threading.Lock()


def send(value):
    with output_lock:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def reply(message, result):
    send({"id": message["id"], "ok": True, "result": result})


parser = argparse.ArgumentParser()
parser.add_argument("--proposal-topic", default="/rlsok/action_proposals")
parser.add_argument("--joint-state-topic", default="/joint_states")
parser.add_argument(
    "--controller-action",
    default="/joint_trajectory_controller/follow_joint_trajectory",
)
parser.add_argument("--joint-order-json", default='["joint_a","joint_b"]')
parser.add_argument("--discovery-timeout-seconds")
args = parser.parse_args()
joint_order = json.loads(args.joint_order_json)


def joint_state_event():
    return {
        "event": "joint_state",
        "state": {
            "names": joint_order,
            "positions": [0.0 for _ in joint_order],
            "observedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


stop_publisher = threading.Event()


def publish_joint_state():
    while not stop_publisher.wait(0.1):
        send(joint_state_event())


threading.Thread(target=publish_joint_state, daemon=True).start()


for line in sys.stdin:
    message = json.loads(line)
    operation = message.get("operation")
    if operation == "ping":
        reply(message, {"pong": True})
    elif operation == "doctor":
        send(joint_state_event())
        reply(
            message,
            {
                "rosAvailable": True,
                "rosDistro": os.environ.get("ROS_DISTRO"),
                "rmwImplementation": os.environ.get("RMW_IMPLEMENTATION"),
                "rosDomainId": "isolated",
                "proposalTopic": args.proposal_topic,
                "jointStateTopic": args.joint_state_topic,
                "controllerAction": args.controller_action,
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
    elif operation == "shutdown":
        stop_publisher.set()
        reply(message, {"closed": True})
        break
    else:
        send({"id": message["id"], "ok": False, "error": "unsupported_operation"})
