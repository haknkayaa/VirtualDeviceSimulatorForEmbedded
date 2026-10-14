# Task H — grouped KiCad 10 schematic generation

Completed 2026-10-14. **Recommendation: a small direct S-expression emitter using real system-library symbols, followed by native KiCad 10 format upgrade and review.** The two-block POC passes native ERC and exports to PDF. This is tooling evidence, not the revision F schematic or electrical approval.

Evidence labels: **VERIFIED** = primary source/artifact actually read; **DOCUMENTED-BUT-UNMEASURED** = documented hardware behavior without bench evidence; **ASSUMPTION** = proposal or capability not exercised. Software observations are not bench measurements.

**VERIFIED — baseline read:** [AGENTS.md](../AGENTS.md), [README revision F](../README.md#revision-f-placement-2026-10-14), [architecture](../docs/architecture.md), [Pi header](../docs/pi-header-pinout.md), [placement](../cad/preview/placement.json). The task's rev F FPGA/S3 split is the baseline; older MCU-only SPI text in the architecture draft needs reconciliation during full capture. Neither existing placement nor this POC is a finished Bridge One schematic. No sourcing or purchasing was performed; supplier URLs/stock observations are not applicable to this tooling task.

## Options and decision

Each **VERIFIED** documentation entry below means the implementation/documentation was read; it does not imply every feature was locally exercised.

| Approach | KiCad 10 / real symbol geometry | Wires, labels, grouped annotations | Hierarchy | Decision |
|---|---|---|---|---|
| `kicad-sch-api` | **VERIFIED:** README advertises 7/8; actual installed 0.5.6 emits format `20250114`, generator 9.0. Real library pins were imported in this trial. [README](https://github.com/circuit-synth/kicad-sch-api), [trial](../cad/poc/api-trial.kicad_sch). | **VERIFIED:** APIs exist for wires, global labels, rectangles, text and text boxes. In this trial `add_global_label()` calls disappeared on save: zero saved global labels, 38 native ERC violations. Rectangles/text boxes did render. [API reference](https://github.com/circuit-synth/kicad-sch-api/blob/main/docs/API_REFERENCE.md), [trial code](../cad/poc/api-trial.py), [ERC](../cad/poc/api-trial-erc.rpt). | **VERIFIED:** hierarchical sheets/labels and hierarchy traversal documented; **ASSUMPTION:** KiCad 10 round-trip works, not exercised. [Hierarchy guide](https://github.com/circuit-synth/kicad-sch-api/blob/main/docs/HIERARCHY_FEATURES.md). | Do not use unpatched 0.5.6 as the connectivity authority. |
| SKiDL | **VERIFIED:** release 2.3.0 explicitly adds `KICAD10`; this is no longer just a netlist generator. Editable schematics for 6–10 are documented. Its schematic backend carries library drawing/pin data. **ASSUMPTION:** our exact symbols/10.0.6 round-trip, not run. [Package/release history](https://pypi.org/project/skidl/), [backend source](https://github.com/devbisme/skidl/blob/master/src/skidl/tools/kicad9/sexp_schematic.py). | **VERIFIED:** placement/routing and global-label generation exist. **ASSUMPTION:** arbitrary titled rectangle/text-box placement would need a custom annotation pass; no verified turnkey grouped-box API established. [KiCad 10 generator](https://github.com/devbisme/skidl/blob/master/src/skidl/tools/kicad10/gen_schematic.py). | **VERIFIED:** hierarchy is propagated to generated schematics. [SKiDL](https://github.com/devbisme/skidl). | Strong alternative for circuit-as-code topology; less direct control for this fixed visual layout. |
| `circuit-synth` | **VERIFIED:** generates KiCad projects, uses `kicad-sch-api`, and documents library-symbol/footprint checks. **ASSUMPTION:** KiCad 10 compatibility for this design, not exercised. [Project](https://github.com/circuit-synth/circuit-synth). | **VERIFIED:** Python components/nets and CLI-backed PDF export documented. **ASSUMPTION:** exact box/note layout needs explicit lower-level annotation rather than relying on automatic placement. [README](https://github.com/circuit-synth/circuit-synth/blob/main/README.md). | **VERIFIED:** modular subcircuits/hierarchical design documented. [Project](https://github.com/circuit-synth/circuit-synth). | Too much framework for this POC; current package requires Python >=3.12, outside provided 3.10. [Metadata](https://pypi.org/pypi/circuit-synth/json). |
| KiCad IPC / `kipy` (`kicad-python`) | **VERIFIED:** KiCad 9/10 IPC plugins are PCB-editor-only; schematic support begins in 11. Version 10 also requires a running GUI and lacks IPC plot/export support. [Official API limitations](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-addon-developers/). | No supported KiCad 10 schematic-authoring path through this API. | No supported KiCad 10 schematic-authoring path. | Reject for this pinned version. |
| Direct S-expressions | **VERIFIED:** native schema represents embedded symbols, wires, labels, sheets and instance paths; common syntax defines graphics/text. Local POC copies library geometry, emits rectangles/text boxes and global labels, then upgrades through 10.0.6. [Schematic format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/), [common format](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/), [generator](../cad/poc/generate.py). | **VERIFIED:** exercised in final POC, including PDF rendering and netlist connectivity. | **VERIFIED:** sheet/pin/path syntax documented; **ASSUMPTION:** proposed full-design hierarchy, not exercised here. [Format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/). | Selected: explicit layout and smallest final dependency surface. |

**VERIFIED — maintenance snapshot, not a support guarantee:** publisher metadata fetched on 2026-10-14 reports `kicad-sch-api` 0.5.6 (2025-11-19, Python >=3.10), SKiDL 2.3.0 (2026-07-28, >=3.6), `circuit-synth` 0.12.1 (2026-01-09, >=3.12), and `kicad-python` 0.8.0 (2026-08-30, >=3.9). These are the current published releases observed, not claims of abandonment or future support. Sources: [API metadata](https://pypi.org/pypi/kicad-sch-api/json), [SKiDL metadata](https://pypi.org/pypi/skidl/json), [circuit-synth metadata](https://pypi.org/pypi/circuit-synth/json), [kipy metadata](https://pypi.org/pypi/kicad-python/json); captured subset: [package-metadata.json](../cad/poc/package-metadata.json). Direct generation makes schema compatibility our maintenance responsibility (**ASSUMPTION**, engineering assessment).

## POC and actual command output

**VERIFIED — artifacts:** [grouped.kicad_sch](../cad/poc/grouped.kicad_sch), [PDF](../cad/poc/grouped.pdf), [generator](../cad/poc/generate.py), [ERC report](../cad/poc/erc.rpt), [exported netlist](../cad/poc/grouped.net.xml). Two titled rectangles each contain a note text box: USB-C with two CC resistors; LDO with two capacitors. Global labels connect their power nets. Two `PWR_FLAG` symbols declare external input/return for ERC; they are not physical protection components. Six unused USB data/SBU pins have explicit NCs. Source: generated schematic and exported netlist linked above.

**VERIFIED — symbol provenance:** `Connector:USB_C_Receptacle_USB2.0_16P`, `Device:R`, `Device:C`, `Regulator_Linear:AMS1117-3.3`, `power:PWR_FLAG` are copied from `/usr/share/kicad/symbols/*.kicad_sym`. The LDO's inherited definition is resolved before embedding. Wire endpoints derive from those library pins using `(x + local_x, y - local_y)` at rotation zero. [Primary library hashes](../cad/poc/library-manifest.json), [pin positions](../cad/poc/pin-positions.json), [generator](../cad/poc/generate.py). Correct *library* geometry is established; manufacturer/package pinout review was not performed and is not inferred from it.

**ASSUMPTION — electrical scope:** 5 V-only, power-only illustrative circuit. Values, shield treatment, capacitance/ESR, current budget and thermal behavior are unqualified. This LDO is not a proposal to replace rev F's AP63203 universal-input buck. No semiconductor operating behavior is claimed as VERIFIED or DOCUMENTED-BUT-UNMEASURED by this POC.

**VERIFIED — version handling:** the emitter deliberately writes a known older schema, not a fabricated KiCad 10 version stamp. `kicad-cli sch upgrade --force` rewrites it into native format `20260306`, generator 10.0. The intermediate is [grouped-source.kicad_sch](../cad/poc/grouped-source.kicad_sch); final native file is linked above. Source: those actual file headers and [validation log](../cad/poc/validation.log).

Actual final run, captured verbatim from [validation.log](../cad/poc/validation.log):

```text
$ /usr/bin/kicad-cli version
10.0.6
[exit 0]

$ /usr/bin/kicad-cli sch upgrade --force cad/poc/grouped.kicad_sch
Successfully saved schematic file using the latest format
[exit 0]

$ /usr/bin/kicad-cli sch erc --severity-all --exit-code-violations -o cad/poc/erc.rpt cad/poc/grouped.kicad_sch
Found 0 violations
Saved ERC Report to cad/poc/erc.rpt
[exit 0]

$ /usr/bin/kicad-cli sch export pdf -o cad/poc/grouped.pdf cad/poc/grouped.kicad_sch
Plotted to 'cad/poc/grouped.pdf'.
Done.
[exit 0]

$ /usr/bin/kicad-cli sch export netlist --format kicadxml -o cad/poc/grouped.net.xml cad/poc/grouped.kicad_sch

[exit 0]
```

**VERIFIED — independent topology check:** [verify_netlist.py](../cad/poc/verify_netlist.py) reads KiCad's XML output and compares exact pin sets: CC1 = J1.A5/R1.1; CC2 = J1.B5/R2.1; DEMO_5V = four stacked VBUS pads/U1.3/C1.1; DEMO_3V3 = U1.2/C2.1; GND = connector return/shield, resistor returns, capacitor returns and U1.1. It also rejects unexpected nets beyond six intentional connector NCs. [Actual output](../cad/poc/netlist-check.log):

```text
PASS: all five intended nets match exact pin sets; six intentional connector NC pins; no other nets.
```

**VERIFIED — visual review:** exported with native CLI, rasterized using `pdftoppm -scale-to 2000 -singlefile -png cad/poc/grouped.pdf cad/poc/grouped`, and inspected. Both titles, real symbols, resistor/capacitor values, labels and note boxes are visible without overlap or clipping. Source: [PDF](../cad/poc/grouped.pdf). ERC's default ignored categories are explicitly listed in [erc.rpt](../cad/poc/erc.rpt); zero violations does not establish voltage ratings, current capacity, USB compliance or revision F readiness.

**VERIFIED — Antigravity limitation:** `agy` exists and `agy mcp list` reports enabled KiCad stdio configuration. The required headless read-only probe returned an empty response plus read-only CLI state/log errors. No actual MCP tool result was returned, so connectivity remains **unverified**, despite its JSON SUCCESS status. [Probe/result details](../cad/poc/agy-probe-status.md), [raw stdout](../cad/poc/agy-connectivity.json). No permission checks were disabled or MCP mutation requested. Native file generation/CLI checks above are separate evidence, not MCP success.

## Recommendation

**ASSUMPTION — full Bridge One implementation pattern:** use the direct emitter, a reviewed part/net manifest, pinned symbol hashes and explicit coordinates. Keep deterministic UUIDs, instance paths, annotations and library-source provenance in code. Retain a generated source copy; let the installed native CLI normalize it. The final POC needs only `sexpdata==1.0.2` ([requirements](../cad/poc/requirements.txt)); `kicad-sch-api` is retained only for the failed comparison trial.

**ASSUMPTION — grouping plan:** one functional group per hierarchical child sheet with a titled rectangle and voltage/current/design-rule note. Use these eight sheets: USB-C universal power input; 3V3 buck and accessory supplies; ESP32-S3; FPGA + PSRAM; target translators; TARGET I/O connectors; OLED; LEDs/buttons. Use global labels sparingly for rails/shared controls, hierarchical pins for group interfaces. Validate all hierarchy instance paths and sheet-pin net names in an additional POC before scaling; hierarchy was not tested here. Native support is documented in the [official schematic schema](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/).

Working single-sheet pattern from `generate.py` (coordinates in mm; these helpers are implemented in that file):

```python
block(147.32, 274.32, 'LDO / local capacitors (tooling example)',
      'ASSUMPTION: capacitor values and load budget need review.')
part('Regulator_Linear:AMS1117-3.3', 'U1', 'AMS1117-3.3', (210.82, 66.04))
net('U1', '3', 'DEMO_5V', (-12.7, 0))
net('U1', '2', 'DEMO_3V3', (12.7, 0))
net('U1', '1', 'GND', (0, 27.94))
```

Reproduce from repository root; these are explicit design-specific checks, not automatic application/host ABI tests:

```sh
python3 -m venv cad/poc/.venv
cad/poc/.venv/bin/pip install -r cad/poc/requirements.txt
cad/poc/.venv/bin/python cad/poc/generate.py
python3 cad/poc/run_checks.py
python3 cad/poc/verify_netlist.py
```

**VERIFIED:** `.venv/` is ignored by [cad/poc/.gitignore](../cad/poc/.gitignore). **ASSUMPTION — maintenance rule:** decide whether generated code or GUI edits own each sheet; do not overwrite manually reviewed edits by regeneration. The POC only implements rotation-zero, unit-one instances and the inheritance needed by these symbols. Extend/qualify transforms, multi-unit symbols and hierarchy before using it for the complete design.

## Open questions / bench tests

- **ASSUMPTION / tooling gate:** qualify hierarchical sheets, global-versus-hierarchical net scope, rotated/mirrored instances, multi-unit symbols and project library portability before full capture. Current absolute system-library table is for this workstation.
- **ASSUMPTION / tooling gate:** investigate the 0.5.6 global-label serialization failure before reconsidering that library; preserve [failed code](../cad/poc/api-trial.py) and [trial log](../cad/poc/api-trial-validation.log). A future fixed version needs the same native-netlist comparison.
- **ASSUMPTION / design review:** reconcile architecture text with rev F, then review exact part variants, symbols/footprints and datasheet pinouts. The source [placement](../cad/preview/placement.json) still contains candidate parts; this task does not select them.
- **ASSUMPTION / bench gates retained:** I2C shared-address/repeated-START behavior, FPGA same-CS SPI response timing, VTREF/default isolation, power/protection/backfeed and thermal/current budgets remain hardware work; none were measured here. Sources defining those gates: [AGENTS.md](../AGENTS.md), [README blockers](../README.md#release-blockers), [architecture](../docs/architecture.md), [header notes](../docs/pi-header-pinout.md).
