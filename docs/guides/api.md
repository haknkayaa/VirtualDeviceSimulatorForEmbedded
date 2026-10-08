# Control-plane API and event stream

VDS4E exposes a REST control plane under `/api/v1` and a WebSocket event
stream at `/api/v1/events`.

The control plane is for configuration, inspection and observability. Normal
SPI/I²C/GPIO/UART traffic does **not** use REST; Linux host adapters forward
hardware transactions over the framed Protobuf Unix-socket data plane.

The default development base URL is:

```text
http://127.0.0.1:8080/api/v1
```

## Trust boundary

The server binds to loopback by default and the current control API does not
provide an authentication layer. Do not expose it directly to an untrusted
network. If remote access is required, place it behind access control appropriate
for the environment.

## Endpoint map

### Runtime and health

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | server health plus host CPU/memory/disk/network metrics |
| GET | `/clock` | current simulator virtual time |

### Devices and models

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/devices` | list runtime device instances |
| POST | `/devices` | create a runtime instance from a loaded device template |
| GET | `/devices/{id}` | inspect one runtime device |
| GET | `/device-models` | list loaded device templates |
| GET | `/devices/{id}/commands` | list declared commands for the device model |
| GET | `/devices/{id}/flow` | return the packaged behavior flow, when present |
| GET | `/devices/{id}/registers` | list register metadata and current values |
| POST | `/devices/{id}/registers/{address}` | write a register through the control plane |
| GET | `/devices/{id}/state` | inspect current state-machine state |
| POST | `/devices/{id}/reset` | reset the device |

Create an additional instance from a loaded template:

```shell
curl -sS -X POST http://127.0.0.1:8080/api/v1/devices \
  -H 'content-type: application/json' \
  -d '{
    "template_id": "generic-i2c-register",
    "device_id": "i2c-register-2"
  }' | jq
```

Runtime device IDs must be 1-64 ASCII letters, digits, `.`, `_` or `-`,
and must start with a letter or digit.

Read registers:

```shell
curl -sS \
  http://127.0.0.1:8080/api/v1/devices/generic-i2c-register/registers | jq
```

Write register address `1`:

```shell
curl -sS -X POST \
  http://127.0.0.1:8080/api/v1/devices/generic-i2c-register/registers/1 \
  -H 'content-type: application/json' \
  -d '{"value":127}' | jq
```

A control-plane register write publishes the same typed register-write domain
event used by the observability system.

### Device packages

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/device-packages` | list installed device packages |
| GET | `/device-packages/{id}/image` | fetch the first supported package image asset |
| POST | `/device-packages/import` | validate and install a package supplied as base64-encoded files |

The import body has this shape:

```json
{
  "files": [
    {
      "path": "device-package.yaml",
      "content_base64": "..."
    },
    {
      "path": "model/device.yaml",
      "content_base64": "..."
    }
  ]
}
```

Import rejects unsafe paths, duplicate paths, excessive file counts and
oversized packages. Package contents remain declarative input; the import route
does not load arbitrary executable extensions.

### Host adapters

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/adapters` | list configured host adapters |
| POST | `/adapters` | create an SPI, I²C, GPIO or UART adapter |
| POST | `/adapters/{id}/bindings` | attach a runtime device to an adapter endpoint |
| DELETE | `/adapters/{id}/bindings/{device_id}` | remove a device binding |
| POST | `/adapters/{id}/load` | create/load the Linux-facing endpoint |
| POST | `/adapters/{id}/unload` | stop/unload the endpoint |

Example I²C adapter:

```shell
curl -sS -X POST http://127.0.0.1:8080/api/v1/adapters \
  -H 'content-type: application/json' \
  -d '{
    "id": "i2c90",
    "name": "Tutorial I2C",
    "bus_type": "i2c",
    "bus_number": 90
  }' | jq
```

Bind a device at address `0x48`. The JSON endpoint value is decimal, so
`0x48 == 72`:

```shell
curl -sS -X POST http://127.0.0.1:8080/api/v1/adapters/i2c90/bindings \
  -H 'content-type: application/json' \
  -d '{"device_id":"tutorial-temp-sensor","endpoint":72}' | jq

