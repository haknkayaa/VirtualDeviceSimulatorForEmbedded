# KLS L-KLS1-5416-L1-01-R footprint review

2026-10-14. **Documentary draft; loads in KiCad 10.0.6; not fabrication-released.** No physical connector or PCB has been measured.

## Primary sources and status

- **VERIFIED** = primary source read; file checks verified only what is stated. **DOCUMENTED-BUT-UNMEASURED** = manufacturer geometry/fit not physically qualified. **ASSUMPTION** = engineering interpretation or presentation choice requiring review.
- **VERIFIED:** [KLS drawing, revision V0, 2024-07-01, sheets 1-3](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf) downloaded and visually inspected. PDF SHA-256: `c5600a3091f8beaeb03e2f1182d03695e8bbf58d10a9603b8ac1eb283083c9fd`. Sheet 1 ordering information explicitly includes L1-01-R; L1 length 0.96 mm / H1 0.90 mm. Sheet 2 recommended layout states tolerance ±0.05 mm and T=0.80. **DOCUMENTED-BUT-UNMEASURED:** fit on a 0.80 mm PCB; other PCB thicknesses require vendor confirmation. [KLS, sheets 1-2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf)
- **VERIFIED:** installed primary KiCad library [Connector symbol](/usr/share/kicad/symbols/Connector.kicad_sym) has A1,A4,A5,A6,A7,A8,A9,A12,B1,B4,B5,B6,B7,B8,B9,B12 and **SH**. Symbol-library SHA-256: `50b42bf755009d3d459c310182dca1c37e1ff1a01fa6ae23846b416fafffc914`. The task's suggested S1 conflicts with this installed symbol; using S1 would leave SH unmatched.
- **VERIFIED:** [installed GCT USB4110 footprint](/usr/share/kicad/footprints/Connector_USB.pretty/USB_C_Receptacle_GCT_USB4110.kicad_mod) uses coincident paired GND/VBUS pads and SH. [Installed HRO footprint](/usr/share/kicad/footprints/Connector_USB.pretty/USB_C_Receptacle_HRO_TYPE-C-31-M-17.kicad_mod) provides a slot/NPTH construction comparison. These are encoding precedents only; no dimensions were copied.

## Coordinates and drawing references

**VERIFIED:** all dimensions below are mm. Top/component-side view follows sheet 2 as printed: contact lands above the body, mating mouth toward +Y. Origin is the intersection of the connector centerline and the upper/rear shield-slot centerline; X right, Y toward mating mouth. Sheet 2 contact labels determine orientation, avoiding a mirror of sheet 1's bottom view. [KLS, sheet 2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf)

Drawing-reference key (all sheet 2 unless stated):

| Ref | Read dimension and derivation | Status |
| --- | --- | --- |
| XG | GND shared-land span 6.40; x=±3.20 | VERIFIED |
| XV | VBUS shared-land span 4.80; x=±2.40 | VERIFIED |
| XS | spans 3.50, 2.50, 1.50, 0.50; x=±1.75, ±1.25, ±0.75, ±0.25 | VERIFIED |
| YP | `12-5.32` top of lands to front-slot center; `12-4.17` land bottom to same center; height=1.15, top=4.18-5.32=-1.14, bottom=4.18-4.17=0.01, center=-0.565 | VERIFIED |
| WP | `4-0.60` wide lands; `8-0.30` narrow lands | VERIFIED |
| SHX | slot-center span 8.64; x=±4.32 | VERIFIED |
| SHY | `2-4.18` slot-center pitch; rear y=0, front y=4.18 | VERIFIED |
| SHR | rear outer length `2-2.10`, hole length `2-1.70` | VERIFIED |
| SHF | front outer length `2-1.80`, hole length `2-1.40` | VERIFIED |
| SHW | slot width `4-0.60`; outer width 1.00 inferred as 0.60+(2.10-1.70) | ASSUMPTION: concentric oval with constant 0.20 ring |
| NP | `2-Ø0.65`, span 5.78; x=±2.89; `2-3.68` hole-to-front-slot distance gives y=4.18-3.68=0.50 | VERIFIED |

**DOCUMENTED-BUT-UNMEASURED:** nominal copper/drill geometry in the tables implements these drawing dimensions; finished-slot tolerance and assembly fit remain unmeasured. All dimensional references above: [KLS, sheet 2, Recommended PCB Layout](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf). SHW's inferred width is not an explicit vendor dimension.

## Every pad and hole

