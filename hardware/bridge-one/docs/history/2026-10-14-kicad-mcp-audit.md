# KiCad Engineering Capability & MCP Audit Report: Bridge One

**Audit Target:** VDS4E Bridge One Hardware Scaffold  
**Date:** 2026-10-14  
**Auditor:** Antigravity Engineering Agent  
**Output Target:** `hardware/vds4e-bridge/cad/mcp-capabilities.md`  

---

## 1. Executive Summary

This audit evaluates the system-installed KiCad toolchain, Python bindings, default component symbol libraries, and the KiCad Model Context Protocol (MCP) server running in `tools/kicad-mcp` against the requirements for **Bridge One** (ESP32-S3-WROOM-1-N8R8 companion test/validation hardware).

### Key Audit Conclusions:
1. **KiCad Version & CLI:** KiCad `6.0.2+dfsg-1` is installed via Debian/Ubuntu apt packages. The modern `kicad-cli` binary is **not available** (introduced in KiCad 7.0+). CLI invocations of GUI binaries (`kicad`, `eeschema`) fail or hang because they do not accept headless CLI flags like `--version` and treat them as file arguments.
2. **Python `pcbnew` Environment:** Python `pcbnew` (v6.0.2) is available in the system Python (`/usr/bin/python3`), but is **not installed or accessible** in the isolated virtualenv (`tools/kicad-mcp/.venv`) used by the KiCad MCP server. The MCP server explicitly sets `kicad_modules_available = False`.
3. **MCP Server Capability Scope:** The KiCad MCP server is **strictly read-only and analytical**. It exposes 16 tools for project discovery, file structure inspection, boundary validation, netlist parsing, pattern recognition, BOM extraction, DRC history, and thumbnail generation. **It contains zero tools or APIs for authoring or mutating schematic symbols, wires, nets, pins, or layout traces.**
4. **Scaffold `.kicad_pro` Format:** The existing file `hardware/vds4e-bridge/vds4e-bridge.kicad_pro` contains a mock S-expression (`(kicad_pro (version 6) (generator "kicad"))`), which is **invalid** for KiCad 6. KiCad 6 expects JSON format for `.kicad_pro`. The MCP `validate_project` tool explicitly rejects it with `Invalid project file format (JSON parsing error)`.
5. **Component Symbol Library Availability:** 
   - **ESP32-S3-WROOM-1:** **Missing** from standard KiCad 6.0.2 libraries. A custom symbol with the exact 41-pad pinout must be embedded or generated in a local library.
   - **Level Translators, USB-C, Regulators, ESD:** Available in stock KiCad 6 symbol libraries.

---

## 2. Toolchain & Environment Audit

### 2.1 Installed KiCad Packages (`dpkg-query -W 'kicad*'`)
```text
kicad               6.0.2+dfsg-1
kicad-demos         6.0.2+dfsg-1
kicad-footprints    6.0.2-1
kicad-libraries     6.0.2+dfsg-1
kicad-symbols       6.0.2-1
kicad-templates     6.0.0-1
```

### 2.2 CLI Availability (`command -v kicad-cli`)
- **Status:** **NOT FOUND**.
- **Impact:** KiCad 6 lacks the unified headless command line tool (`kicad-cli`) present in KiCad 7 and 8. Exporting netlists, running ERC, or plotting headlessly via CLI cannot use `kicad-cli`. Furthermore, running `kicad --version` or `eeschema --version` attempts to launch GUI sessions or treats `--version` as a schematic file to open.

### 2.3 Python `pcbnew` Availability
- **System Python (`/usr/bin/python3`):**
  - Command: `python3 -c "import pcbnew; print(pcbnew.GetBuildVersion())"`
  - Result: **Available** (`pcbnew version: 6.0.2+dfsg-1`).
- **MCP Server Virtualenv (`tools/kicad-mcp/.venv`):**
  - Command: `tools/kicad-mcp/.venv/bin/python -c "import pcbnew"`
  - Result: **Failed** (`ModuleNotFoundError: No module named 'pcbnew'`).
  - Analysis: The MCP server runtime does not link system `dist-packages` where `pcbnew.py` and `_pcbnew.so` reside. In `kicad_mcp/server.py`, `kicad_modules_available` is hardcoded to `False`, and internal operations fall back to parsing file text.