curl -sS -X POST \
  http://127.0.0.1:8080/api/v1/adapters/i2c90/load | jq
```

Loading CUSE or gpio-sim backed adapters may require operating-system
authorization. UART PTY adapters are unprivileged.

### Scenarios and runs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/scenarios` | list configured scenarios |
| GET | `/scenarios/{id}` | retrieve a scenario document |
| POST | `/scenarios/{id}/run` | start an asynchronous scenario run |
| GET | `/runs/{run_id}` | inspect run status |
| POST | `/runs/{run_id}/cancel` | request cancellation |
| GET | `/runs/{run_id}/result` | retrieve the finished JSON result |
| GET | `/runs/{run_id}/result/junit` | retrieve the finished result as JUnit XML |

A run starts with HTTP `202 Accepted`. Run status is one of:

```text
queued
running
passed
failed
cancelled
timed_out
```

Start a configured scenario:

```shell
curl -sS -X POST \
  'http://127.0.0.1:8080/api/v1/scenarios/mt25ql256-read-jedec-id/run?revision=1' | jq
```

The run endpoint can also accept a scenario JSON document in the request body.
When a body is supplied, its scenario ID must match the path ID.

### Faults

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/faults` | list runtime fault definitions |
| POST | `/faults/{id}/enable` | enable one fault |
| POST | `/faults/{id}/disable` | disable one fault |

Enable/disable succeeds with HTTP `204 No Content`. A fault ID that matches no
device is `404`; an ID that is ambiguous across devices is reported as a
conflict.

### Telemetry

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/telemetry/buses` | 60-second transaction-derived telemetry per runtime device |

Telemetry includes transaction count, in-flight operations, throughput,
wall/virtual latency summaries, error rate and health classification. It is
derived observability data, not authoritative device state.

## Error contract

REST errors use a stable JSON envelope:

```json
{
  "code": "device_not_found",
  "message": "device 'missing' was not found"
}
```

Use `code` for programmatic handling. `message` is intended for diagnosis
and UI display.

Depending on the operation, common status classes include:

- `400 Bad Request`: invalid model/request/value or unsupported adapter bus;
- `403 Forbidden`: adapter operation requires authorization;
- `404 Not Found`: device, package, scenario, run, register or adapter missing;
- `409 Conflict`: duplicate IDs, ambiguous faults or invalid lifecycle state;
- `503 Service Unavailable`: required adapter driver unavailable.

## WebSocket events

Connect to:

```text
ws://127.0.0.1:8080/api/v1/events
```

To replay retained events newer than a known event ID:

```text
ws://127.0.0.1:8080/api/v1/events?after_event_id=1234
```

The server sends JSON arrays containing up to 256 domain events, batching for
up to roughly 20 ms. Each event contains:

- `event_id`: monotonically increasing event ID;
- `event_type`;
- `timestamp_virtual_ns`;
- `timestamp_wall_ns`;
- optional `device_id`;
- optional `scenario_run_id`;
- typed `payload`.

Current event types are:

```text
transaction_started
transaction_completed
register_read
register_write
state_transition
operation_started
operation_completed
fault_triggered
scenario_started
scenario_step_started
scenario_step_completed
scenario_completed
device_reset
signal_changed
```

Example client flow:

```text
connect with after_event_id = last committed event
             ↓
receive replayed retained events
             ↓
continue receiving live batches
             ↓
persist/remember newest successfully processed event_id
```

If the requested cursor is older than the retained replay window, the server
first sends a resynchronization notice:

```json
{
  "resync_required": {
    "after_event_id": 100,
    "resume_event_id": 450
  }
}
```

The next messages resume from the oldest event still available. Clients that
need a complete current view should refresh relevant REST snapshots after a
resync notice.

The socket responds to WebSocket Ping frames with Pong. Other incoming payloads
are ignored; the stream is server-to-client observability, not a transaction
transport.

## API stability

VDS4E is pre-1.0. The `/api/v1` prefix identifies the current control-plane
contract, but incompatible changes can still occur before a stable release.
Keep API changes synchronized with this document, Web client types and server
tests.