Rows marked VERIFIED refer to source transcription; physical qualification remains DOCUMENTED-BUT-UNMEASURED. Coincident aliases have the same full land, not two adjacent half-lands. Rectangular SMT pads reproduce the drawn copper rectangles.

| Pad | Signal | X | Y | Copper W × H | Drill W × H | Drawing refs | Status |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| A1 | GND | -3.200 | -0.565 | 0.60 × 1.15 | — | XG, YP, WP; pin table | VERIFIED |
| B12 | GND | -3.200 | -0.565 | 0.60 × 1.15 | — | XG, YP, WP; pin table | VERIFIED |
| A4 | VBUS | -2.400 | -0.565 | 0.60 × 1.15 | — | XV, YP, WP; pin table | VERIFIED |
| B9 | VBUS | -2.400 | -0.565 | 0.60 × 1.15 | — | XV, YP, WP; pin table | VERIFIED |
| B8 | SBU2 | -1.750 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| A5 | CC1 | -1.250 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| B7 | DN2 | -0.750 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| A6 | DP1 | -0.250 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| A7 | DN1 | 0.250 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| B6 | DP2 | 0.750 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| A8 | SBU1 | 1.250 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| B5 | CC2 | 1.750 | -0.565 | 0.30 × 1.15 | — | XS, YP, WP; pin table | VERIFIED |
| A9 | VBUS | 2.400 | -0.565 | 0.60 × 1.15 | — | XV, YP, WP; pin table | VERIFIED |
| B4 | VBUS | 2.400 | -0.565 | 0.60 × 1.15 | — | XV, YP, WP; pin table | VERIFIED |
| B1 | GND | 3.200 | -0.565 | 0.60 × 1.15 | — | XG, YP, WP; pin table | VERIFIED |
| A12 | GND | 3.200 | -0.565 | 0.60 × 1.15 | — | XG, YP, WP; pin table | VERIFIED |
| SH (left rear) | Shield | -4.32 | 0.00 | 1.00 × 2.10 oval | 0.60 × 1.70 plated slot | SHX, SHY, SHR, SHW | VERIFIED lengths/position; ASSUMPTION outer width |
| SH (left front) | Shield | -4.32 | 4.18 | 1.00 × 1.80 oval | 0.60 × 1.40 plated slot | SHX, SHY, SHF, SHW | VERIFIED lengths/position; ASSUMPTION outer width |
| SH (right rear) | Shield | 4.32 | 0.00 | 1.00 × 2.10 oval | 0.60 × 1.70 plated slot | SHX, SHY, SHR, SHW | VERIFIED lengths/position; ASSUMPTION outer width |
| SH (right front) | Shield | 4.32 | 4.18 | 1.00 × 1.80 oval | 0.60 × 1.40 plated slot | SHX, SHY, SHF, SHW | VERIFIED lengths/position; ASSUMPTION outer width |
| empty (NPTH) | Locator | -2.89 | 0.50 | Ø0.65, no copper | Ø0.65 nonplated | NP | VERIFIED |
| empty (NPTH) | Locator | 2.89 | 0.50 | Ø0.65, no copper | Ø0.65 nonplated | NP | VERIFIED |

**VERIFIED:** paired labels are A1/B12, A4/B9, A9/B4 and B1/A12 in the recommended layout. [KLS, sheet 2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf) **ASSUMPTION:** coincident-pad encoding follows the [KiCad USB4110 precedent](/usr/share/kicad/footprints/Connector_USB.pretty/USB_C_Receptacle_GCT_USB4110.kicad_mod). Each pair must receive the same schematic net; distinct nets would create a physical short. Both aliases include identical mask/paste geometry; review CAM output for one aperture per shared land. No A6/B6 or A7/B7 copper bridge is baked into the footprint.

## Fab, silk, courtyard and edge