---

## 3. KiCad MCP Server Capability Analysis

### 3.1 Enumeration of MCP Tools & Authoring Feasibility
Inspection of the MCP implementation (`/home/ubuntu/Desktop/PersonelProjects/tools/kicad-mcp/kicad_mcp/`) confirms the following tools registered across modules:

| Tool Name | Source Module | Read/Write | Functionality |
| :--- | :--- | :--- | :--- |
| `list_projects` | `project_tools.py` | Read-only | Discovers `.kicad_pro` files across configured search paths. |
| `get_project_structure` | `project_tools.py` | Read-only | Identifies related `.kicad_sch`, `.kicad_pcb`, and metadata. |
| `open_project` | `project_tools.py` | Command/GUI | Attempts to open project in GUI desktop session. |
| `validate_project` | `analysis_tools.py` | Read-only | Checks for presence of PCB/sch and validates `.kicad_pro` JSON. |
| `validate_project_boundaries` | `validation_tools.py` | Read-only | Checks symbol placement coordinates against sheet bounds. |
| `generate_validation_report` | `validation_tools.py` | Read/Report | Generates a JSON boundary validation report. |
| `extract_schematic_netlist` | `netlist_tools.py` | Read-only | Parses `.kicad_sch` S-expressions to extract components & nets. |
| `extract_project_netlist` | `netlist_tools.py` | Read-only | Discovers schematic from project and calls extraction. |
| `analyze_schematic_connections` | `netlist_tools.py` | Read-only | Evaluates connected pins, floating pins, and net topologies. |
| `find_component_connections` | `netlist_tools.py` | Read-only | Inspects pin connections for a specified reference designator. |
| `identify_circuit_patterns` | `pattern_tools.py` | Read-only | Detects heuristics (voltage dividers, pullups, filter caps). |
| `analyze_project_circuit_patterns` | `pattern_tools.py` | Read-only | Runs pattern detector across project schematic. |
| `analyze_bom` | `bom_tools.py` | Read-only | Summarizes Bill of Materials from schematic components. |
| `export_bom_csv` | `export_tools.py` | Export | Exports parsed BOM data into CSV format. |
| `run_drc_check` | `drc_tools.py` | Read-only | Parses existing DRC report files (or invokes CLI where available). |
| `get_drc_history_tool` | `drc_tools.py` | Read-only | Reads historical DRC run logs. |
| `generate_pcb_thumbnail` | `export_tools.py` | Export | Generates image thumbnail of PCB layer. |
| `generate_project_thumbnail` | `export_tools.py` | Export | Generates composite thumbnail. |

> [!CRITICAL]
> **Authoring Verdict:** The MCP server **CANNOT** author schematic symbols, create wires, place labels, or modify circuit connectivity. It contains zero symbol-placement or schematic-mutation APIs. Never infer CAD editing capabilities from tool names.

### 3.2 Actual MCP Read-Only Execution Log
The following calls were executed against the Bridge One scaffold:

1. **`list_projects`**
   - **Call:** `call_mcp_tool(ServerName="kicad", ToolName="list_projects", Arguments={})`
   - **Result:** Success.
   - **Output:**
     ```json
     [{"modified": 1791976996.43, "name": "vds4e-bridge", "path": "/home/ubuntu/Desktop/PersonelProjects/VirtualDeviceSimulatorForEmbedded/hardware/vds4e-bridge/vds4e-bridge.kicad_pro", "relative_path": "vds4e-bridge/vds4e-bridge.kicad_pro"}]
     ```

2. **`get_project_structure`**
   - **Call:** `call_mcp_tool(ServerName="kicad", ToolName="get_project_structure", Arguments={"project_path": ".../hardware/vds4e-bridge/vds4e-bridge.kicad_pro"})`
   - **Result:** Success. Correctly resolved PCB and schematic companion paths.
   - **Output:**
     ```json
     {"directory": ".../hardware/vds4e-bridge", "files": {"pcb": ".../vds4e-bridge.kicad_pcb", "project": ".../vds4e-bridge.kicad_pro", "schematic": ".../vds4e-bridge.kicad_sch"}, "metadata": {}, "name": "vds4e-bridge", "path": ".../vds4e-bridge.kicad_pro"}
     ```

