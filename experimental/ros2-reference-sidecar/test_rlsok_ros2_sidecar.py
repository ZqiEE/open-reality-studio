import importlib.util
import pathlib
import types
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("rlsok_ros2_sidecar.py")
SPEC = importlib.util.spec_from_file_location("rlsok_ros2_sidecar_under_test", MODULE_PATH)
SIDECAR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIDECAR)
SIDECAR.GoalStatus = types.SimpleNamespace(
    STATUS_UNKNOWN=0,
    STATUS_EXECUTING=2,
    STATUS_SUCCEEDED=4,
    STATUS_CANCELED=5,
    STATUS_ABORTED=6,
)


class FakeGoal:
    def __init__(self):
        self.trajectory = types.SimpleNamespace(joint_names=[], points=[])


SIDECAR.FollowJointTrajectory = types.SimpleNamespace(
    Goal=FakeGoal, Result=types.SimpleNamespace(SUCCESSFUL=0)
)
SIDECAR.Duration = lambda **fields: types.SimpleNamespace(**fields)
SIDECAR.JointTrajectoryPoint = lambda: types.SimpleNamespace()


class ControllerSuccessClassificationTests(unittest.TestCase):
    def test_requires_both_succeeded_status_and_successful_result_code(self):
        self.assertEqual(
            SIDECAR.classify_controller_result(4, 0),
            {
                "completed": True,
                "succeeded": True,
                "detail": "controller_succeeded",
            },
        )
        for status, error_code in [(4, 1), (5, 0), (6, 0)]:
            with self.subTest(status=status, error_code=error_code):
                self.assertEqual(
                    SIDECAR.classify_controller_result(status, error_code),
                    {
                        "completed": True,
                        "succeeded": False,
                        "detail": "controller_reported_failure",
                    },
                )


class SidecarFailureAndDiscoveryTests(unittest.TestCase):
    @staticmethod
    def node():
        node = object.__new__(SIDECAR.DiscoveryNode)
        node.discovery_errors = []
        node.discovery_error_keys = set()
        node.discovery_errors_truncated = False
        return node

    def test_action_query_failure_is_bounded_machine_readable_state(self):
        node = self.node()
        node.get_node_names_and_namespaces = lambda: [("controller", "/cell")]
        original = getattr(SIDECAR, "get_action_server_names_and_types_by_node", None)
        SIDECAR.get_action_server_names_and_types_by_node = (
            lambda *_arguments: (_ for _ in ()).throw(RuntimeError("x" * 1_000))
        )
        try:
            self.assertEqual(node.action_servers("/follow_joint_trajectory"), [])
        finally:
            if original is None:
                del SIDECAR.get_action_server_names_and_types_by_node
            else:
                SIDECAR.get_action_server_names_and_types_by_node = original
        self.assertEqual(len(node.discovery_errors), 1)
        self.assertEqual(node.discovery_errors[0]["operation"], "action_server_query")
        self.assertEqual(len(node.discovery_errors[0]["detail"]), 512)

        for index in range(SIDECAR.MAX_DISCOVERY_ERRORS + 10):
            node._record_discovery_error(
                "query", str(index), RuntimeError(f"failure-{index}")
            )
        self.assertEqual(len(node.discovery_errors), SIDECAR.MAX_DISCOVERY_ERRORS)
        self.assertTrue(node.discovery_errors_truncated)

    def test_report_never_exposes_action_endpoint_after_server_query_failure(self):
        node = self.node()
        node.samples = {}
        node.robot_descriptions = {}
        node.controller_managers = {}
        node.controller_futures = {}
        node.get_topic_names_and_types = lambda: []
        node.get_service_names_and_types = lambda: []
        node.get_node_names_and_namespaces = lambda: [("controller", "/cell")]

        original_action_names = getattr(SIDECAR, "get_action_names_and_types", None)
        original_action_servers = getattr(
            SIDECAR, "get_action_server_names_and_types_by_node", None
        )
        SIDECAR.get_action_names_and_types = lambda _node: [
            (
                "/cell/follow_joint_trajectory",
                ["control_msgs/action/FollowJointTrajectory"],
            )
        ]
        SIDECAR.get_action_server_names_and_types_by_node = (
            lambda *_arguments: (_ for _ in ()).throw(RuntimeError("graph failure"))
        )
        original_rmw_identifier = getattr(
            SIDECAR, "get_rmw_implementation_identifier", None
        )
        SIDECAR.get_rmw_implementation_identifier = lambda: "rmw_test"
        try:
            report = node.report()
        finally:
            if original_rmw_identifier is None:
                del SIDECAR.get_rmw_implementation_identifier
            else:
                SIDECAR.get_rmw_implementation_identifier = original_rmw_identifier
            if original_action_names is None:
                del SIDECAR.get_action_names_and_types
            else:
                SIDECAR.get_action_names_and_types = original_action_names
            if original_action_servers is None:
                del SIDECAR.get_action_server_names_and_types_by_node
            else:
                SIDECAR.get_action_server_names_and_types_by_node = (
                    original_action_servers
                )

        self.assertEqual(report["trajectoryActionServers"], [])
        self.assertFalse(report["discoveryComplete"])
        self.assertEqual(
            report["discoveryErrors"][0]["operation"], "action_server_query"
        )

    def test_controller_manager_exception_is_reported_instead_of_crashing(self):
        class FailedFuture:
            @staticmethod
            def done():
                return True

            @staticmethod
            def result():
                raise RuntimeError("manager unavailable")

        node = self.node()
        node.controller_futures = {"/controller_manager/list_controllers": FailedFuture()}
        node.controller_managers = {}
        node.collect_controller_responses()
        self.assertEqual(node.controller_futures, {})
        self.assertEqual(
            node.discovery_errors[0]["operation"], "controller_manager_response"
        )

        node = self.node()
        node.controller_futures = {
            "/controller_manager/list_controllers": types.SimpleNamespace(
                done=lambda: True, result=lambda: None
            )
        }
        node.controller_managers = {}
        node.collect_controller_responses()
        self.assertEqual(
            node.discovery_errors[0]["detail"], "controller_manager_response_missing"
        )

    def test_missing_goal_response_is_unknown_not_rejection(self):
        class CompletedWithoutHandle:
            @staticmethod
            def add_done_callback(callback):
                callback(None)

            @staticmethod
            def result():
                return None

        node = object.__new__(SIDECAR.ReferenceTransportNode)
        node.args = types.SimpleNamespace(discovery_timeout_seconds=1.0)
        node.action_client = types.SimpleNamespace(
            wait_for_server=lambda **_kwargs: True,
            send_goal_async=lambda _goal: CompletedWithoutHandle()
        )
        with self.assertRaisesRegex(RuntimeError, "goal_response_missing"):
            node.dispatch({"action": {"jointNames": ["joint_a"], "points": []}})

    def test_nonterminal_or_unknown_status_remains_outcome_unknown(self):
        for status in [0, 2]:
            with self.subTest(status=status):
                self.assertEqual(
                    SIDECAR.classify_controller_result(status, 0),
                    {
                        "completed": False,
                        "succeeded": False,
                        "detail": "controller_result_status_unknown",
                    },
                )


if __name__ == "__main__":
    unittest.main()
