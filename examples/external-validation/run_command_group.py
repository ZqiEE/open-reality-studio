#!/usr/bin/env python3
"""Run one command in a bounded process group and leave no descendants."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time


def signal_group(process: subprocess.Popen[bytes], sent: signal.Signals) -> None:
    try:
        os.killpg(process.pid, sent)
    except ProcessLookupError:
        pass


def drain(
    process: subprocess.Popen[bytes],
    log,
    deadline: float,
    maximum_bytes: int,
) -> tuple[bool, bool, int]:
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    timed_out = False
    overflow = False
    written = 0
    while True:
        if time.monotonic() >= deadline and process.poll() is None:
            timed_out = True
            break
        events = selector.select(timeout=0.05)
        for key, _mask in events:
            data = os.read(key.fileobj.fileno(), 65536)
            if data:
                if written + len(data) > maximum_bytes:
                    remaining = maximum_bytes - written
                    if remaining > 0:
                        log.write(data[:remaining])
                        log.flush()
                        sys.stdout.buffer.write(data[:remaining])
                        sys.stdout.buffer.flush()
                        written += remaining
                    overflow = True
                    break
                log.write(data)
                log.flush()
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
                written += len(data)
            else:
                selector.unregister(key.fileobj)
        if overflow:
            break
        if process.poll() is not None:
            # Descendants may still hold the inherited pipe. Stop reading now;
            # the finally block terminates the entire process group first.
            break
    selector.close()
    return timed_out, overflow, written


def drain_remaining(
    process: subprocess.Popen[bytes],
    log,
    written: int,
    maximum_bytes: int,
) -> bool:
    """Drain bytes already in the pipe after group termination, with a hard bound."""
    assert process.stdout is not None
    descriptor = process.stdout.fileno()
    os.set_blocking(descriptor, False)
    deadline = time.monotonic() + 1.0
    overflow = False
    while time.monotonic() < deadline:
        try:
            data = os.read(descriptor, 65536)
        except BlockingIOError:
            time.sleep(0.01)
            continue
        if not data:
            break
        remaining = maximum_bytes - written
        if len(data) > remaining:
            data = data[:max(0, remaining)]
            overflow = True
        if data:
            log.write(data)
            log.flush()
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            written += len(data)
        if overflow or written >= maximum_bytes:
            break
    return overflow


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    signal_group(process, signal.SIGINT)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        signal_group(process, signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            signal_group(process, signal.SIGKILL)
            process.wait(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", required=True, type=Path)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--timeout-seconds", type=float, required=True)
    parser.add_argument("--max-log-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--case-directory", required=True, type=Path)
    args = parser.parse_args()
    if not 1 <= args.timeout_seconds <= 7200:
        raise ValueError("command_timeout_out_of_range")
    if not 1024 <= args.max_log_bytes <= 32 * 1024 * 1024:
        raise ValueError("max_log_bytes_out_of_range")
    if args.log.exists():
        raise ValueError("command_log_must_not_exist")
    args.log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    environment = os.environ.copy()
    environment["RLSOK_EXTERNAL_CASE_DIR"] = str(args.case_directory)
    descriptor = os.open(args.log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb", buffering=0) as log:
        process = subprocess.Popen(
            ["bash", str(args.command)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=environment,
            start_new_session=True,
        )
        timed_out = False
        overflow = False
        written = 0
        try:
            timed_out, overflow, written = drain(
                process,
                log,
                time.monotonic() + args.timeout_seconds,
                args.max_log_bytes,
            )
            if timed_out or overflow:
                terminate_group(process)
            else:
                process.wait(timeout=2)
        finally:
            # Even a successfully exiting shell may have daemonized children.
            signal_group(process, signal.SIGTERM)
            time.sleep(0.1)
            signal_group(process, signal.SIGKILL)
            if process.stdout is not None:
                overflow = drain_remaining(
                    process,
                    log,
                    written,
                    args.max_log_bytes,
                ) or overflow
                process.stdout.close()
        if overflow:
            return 125
        if timed_out:
            return 124
        return process.returncode if 0 <= process.returncode <= 255 else 128


if __name__ == "__main__":
    raise SystemExit(main())
