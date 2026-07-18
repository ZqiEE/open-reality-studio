# MCP Server Plan

This document describes a future agent integration boundary. The current
product is a REAL-first desktop safety runtime for one documented reference rig,
with a separate zero-signal Simulation Lab.

## Future Architecture

```text
LLM / Agent
-> Open Reality MCP Server
-> Device Profile
-> Task DSL
-> Safety Runtime
-> Adapter
-> Device
```

## Role Of The MCP Server

The Open Reality MCP Server should expose device context and protocol tools to an LLM or agent without letting the model directly control hardware.

It should provide:

- available Device Profiles
- Task DSL generation or validation entry points
- Safety Runtime invocation
- adapter discovery metadata
- Lab Report retrieval

## Current Non-goals

- no real MCP transport in the main product path
- no hosted service requirement
- no account system
- no real hardware execution from the main UI
- no API key requirement
- no cloud execution requirement

## Planned Tool Shape

Future MCP tools may include:

- `list_devices`
- `get_device_profile`
- `compile_task_dsl`
- `validate_task_dsl`
- `run_safety_runtime`
- `submit_to_adapter`
- `get_lab_report`

## Safety Boundary

The MCP Server must never expose raw device actuation methods directly to an LLM. Every task must pass through Task DSL and Safety Runtime before an adapter can execute it.
