#!/usr/bin/env python3
"""Collect a local, read-only ROS 2 Shadow observation (Python 3.10+).

No action client, command publisher, or service request is created. Humble's
graph API counts *server nodes*, not multiple same-name servers inside one node.
This is a graph/file snapshot, not a hardware or remote implementation attestation.

Interface fingerprint v1: SHA-256 of UTF-8 JSON for typeTree, with sorted object
keys, separators (',', ':'), and ensure_ascii=True. Ordered field arrays preserve
wire field order. Goal/Result/Feedback and every nested message definition are
included, including array, sequence and string bounds. Comments, constants,
default values and implementation code are intentionally outside this fingerprint.

Humble API references:
https://github.com/ros2/rclpy/blob/humble/rclpy/rclpy/action/graph.py
https://github.com/ros2/rosidl_runtime_py/blob/humble/rosidl_runtime_py/utilities.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PROFILE_BYTES = 1024 * 1024
MAX_DEFINITIONS = 512
MAX_INTERFACE_FIELDS = 8192
INTERFACE_ALGORITHM = "rosidl-action-fields-tree/v1"
ACTION_TYPE = re.compile(r"[a-z][a-z0-9_]*/action/[A-Z][A-Za-z0-9]*\Z")
ENDPOINT = re.compile(r"/(?:[A-Za-z_][A-Za-z0-9_]*)(?:/[A-Za-z_][A-Za-z0-9_]*)*\Z")
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})\Z")


class CollectionError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require_text(value: Any, label: str, maximum: int = 512) -> str:
    if (not isinstance(value, str) or not value or len(value) > maximum
            or value.strip() != value or re.search(r"[\x00-\x1f]", value)):
        raise CollectionError(f"{label}: expected a bounded, nonempty string without control characters")
    return value


def require_timestamp(value: Any) -> str:
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise CollectionError("json_value requires an observedAt timestamp with a timezone")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CollectionError("invalid observedAt timestamp") from error
    return value  # Keep the export's timestamp, including stale or future values.


def decode_json(data: bytes) -> Any:
    def unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise CollectionError("duplicate JSON object key")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> Any:
        raise CollectionError("non-finite JSON number")

    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_pairs,
                          parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise CollectionError("invalid UTF-8 JSON") from error


def json_pointer(document: Any, pointer: Any) -> str:
    if not isinstance(pointer, str) or (pointer and not pointer.startswith("/")):
        raise CollectionError("json_value requires an RFC 6901 pointer")
    current = document
    for token in pointer.split("/")[1:] if pointer else []:
        if re.search(r"~(?![01])", token):
            raise CollectionError("invalid JSON pointer escape")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and re.fullmatch(r"0|[1-9][0-9]*", token):
            try:
                current = current[int(token)]
            except (IndexError, ValueError) as error:
                raise CollectionError("JSON pointer is missing") from error
        else:
            raise CollectionError("JSON pointer is missing")
    if not isinstance(current, str):
        raise CollectionError("json_value selected value must be a string")
    return require_text(current, "json_value selected value")


def relative_parts(value: Any) -> tuple[str, ...]:
    value = require_text(value, "fact.path", 1024)
    # Portable paths also reject Windows drives, ADS, UNC and separators on POSIX.
    if "\\" in value or ":" in value or "\x00" in value:
        raise CollectionError("fact.path must be a portable relative path")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or PureWindowsPath(value).is_absolute():
        raise CollectionError("fact.path must stay within the profile directory")
    if not candidate.parts or any(part == ".." for part in candidate.parts):
        raise CollectionError("fact.path must stay within the profile directory")
    return candidate.parts


def _is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _checked_path(root: Path, parts: tuple[str, ...]) -> Path:
    current = root
    for part in parts:
        current = current / part
        if _is_link(current.lstat()):
            raise CollectionError("fact path contains a symlink or reparse point")
    try:
        current.resolve(strict=True).relative_to(root)
    except ValueError as error:
        raise CollectionError("fact path escapes the profile directory") from error
    return current


def _windows_descriptor_path(fd: int) -> Path:
    # Verify the actual opened object, closing the Windows path-check/open race.
    import ctypes
    import msvcrt
    from ctypes import wintypes

    get_path = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
    get_path.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    get_path.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_path(msvcrt.get_osfhandle(fd), buffer, len(buffer), 0)
    if not length or length >= len(buffer):
        raise CollectionError("cannot verify opened fact path")
    result = buffer.value
    if result.startswith("\\\\?\\UNC\\"):
        result = "\\\\" + result[8:]
    elif result.startswith("\\\\?\\"):
        result = result[4:]
    return Path(result)


def read_fact_bytes(root: Path, relative: str, limit: int = MAX_FILE_BYTES) -> bytes:
    root = root.resolve(strict=True)
    parts = relative_parts(relative)
    descriptors: list[int] = []
    try:
        checked = _checked_path(root, parts)
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            directory_fd = os.open(root, directory_flags)
            descriptors.append(directory_fd)
            for part in parts[:-1]:
                directory_fd = os.open(part, directory_flags, dir_fd=directory_fd)
                descriptors.append(directory_fd)
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory_fd)
        else:
            fd = os.open(checked, os.O_RDONLY | getattr(os, "O_BINARY", 0))
        descriptors.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise CollectionError("fact path must be a regular file")
        if os.name == "nt":
            opened = _windows_descriptor_path(fd)
            try:
                opened.relative_to(root)
            except ValueError as error:
                raise CollectionError("opened fact path escapes the profile directory") from error
            if opened != checked:
                raise CollectionError("fact path changed during opening")
        elif os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
            raise CollectionError("this platform cannot securely open fact files")
        if before.st_size > limit:
            raise CollectionError(f"fact file exceeds {limit} bytes")
        chunks: list[bytes] = []
        length = 0
        while length <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - length))
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
        if length > limit:
            raise CollectionError(f"fact file exceeds {limit} bytes")
        after = os.fstat(fd)
        if (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev) != (
            after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev
        ):
            raise CollectionError("fact file changed during collection")
        # Also catch a file or directory swapped for a link while reading.
        latest = _checked_path(root, parts).stat()
        if (latest.st_ino, latest.st_dev) != (after.st_ino, after.st_dev):
            raise CollectionError("fact file was replaced during collection")
        return b"".join(chunks)
    except OSError as error:
        raise CollectionError(f"cannot read fact file ({error.__class__.__name__})") from error
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def collect_fact(fact: dict[str, Any], root: Path, now: Callable[[], str]) -> dict[str, Any]:
    fact_id = require_text(fact.get("id"), "fact.id")
    kind = fact.get("kind")
    try:
        data = read_fact_bytes(root, fact.get("path"))
        if kind == "file_sha256":
            value, observed_at = hashlib.sha256(data).hexdigest(), now()
        elif kind == "json_value":
            document = decode_json(data)
            if not isinstance(document, dict):
                raise CollectionError("json_value export must be an object")
            observed_at = require_timestamp(document.get("observedAt"))
            value = json_pointer(document, fact.get("pointer"))
        else:
            raise CollectionError("unsupported fact kind")
        return {"id": fact_id, "kind": kind, "value": value, "observedAt": observed_at}
    except CollectionError as error:
        raise CollectionError(f"fact {fact_id}: {error}") from error


def describe_interface(action_type: str, get_action: Callable, get_message: Callable) -> dict[str, Any]:
    if not isinstance(action_type, str) or not ACTION_TYPE.fullmatch(action_type):
        raise CollectionError("actionType must be package/action/Type")
    definitions: dict[str, Any] = {}
    field_count = 0

    def message(name: str, message_class: Any, depth: int) -> dict[str, str]:
        nonlocal field_count
        if name in definitions:
            return {"kind": "message", "name": name}
        if depth > 64 or len(definitions) >= MAX_DEFINITIONS:
            raise CollectionError("interface definition tree is too large")
        names = list(message_class.get_fields_and_field_types())
        slots = message_class.SLOT_TYPES
        if len(names) != len(slots) or len(set(names)) != len(names):
            raise CollectionError("inconsistent generated ROS field metadata")
        field_count += len(names)
        if field_count > MAX_INTERFACE_FIELDS:
            raise CollectionError("interface contains too many fields")
        definitions[name] = {"fields": []}
        definitions[name]["fields"] = [
            {"name": require_text(field, "interface field"), "type": slot_type(slot, depth + 1)}
            for field, slot in zip(names, slots)
        ]
        return {"kind": "message", "name": name}

    def slot_type(slot: Any, depth: int) -> dict[str, Any]:
        if depth > 64:
            raise CollectionError("interface definition tree is too deep")
        kind = type(slot).__name__
        if kind == "BasicType":
            return {"kind": "primitive", "name": slot.typename}
        if kind == "NamespacedType":
            name = "/".join((*slot.namespaces, slot.name))
            return message(name, get_message(name), depth)
        if kind in ("Array", "BoundedSequence", "UnboundedSequence"):
            result = {"kind": "array" if kind == "Array" else "sequence",
                      "element": slot_type(slot.value_type, depth + 1)}
            if kind == "Array":
                result["size"] = slot.size
            else:
                result["maximumSize"] = slot.maximum_size if kind == "BoundedSequence" else None
            return result
        if kind in ("BoundedString", "UnboundedString", "BoundedWString", "UnboundedWString"):
            return {"kind": "wstring" if "WString" in kind else "string",
                    "maximumSize": slot.maximum_size if kind.startswith("Bounded") else None}
        raise CollectionError(f"unsupported ROS field metadata: {kind}")

    action = get_action(action_type)
    tree = {
        "algorithm": INTERFACE_ALGORITHM,
        "actionType": action_type,
        "components": {component: message(f"{action_type}_{component}", getattr(action, component), 0)
                       for component in ("Goal", "Result", "Feedback")},
        "definitions": definitions,
    }
    encoded = json.dumps(tree, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                         allow_nan=False).encode("utf-8")
    return {"actionType": action_type, "interfaceSha256": hashlib.sha256(encoded).hexdigest(),
            "typeTree": tree}


class RosInterfaces:
    def __init__(self) -> None:
        try:
            from rosidl_runtime_py.utilities import get_action, get_message
        except ImportError as error:
            raise CollectionError("ROS interface runtime unavailable; source ROS 2 and the interface workspace") from error
        self.get_action, self.get_message = get_action, get_message

    def describe(self, action_type: str) -> dict[str, Any]:
        return describe_interface(action_type, self.get_action, self.get_message)


class RosGraphProvider:
    """Only graph inspection; no action clients or remote service calls."""

    def __init__(self, discovery_seconds: float = 3.0) -> None:
        if not math.isfinite(discovery_seconds) or not 0.1 <= discovery_seconds <= 30:
            raise CollectionError("discovery-seconds must be between 0.1 and 30")
        self.discovery_seconds = discovery_seconds
        self.node = None
        self.executor = None

    def __enter__(self) -> RosGraphProvider:
        try:
            import rclpy
            from rclpy.action.graph import get_action_server_names_and_types_by_node
            from rclpy.context import Context
            from rclpy.executors import SingleThreadedExecutor
            from rclpy.utilities import get_rmw_implementation_identifier
        except ImportError as error:
            raise CollectionError("ROS 2 unavailable; source the ROS 2 installation before collecting") from error

        self.rclpy = rclpy
        self.context = Context()
        self.server_query = get_action_server_names_and_types_by_node
        self.rmw_identifier = get_rmw_implementation_identifier
        self.interfaces = RosInterfaces()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node(
                f"rlsok_shadow_observer_{uuid4().hex}", context=self.context,
                use_global_arguments=False, enable_rosout=False, start_parameter_services=False,
            )
            self.executor = SingleThreadedExecutor(context=self.context)
            self.executor.add_node(self.node)
        except Exception:
            self.__exit__()
            raise
        return self

    def __exit__(self, *_exc: Any) -> None:
        try:
            try:
                if self.executor is not None:
                    self.executor.shutdown(timeout_sec=5.0)
            finally:
                if self.node is not None:
                    self.node.destroy_node()
        finally:
            self.context.shutdown()

    def environment(self) -> dict[str, Any]:
        distro = require_text(os.environ.get("ROS_DISTRO"), "actual ROS_DISTRO")
        domain = os.environ.get("ROS_DOMAIN_ID", "0")
        if not re.fullmatch(r"[0-9]{1,10}", domain):
            raise CollectionError("actual ROS_DOMAIN_ID must be a nonnegative integer")
        if not 0 <= int(domain) <= 232:
            raise CollectionError("actual ROS_DOMAIN_ID must be between 0 and 232")
        return {"rosDistro": distro, "rmwImplementation": require_text(
            self.rmw_identifier(), "actual RMW implementation"), "domainId": int(domain)}

    def action_servers(self, endpoints: set[str]) -> dict[str, tuple[str, int]]:
        deadline = time.monotonic() + self.discovery_seconds
        while time.monotonic() < deadline:
            self.executor.spin_once(timeout_sec=min(0.1, max(0.0, deadline - time.monotonic())))
        nodes = self.node.get_node_names_and_namespaces()
        if len(nodes) > 4096 or len(set(nodes)) != len(nodes):
            raise CollectionError("ROS graph node identities are ambiguous or excessive")
        servers: dict[str, list[str]] = {endpoint: [] for endpoint in endpoints}
        for name, namespace in nodes:
            # Any per-node query failure fails collection rather than hiding a server.
            seen: set[str] = set()
            for endpoint, types in self.server_query(self.node, name, namespace):
                if endpoint not in endpoints:
                    continue
                if endpoint in seen or len(types) != 1:
                    raise CollectionError("action server graph has ambiguous types or entries")
                seen.add(endpoint)
                servers[endpoint].append(types[0])
        result: dict[str, tuple[str, int]] = {}
        for endpoint, types in servers.items():
            if len(set(types)) > 1:
                raise CollectionError(f"action endpoint has conflicting types: {endpoint}")
            if types:
                result[endpoint] = (types[0], len(types))
        return result


def validate_profile(profile: Any) -> dict[str, Any]:
    if (not isinstance(profile, dict) or type(profile.get("schemaVersion")) is not int
            or profile["schemaVersion"] != 1 or profile.get("mode") != "shadow"):
        raise CollectionError("profile must be schemaVersion 1, mode shadow")
    require_text(profile.get("id"), "profile.id")
    for key, limit in (("facts", 64), ("paths", 32)):
        entries = profile.get(key)
        if not isinstance(entries, list) or not entries or len(entries) > limit:
            raise CollectionError(f"profile.{key} must have 1 to {limit} entries")
        ids = [require_text(entry.get("id"), f"{key}.id") if isinstance(entry, dict)
               else None for entry in entries]
        if None in ids or len(ids) != len(set(ids)):
            raise CollectionError(f"profile.{key} has invalid or duplicate ids")
    for fact in profile["facts"]:
        relative_parts(fact.get("path"))
        if fact.get("kind") not in ("file_sha256", "json_value"):
            raise CollectionError("unsupported fact kind")
    for path in profile["paths"]:
        if not ENDPOINT.fullmatch(require_text(path.get("endpoint"), "path.endpoint")):
            raise CollectionError("action endpoint must be a fully qualified ROS name")
        if not ACTION_TYPE.fullmatch(require_text(path.get("actionType"), "path.actionType")):
            raise CollectionError("actionType must be package/action/Type")
    if len({path["endpoint"] for path in profile["paths"]}) != len(profile["paths"]):
        raise CollectionError("profile.paths has duplicate endpoints")
    return profile


def collect_observation(profile: dict[str, Any], root: Path, provider: Any,
                        now: Callable[[], str] = utc_now) -> dict[str, Any]:
    validate_profile(profile)
    environment = provider.environment()
    graph = provider.action_servers({path["endpoint"] for path in profile["paths"]})
    graph_observed_at = now()
    paths: list[dict[str, Any]] = []
    for path in profile["paths"]:
        if path["endpoint"] not in graph:
            raise CollectionError(f"action server not observed: {path['id']}")
        actual_type, count = graph[path["endpoint"]]
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise CollectionError(f"invalid action server count: {path['id']}")
        description = provider.interfaces.describe(actual_type)
        paths.append({"id": path["id"], "endpoint": path["endpoint"], "actionType": actual_type,
                      "interfaceSha256": description["interfaceSha256"], "serverCount": count})
    facts = [collect_fact(fact, root, now) for fact in profile["facts"]]
    return {"schemaVersion": 1, "profileId": profile["id"], "observedAt": graph_observed_at,
            "collector": "ros2-read-only/v1", "environment": environment, "facts": facts, "paths": paths}


def write_output(path: Path, observation: dict[str, Any]) -> None:
    if path.is_symlink() or (path.exists() and _is_link(path.lstat())):
        raise CollectionError("output must not be a symlink or reparse point")
    content = (json.dumps(observation, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix=".shadow-observation-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--profile", type=Path)
    operation.add_argument("--describe-interface", metavar="PACKAGE/ACTION/TYPE")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--discovery-seconds", type=float, default=3.0)
    args = parser.parse_args(argv)
    if args.profile is not None and args.output is None:
        parser.error("--profile requires --output")
    if args.describe_interface and args.output is not None:
        parser.error("--describe-interface writes JSON to stdout; omit --output")
    try:
        if args.describe_interface:
            print(json.dumps(RosInterfaces().describe(args.describe_interface), indent=2, sort_keys=True))
            return 0
        profile_path = args.profile.resolve(strict=True)
        profile = validate_profile(decode_json(read_fact_bytes(
            profile_path.parent, profile_path.name, MAX_PROFILE_BYTES)))
        protected = {profile_path}
        protected.update(profile_path.parent.joinpath(*relative_parts(fact["path"])).resolve()
                         for fact in profile["facts"])
        if args.output.resolve() in protected:
            raise CollectionError("output must not overwrite the profile or a fact source")
        with RosGraphProvider(args.discovery_seconds) as provider:
            observation = collect_observation(profile, profile_path.parent, provider)
        write_output(args.output, observation)
        return 0
    except Exception as error:
        # Never emit a success-shaped observation after a missing/failed read.
        print(f"collection_failed: {error.__class__.__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