3. **`validate_project`**
   - **Call:** `call_mcp_tool(ServerName="kicad", ToolName="validate_project", Arguments={"project_path": ".../hardware/vds4e-bridge/vds4e-bridge.kicad_pro"})`
   - **Result:** **Failed Validation**.
   - **Output:**
     ```json
     {"files_found": ["project", "pcb", "schematic"], "issues": ["Invalid project file format (JSON parsing error)"], "path": ".../vds4e-bridge.kicad_pro", "valid": false}
     ```
   - **Analysis:** Confirms that KiCad 6 `.kicad_pro` must be JSON. The scaffold's S-expression is rejected.

4. **`extract_schematic_netlist`**
   - **Call:** `call_mcp_tool(ServerName="kicad", ToolName="extract_schematic_netlist", Arguments={"schematic_path": ".../hardware/vds4e-bridge/vds4e-bridge.kicad_sch", "ctx": null})`
   - **Result:** Success (Scaffold is empty sheet).
   - **Output:**
     ```json
     {"analysis": {"component_count": 0, "component_types": {}, "net_count": 0, "power_nets": [], "total_pin_connections": 0}, "component_count": 0, "components": {}, "net_count": 0, "nets": {}, "schematic_path": ".../vds4e-bridge.kicad_sch", "success": true}
     ```
   - *Note on failure:* Calling without `"ctx": null` returned `Input validation error: 'ctx' is a required property` due to FastMCP parameter introspection.

5. **`extract_project_netlist`**
   - **Call:** `call_mcp_tool(ServerName="kicad", ToolName="extract_project_netlist", Arguments={"project_path": ".../hardware/vds4e-bridge/vds4e-bridge.kicad_pro", "ctx": null})`
   - **Result:** **Internal Error**.
   - **Output:**
     ```json
     {"error": "'FunctionTool' object is not callable", "success": false}
     ```
   - **Root Cause:** In `kicad_mcp/tools/netlist_tools.py`, line 143 calls `await extract_schematic_netlist(schematic_path, ctx)` where `extract_schematic_netlist` was decorated by `@mcp.tool()` and is wrapped into a FastMCP `FunctionTool` rather than a callable coroutine.

---

## 4. Scaffold Format Audit (`.kicad_pro`)

### 4.1 Existing File Analysis
The file `hardware/vds4e-bridge/vds4e-bridge.kicad_pro` currently contains:
```lisp
(kicad_pro
  (version 6)
  (generator "kicad")
)
```

### 4.2 KiCad 6 Specification
- In KiCad 5, project files used `.pro` INI format.
- In **KiCad 6.0+**, the project file was renamed to `.kicad_pro` and its format is **strict JSON** (with top-level keys `"board"`, `"schematic"`, `"meta"`, `"net_settings"`).
- S-expression format in KiCad 6 is used exclusively for `.kicad_sch` (schematics), `.kicad_sym` (symbols), and `.kicad_pcb` (board layouts).
- The mock S-expression in `vds4e-bridge.kicad_pro` is invalid. When opened by KiCad 6, it must be replaced by standard KiCad 6 project JSON.

---

## 5. Component Symbol Library Audit

Stock KiCad symbol libraries were audited in `/usr/share/kicad/symbols/`:

