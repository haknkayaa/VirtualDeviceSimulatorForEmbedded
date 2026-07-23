# 0004: Create runtime device instances from configured models

- Status: Accepted
- Date: 2026-07-23

## Context

The device library and the runtime device inventory represent different
lifecycle concepts. A model package is installed once, while several
independent runtime devices may be created from the same model. Redirecting an
`Add Device` action to the library conflates package installation with device
instantiation.

The original registry was populated only during server startup. That prevented
the control plane from creating a second instance of an already configured
model without restarting the server or duplicating model files.

## Decision

Configured declarative device models are also exposed as immutable runtime
templates. The control plane may create an in-memory device instance by
selecting one template and supplying a unique device ID.

`vds-core::DeviceRegistry` supports synchronized runtime registration. The
server owns template loading and device construction because it already owns
configuration and the shared simulator clock.

The v1 endpoints are:

- `GET /api/v1/device-models`
- `POST /api/v1/devices`

Creation is a control-plane operation only. Hardware transactions continue to
use the Unix socket and Protobuf data plane. New instances share the server
clock, own independent register, memory, state-machine, scheduler, and fault
state, and exist until server restart.

Bus topology properties such as chip-select and I2C address are not accepted
until the runtime has a topology model that can enforce them.

## Alternatives

- Redirect to Device Library: rejected because packages and instances have
  different lifecycles.
- Clone current mutable device state: rejected because a new instance must
  start from the declarative model reset state.
- Persist generated YAML automatically: rejected because persistence,
  workspace ownership, and package-lock semantics are not implemented.
- Add REST hardware transactions: rejected because it violates the
  control-plane/data-plane boundary.

## Consequences

- Several independent runtime devices can use one configured model.
- Device IDs must be unique and validated.
- Runtime-created instances are intentionally ephemeral in v1.
- The UI must communicate that restart removes ephemeral instances.
- Scenario runs that rebuild isolated registries from server configuration do
  not automatically include ephemeral instances; persistent project topology
  remains future work.

## Migration impact

Existing configuration, device-model YAML, Unix socket framing, Protobuf field
numbers, and startup-loaded devices are unchanged. The REST endpoints are
additive.
