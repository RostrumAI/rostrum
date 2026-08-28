# E2-05: Build the local daemon

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-S2](e2-s2-select-local-daemon-transport.md), [E2-01](e2-01-clarify-workflow-interface-terminology.md), [E2-02](e2-02-establish-task-tracking.md) |

## Task

This task builds the daemon, a background process that runs independently on the local machine. It adds:

- the transport selected by E2-S2, the communication mechanism used between independently running processes;
- validated configuration;
- structured logging;
- health and version operations;
- startup and graceful shutdown;
- extension points for execution services and shutdown handling;
- an integration test setup that starts the real process.

This task establishes only the process boundary: the separation between the daemon process and the Control API, the API through which clients control workflow-related operations. Workflow execution enters the daemon in E2-07.

## End state

A developer can start the daemon independently of the Control API, verify its configuration and health through the selected transport, and stop it cleanly.

## Why

The daemon must own workflow execution after the invoking client disconnects. Building and testing the process boundary before the execution engine keeps graph logic out of the Control API.

## Blocks

- [E2-07: Execute sequential and conditional workflows](e2-07-execute-sequential-and-conditional-workflows.md)

## Acceptance criteria

- Documented commands build, start, inspect, stop, and test the daemon.
- The daemon reports health and version independently of the Control API.
- The daemon rejects invalid configuration before accepting requests and returns an actionable error.
- The transport supports correlated requests, meaning requests matched with their corresponding responses, between independently running processes.
- Graceful shutdown stops accepting new requests, invokes registered shutdown handlers, and ends cleanly.
- Integration tests exercise the real process and the selected E2-S2 transport without requiring workflow execution.