### 5.1 ESP32-S3-WROOM-1 Module
- **Search Query:** `grep -r -i "esp32-s3" /usr/share/kicad/symbols/`
- **Result:** **Not found in stock libraries** (KiCad 6.0.2 was packaged in Feb 2022 before ESP32-S3 symbols were merged into upstream `kicad-symbols`). Only `ESP32-WROOM-32`, `ESP32-S2-WROVER`, and `ESP32-PICO-D4` exist.
- **ESP32-S3-WROOM-1 Exact Pinout (Espressif Datasheet Reference):**
  - **Total Pads:** 41 (40 perimeter pins + Pin 41 central thermal Ground pad `GND`).
  - **Pin Mapping:**
    - Pin 1: `GND`
    - Pin 2: `3V3` (Power In, 3.0 V to 3.6 V)
    - Pin 3: `EN` (High: on; pull-up required; Low: off)
    - Pin 4: `IO4` (ADC1_CH3, RTC_GPIO4)
    - Pin 5: `IO5` (ADC1_CH4, RTC_GPIO5)
    - Pin 6: `IO6` (ADC1_CH5, RTC_GPIO6)
    - Pin 7: `IO7` (ADC1_CH6, RTC_GPIO7)
    - Pin 8: `IO15` (ADC2_CH4, RTC_GPIO15)
    - Pin 9: `IO16` (ADC2_CH5, RTC_GPIO16)
    - Pin 10: `IO17` (ADC2_CH6, RTC_GPIO17)
    - Pin 11: `IO18` (ADC2_CH7, RTC_GPIO18, USB D-)
    - Pin 12: `IO8` (ADC1_CH7, RTC_GPIO8)
    - Pin 13: `IO19` (ADC2_CH8, RTC_GPIO19, USB D+)
    - Pin 14: `IO20` (ADC2_CH9, RTC_GPIO20, USB D-)
    - Pin 15: `IO3` (ADC1_CH2, RTC_GPIO3)
    - Pin 16: `IO46` (Input only; Boot strap: pull low during reset to enter download boot)
    - Pin 17: `IO9` (ADC1_CH8, RTC_GPIO9, FSPIHD)
    - Pin 18: `IO10` (ADC1_CH9, RTC_GPIO10, FSPICS0)
    - Pin 19: `IO11` (ADC2_CH0, RTC_GPIO11, FSPID)
    - Pin 20: `IO12` (ADC2_CH1, RTC_GPIO12, FSPICLK)
    - Pin 21: `IO13` (ADC2_CH2, RTC_GPIO13, FSPIQ)
    - Pin 22: `IO14` (ADC2_CH3, RTC_GPIO14, FSPIWP)
    - Pin 23: `IO21` (RTC_GPIO21)
    - Pin 24: `IO47` (RTC_GPIO47)
    - Pin 25: `IO48` (RTC_GPIO48)
    - Pin 26: `IO45` (RTC_GPIO45, VDD_SPI strapping)
    - Pin 27: `IO0` (RTC_GPIO0, Boot strap: Low = download boot, High = SPI boot)
    - Pin 28: `IO35` (RTC_GPIO35, OCTAL PSRAM reserved on N8R8)
    - Pin 29: `IO36` (RTC_GPIO36, OCTAL PSRAM reserved on N8R8)
    - Pin 30: `IO37` (RTC_GPIO37, OCTAL PSRAM reserved on N8R8)
    - Pin 31: `IO38` (RTC_GPIO38)
    - Pin 32: `IO39` (RTC_GPIO39)
    - Pin 33: `IO40` (RTC_GPIO40)
    - Pin 34: `IO41` (RTC_GPIO41)
    - Pin 35: `IO42` (RTC_GPIO42)
    - Pin 36: `RXD0` (IO44, U0RXD)
    - Pin 37: `TXD0` (IO43, U0TXD)
    - Pin 38: `IO2` (ADC1_CH1, RTC_GPIO2)
    - Pin 39: `IO1` (ADC1_CH0, RTC_GPIO1)
    - Pin 40: `GND`
    - Pin 41: `GND` (Thermal Pad / Exposed Pad)
  - **Constraint Notice (N8R8 variant):** As mandated in `hardware/vds4e-bridge/AGENTS.md`, pins IO35, IO36, IO37 (and depending on flash/PSRAM line mode, IO33/IO34) are connected internally to the octal PSRAM and **must not be routed or used as external GPIOs**.

