# JUnit XML export

VDS4E serializes completed `ScenarioResult` values into deterministic JUnit XML without re-running or changing a scenario. One scenario result becomes one `<testsuite>` and each step becomes one `<testcase>` in execution order.

## Mapping

| VDS4E result | JUnit element |
| --- | --- |
| Passed step | `<testcase/>` |
| Failed assertion | `<testcase><failure type="assertion"/></testcase>` |
| Runtime, transport, timeout, or configuration failure | `<testcase><error type="execution"/></testcase>` |
| Skipped step | `<testcase><skipped/></testcase>` |

Durations are virtual nanoseconds converted exactly to decimal seconds with nine fractional digits. The serializer does not emit wall-clock timestamps, so identical inputs and report metadata produce identical XML.

Properties are emitted in this stable order:

1. `vds4e.scenario_id`
2. `vds4e.run_id`
3. `vds4e.scenario_revision`
4. `vds4e.virtual_duration_ns`

XML is UTF-8. Attribute and text values are escaped, and characters forbidden by XML 1.0 are replaced safely.

## Safe diagnostics

JUnit messages identify the step action and whether the outcome was an assertion or execution failure. Raw SPI responses, device payloads, internal paths, and unrestricted runtime error strings are not copied into the report. The existing JSON result remains unchanged and continues to contain its current diagnostic fields.

## CLI

Run a scenario through the existing deterministic executor and write both formats:

```shell
vds-cli scenario run device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios/01-read-jedec-id.yaml \
  --config config/vds-server.yaml \
  --json-output result.json \
  --junit-output result.xml
```

`--run-id` and `--revision` set report metadata only. Their defaults are `cli` and `1`.

## Control API

For a completed run:

```text
GET /api/v1/runs/{run_id}/result/junit
```

The response uses `application/xml; charset=utf-8`, an attachment filename, and `Cache-Control: no-store`. A run that has not completed returns the existing structured `run_not_complete` conflict response.

The Visual Scenario Editor downloads this artifact from the API. React components do not create or transform XML.

Scenario execution remains owned exclusively by `vds-scenario`; JUnit is a reporting projection over a completed result.