- **VERIFIED:** body envelope width 8.94, length 7.35; front shield center to mouth 2.60. [KLS, sheet 1, top and side views](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf) Derived mouth y=4.18+2.60=6.78, back y=6.78-7.35=-0.57. **ASSUMPTION:** simplified F.Fab rectangle x=±4.47, y=-0.57..6.78 represents that envelope; complex shell contours are omitted.
- **ASSUMPTION:** F.CrtYd x=±5.10, y=-1.40..7.05 uses 0.25 mm clearance around nominal copper/body and rounds outward to 0.05 mm. This is an author margin, not a KLS dimension. Underlying envelope is [KLS sheets 1-2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf).
- **ASSUMPTION:** silk at x=±4.95 with breaks y=1.40..2.98 and 5.38..6.89, mouth line y=6.89, 0.12 mm strokes; drawn away from slot copper. Fab stroke 0.10, courtyard stroke 0.05; text sizes/positions are presentation choices, not mechanical dimensions. Copper and shell references: [KLS sheets 1-2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf).
- **VERIFIED:** sheet 2 labels a dashed **PRODUCT EDGE**, with no board-edge offset dimension. **ASSUMPTION:** Dwgs.User line y=6.78 (x=±6), labeled `BOARD EDGE = PRODUCT EDGE (ASSUMED)`, proposes a flush PCB edge at the mouth. Source datum is derived above; line length/text are annotation choices. It is deliberately not Edge.Cuts; the board author must confirm the intended overhang and create the actual outline. [KLS sheets 1-2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf)
- **ASSUMPTION:** NPTH locating pins and plated shell slots follow the drawn clear circles and annular ovals. No solder-mask expansion, paste reduction or 3D model is prescribed; fabrication/assembly policy must be reviewed separately. [KLS sheet 2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf)

## Actual validation

**VERIFIED (local CLI evidence):** `kicad-cli --version` returned `10.0.6`. Final load/export command:

```text
kicad-cli fp export svg --output /tmp/bridge-one-kls-svg --layers F.Cu,F.SilkS,F.Fab,F.CrtYd,Dwgs.User --footprint USB_C_Receptacle_KLS1-5416-L1 cad/footprints/BridgeOne.pretty
```

Actual stdout, exit 0:

```text
Plotting footprint 'USB_C_Receptacle_KLS1-5416-L1' to '/tmp/bridge-one-kls-svg/USB_C_Receptacle_KLS1-5416-L1.svg'
Plotted to '/tmp/bridge-one-kls-svg/USB_C_Receptacle_KLS1-5416-L1.svg'.
Done.
```

**VERIFIED:** first export attempt, before creating the temporary output directory, returned exit 0 despite reporting `Failed to create file ...`, `Error creating svg file`, `Done.` The directory was then created and the above successful export inspected; exit code alone was not accepted.

**VERIFIED:** direct pad-name comparison with the installed primary symbol produced:

```text
Symbol pins: A1, A12, A4, A5, A6, A7, A8, A9, B1, B12, B4, B5, B6, B7, B8, B9, SH
Footprint named pads: 20
NPTH holes: 2
Missing symbol pins: []
Extra named pads: []
```

**VERIFIED:** visually inspected the successful KiCad SVG against the manufacturer layout: land order, four slots, two locator holes, fab envelope, broken silk, courtyard and edge annotation are present. Temporary raster inspection removed only invisible SVG text elements because ImageMagick rendered their zero-opacity search text; visible KiCad stroke geometry was preserved. Primary evidence: exported SVG above and [KLS sheet 2](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf).

**VERIFIED:** source-derived audit: 16 logical SMT pads forming 12 unique copper lands, four SH slots and two NPTH holes. Export checks parsing and rendering, not PCB DRC, solderability or measured fit. Primary evidence: output footprint and installed [symbol](/usr/share/kicad/symbols/Connector.kicad_sym).

**VERIFIED (tool observation):** `agy mcp list` showed enabled `kicad` stdio configuration. A bounded read-only headless attempt could not establish a usable MCP result; it reported `You are not logged into Antigravity` and read-only Antigravity state-storage errors. No MCP mutation or permission bypass was used. Direct KiCad CLI produced the artifact validation above.

## Recommendation

Accept this as a reviewable custom-footprint candidate for the exact L1-01-R variant. Use **SH**, matching the installed symbol. Hold fabrication acceptance until the inferred slot annulus width, PCB thickness and flush-edge assumption are confirmed; preserve the existing preview/scaffold until architect review.

## Open questions / bench tests

- Obtain KLS confirmation of 1.00 mm shell-land width and whether 0.60 mm slots denote finished plated dimensions; verify the ±0.05 mm layout tolerance with the PCB vendor.
- Confirm T=0.80 applicability to the exact sourced L1 connector and intended PCB thickness. Trial-fit a real connector on a coupon; check slot/pin registration, seating and solder joints.
- Confirm flush PCB edge versus shell overhang; check plug/case clearance with the actual mechanical assembly.
- Review paired-contact nets and generated paste/mask apertures; qualify stencil/process before production. Verify contact numbering/orientation on the received part.