### 5.2 Level Translators
Available in `/usr/share/kicad/symbols/Logic_LevelTranslator.kicad_sym` and `Interface.kicad_sym`:
- `TXB0104D`, `TXB0104PW`, `TXB0104RUT` (4-bit bidirectional auto-direction translator)
- `TXB0108DQSR` (8-bit bidirectional translator)
- `TXS0102DCU`, `TXS0108EPW` (Open-drain/push-pull compatible for I2C)
- `SN74AVC4T245PW`, `SN74AVC8T245PW` (Direction-controlled high-speed translators)
- `SN74LVC1T45`, `SN74LVC2T45` (1-bit / 2-bit level shifters)
- `PCA9306`, `PCA9306D`, `PCA9306DC` (2-bit I2C bus voltage level translator)

### 5.3 USB Type-C Receptacles
Available in `/usr/share/kicad/symbols/Connector.kicad_sym`:
- `USB_C_Receptacle_USB2.0` (16-pin / 12-pin layout for USB 2.0 D+/D-/CC1/CC2/VBUS/GND)
- `USB_C_Receptacle` (Full 24-pin Type-C receptacle with SuperSpeed lines)

### 5.4 Voltage Regulators (3.3 V & 1.8 V LDOs)
Available in `/usr/share/kicad/symbols/Regulator_Linear.kicad_sym`:
- `AP2112K-3.3`, `AP2112K-1.8` (SOT-23-5, 600mA low-dropout, EN pin)
- `AMS1117-3.3`, `AMS1117-1.8`, `AMS1117CD-3.3` (SOT-223 / TO-252, 1A LDO)
- `AP2204K-3.3`, `AP2204K-1.8` (SOT-23-5, wide VIN, low noise)

### 5.5 ESD Protection
Available in `/usr/share/kicad/symbols/Power_Protection.kicad_sym`:
- `USBLC6-2SC6` (SOT-23-6, low-capacitance dual USB data line protection)
- `USBLC6-4SC6` (SOT-23-6, 4-line ESD array)
- `PRTR5V0U2X` (SOT-143B, ultra-low capacitance ESD protection)
- `TPD2E2U06` (SOT-523 / SOT-23, dual channel ESD protection)
- `TPD4E02B04DQA` (USON-10, 4-channel ESD array)

---

## 6. Recommended Workflow for Connected KiCad 6 Draft Generation

Because the MCP server cannot edit or author schematics, and `kicad-cli` is absent, the team must generate the connected KiCad 6 draft programmatically.

### Architecture for Schematic Draft Generation:
1. **Architect Net Map Input:**
   The architect supplies a reviewed pin and net map (e.g. YAML/JSON or tabular format) specifying:
   - ESP32-S3 pin allocations (excluding PSRAM octal lines).
   - Peripheral connectivity (USB-C CC pulldowns, ESD protection, level shifter ports, 3.3V/1.8V power rails, decoupling caps, pullups).
2. **Deterministic S-Expression Schematic Generator:**
   Use a dedicated Python script (e.g., `tools/generate_bridge_schematic.py`) executing under `/usr/bin/python3`:
   - Emits a standard KiCad 6 schematic header `(kicad_sch (version 20211123) (generator "eeschema") ...)`.
   - Embeds the `ESP32-S3-WROOM-1` symbol definition in `(lib_symbols ...)` with standard pin geometry.
   - Embeds library definitions for `USB_C_Receptacle_USB2.0`, `USBLC6-2SC6`, `TXS0108EPW`, `AP2112K-3.3`, etc.
   - Instantiates symbols with unique UUIDs, references (`U1`, `J1`, `U2`, `C1`), and positions on a 2.54mm / 1.27mm grid.
   - Emits wires `(wire (pts (xy X1 Y1) (xy X2 Y2)))` and global/hierarchical labels `(global_label "SPI_CLK" (shape input) (at X Y R) ...)` linking corresponding pins.
3. **JSON Project File Emission:**
   Emit a valid KiCad 6 `.kicad_pro` JSON configuration defining design settings, net classes, and schematic references.
4. **Validation Pipeline:**
   - Execute the MCP `extract_schematic_netlist` to verify all components and net connections are parsed without floating/isolated nodes.
   - Execute MCP `validate_project` to confirm project validity.
   - Run system `python3 -c "import pcbnew; ..."` for downstream netlist/PCB footprint net sync.

---

## 7. Report Path Confirmation
- **Actual File Path:** `hardware/vds4e-bridge/cad/mcp-capabilities.md`
