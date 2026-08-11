import json
import tempfile
import unittest
from pathlib import Path

from rlsok import _build_envelope, _load_config


JOINTS = [
    "shoulder_pan_joint",
    "shoulder_lift_joint",
    "elbow_joint",
    "wrist_1_joint",
    "wrist_2_joint",
    "wrist_3_joint",
]


class ProposalSdkTest(unittest.TestCase):
    def config(self):
        return {
            "version": 2,
            "releaseId": "release-a",
            "deviceId": "ur5e-a",
            "jointNames": JOINTS,
            "proposalTopic": "/rlsok/action_proposals",
            "proposerIdentity": "policy-abc",
        }

    def test_mapping_is_canonicalized_without_ros_names(self):
        values = {name: index / 10 for index, name in reversed(list(enumerate(JOINTS)))}
        envelope = _build_envelope(values, self.config())
        self.assertEqual(envelope["actionPayload"]["jointNames"], JOINTS)
        self.assertEqual(envelope["actionPayload"]["points"][0]["positions"], [0, .1, .2, .3, .4, .5])

    def test_wrong_dimension_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Expected 6"):
            _build_envelope([0, 1], self.config())

    def test_setup_v2_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "setup.json"
            path.write_text(json.dumps({"version": 1}), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "incompatible"):
                _load_config(path)


if __name__ == "__main__":
    unittest.main()
