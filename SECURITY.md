# Security Policy

## Supported versions

VDS4E is pre-1.0; only the latest commit on the default branch is supported.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a
vulnerability" feature (Security tab) on
https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded. Do not open
public issues for security problems. Expect an initial response within a
few days.

## Security notes

- The control API binds to loopback by default. Exposing it on a
  non-loopback address gives remote callers control over virtual devices;
  do so only on trusted networks or behind authentication you provide.
- Host adapters (CUSE/FUSE, gpio-sim configfs) need elevated privileges to
  create device nodes. Run them only in development environments.
