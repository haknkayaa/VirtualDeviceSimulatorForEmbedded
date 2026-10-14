# Antigravity read-only connectivity probe — 2026-10-14

`command -v agy` returned `/home/ubuntu/.local/bin/agy`.
`agy mcp list` returned:

```text
NAME   TYPE   STATUS   COMMAND/URL
kicad  stdio  enabled  /home/ubuntu/Desktop/PersonelProjects/tools/kicad-mcp/.venv/bin/python /home/ubuntu/Desktop/PersonelProjects/tools/kicad-mcp/main.py
```

A first invocation used `--print-timeout 60`, rejected because a duration suffix is required. Retried:

```text
agy -p 'Read-only task H probe. Do not write files. Call a real read-only KiCad MCP tool to analyze cad/core/bridge-one-core.kicad_sch or get status/version. Report exact tool, arguments, returned result and permission errors. Do not disable permissions.' --output-format json --print-timeout 60s
```

Actual stdout is in `agy-connectivity.json`: status SUCCESS, **empty response**. No actual MCP tool name/arguments/result were returned. Stderr included:

```text
Failed to redirect output for CLI: creating log file: opening log file: open /home/ubuntu/.gemini/antigravity-cli/log/cli-20261014_163607.log: read-only file system
summary store: reconciliation upsert failed: upsert batch chunk [0, 32): attempt to write a readonly database
```

Connectivity is **unverified**; CLI exit/status is not evidence of a successful MCP call. No permissions were disabled and no MCP mutation was requested. Sandbox escalation is unavailable in this session. Native Python generation and native `kicad-cli` were used instead; this is not claimed as MCP success.
