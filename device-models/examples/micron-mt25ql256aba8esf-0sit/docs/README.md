# MT25QL256ABA8ESF-0SIT simulation profile

Source: `mt25q_qljs_l_256_aba_xxt.pdf`, revision L, March 2024, supplied
locally as `MT25QL256ABA8ESF-0SIT.pdf`.

## Datasheet facts represented

| Property | Value |
| --- | --- |
| Density | 256 Mbit / 32 MiB |
| Main array | `0x00000000`–`0x01FFFFFF` |
| Page size | 256 bytes |
| Erased value | `0xFF` |
| JEDEC ID | `20 BA 19` |
| Supply | 2.7–3.6 V |
| Maximum STR clock | 133 MHz |
| Standard READ maximum | 54 MHz |
| Typical 256-byte page program | 120 µs |
| Maximum page program | 1800 µs |
| Typical 4 KiB erase | 50 ms |
| Maximum 4 KiB erase | 400 ms |
| Typical bulk erase | 77 s |
| Deep-power-down exit | 30 µs |

The package uses dedicated four-byte commands so the complete 32 MiB address
range is usable without modeling the volatile 3-byte/4-byte address-mode bit:

| Command | Opcode | Runtime behavior |
| --- | ---: | --- |
| READ ID | `9F` | Returns `20 BA 19` |
| READ STATUS REGISTER | `05` | Returns WIP/WEL status |
| READ FLAG STATUS REGISTER | `70` | Returns modeled ready/busy bit 7 |
| WRITE ENABLE / DISABLE | `06` / `04` | Controls WEL |
| 4-BYTE READ | `13` | Reads the main array |
| 4-BYTE PAGE PROGRAM | `12` | Programs 1→0 within one 256-byte page |
| 4-BYTE 4KB SUBSECTOR ERASE | `21` | Erases one 4 KiB subsector |
| BULK ERASE | `C7` | Erases the complete array |
| DEEP POWER-DOWN / RELEASE | `B9` / `AB` | Models standby recovery |
| RESET ENABLE / RESET MEMORY | `66` / `99` | Resets volatile simulation state |

Nominal datasheet timings are used for deterministic completion. Fault
profiles cover the corresponding maximum-time and failure paths.

## Deliberate capability limits

The datasheet also defines Extended/Dual/Quad STR and DTR protocols, fast-read
dummy cycles, 3-byte address mode and extended address register, 32 KiB and
64 KiB erase, program/erase suspend-resume, SFDP, OTP, protection/lock
registers, CRC, XIP, and configuration-register persistence. The current
`generic-spi-command` runtime cannot represent those features accurately, so
this package does not claim to implement them.

In particular, opcode `D8` is omitted instead of incorrectly mapping a 64 KiB
sector erase onto the runtime's single 4 KiB erase geometry. These missing
features should be added through runtime capabilities, not by approximating
their wire behavior in the package.

The model rounds the datasheet's 40 ns software-reset recovery requirement up
to 1 µs because the current scheduler schema stores integral microseconds.

## Traceability

- Memory map and geometry: datasheet Table 2
- Status, flag status, extended-address, nonvolatile/volatile/enhanced configuration,
  advanced sector-protection, global-freeze, sector-lock, password and
  general-purpose read registers: Tables 3, 5–8 and 12–16 plus the Rev. L
  command-set register operations
- Device identification: Tables 17 and 18
- Commands and opcodes: Tables 19–23 and 33–34
- Program/erase semantics: Tables 28 and 30
- Electrical and operation timings: Table 48

This is a community-authored behavioral model and is not an official Micron
deliverable. Consult the original datasheet for electrical design decisions.
