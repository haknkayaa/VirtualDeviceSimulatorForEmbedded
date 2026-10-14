# Bridge One architecture — revision A working draft

Status: proposed hardware/firmware architecture, not an implemented capability.
Date: 2026-10-14. MCU choice is fixed; bus release gates remain open.

## Product boundary

V1 lets a physical embedded board use its existing bus controller and application
to interact with virtual peripherals. V2 reverses supported bus roles to access
physical peripherals. Modes are selected per disconnected/quiescent port; they
are not simultaneous opposing masters on the same wires.

The existing workstation workflow remains unchanged:

```text
x86_64 Yocto application -> standard Linux ABI -> host adapter
                       -> Unix-socket Protobuf -> authoritative VDS4E runtime
```

The proposed additional V1 path is:

```text
physical target's I2C/SPI/UART/GPIO
  -> ESD and target-voltage translation
  -> ESP32-S3 local bounded peripheral executor
  -> native USB device link
  -> PC bridge gateway
  -> existing Unix-socket data plane / proposed execution-lease extension
  -> authoritative VDS4E runtime
```

USB is a transport, not a new REST transaction interface. `adapters/bridge` in
the repository is existing internal host transport code; this hardware product
must not silently redefine that module's purpose. Firmware and gateway code are
future work. Any runtime/protocol changes need a separately reviewed ADR.

## Local execution and PC authority

A register snapshot alone cannot implement pointer advancement, write masks,
read-clear, busy timers, IRQ transitions or faults correctly. The PC must
authorize a bounded, declarative execution profile, not arbitrary firmware
device-specific logic. The following is a proposed contract:

1. PC validates a package against the bridge's advertised execution capabilities.
   Unsupported operations are rejected before attaching the physical target.
2. PC grants an exclusive execution lease for the device instance, with a new
   epoch, model/profile hash, initial state version and bounded event capacity.
   Concurrent PC bus writes, resets, fault changes and scenario mutations are
   queued until a quiescent reconciliation boundary; inspection reports lag.
3. Firmware atomically installs the profile and state while all port drivers
   are isolated. It only enables the port after a valid target reference and
   host acknowledgment. ISR-critical state/buffers use internal SRAM/IRAM;
   PSRAM is for noncritical storage until its access behavior is characterized.
4. The local executor applies authorized side effects immediately in observed
   transaction order and journals request, bytes actually returned, state delta,
   signal transitions, sequence number and monotonic bridge timestamp.
5. The PC ingests ordered events exactly once by epoch/sequence and reconciles
   using the same semantics. An observation must not execute side effects twice.
   This requires a new ingestion/lease contract; current transaction RPCs alone
   do not establish this behavior.
6. A divergence is a failed run. A physical response already returned cannot be
   rolled back; firmware isolates the port at a safe boundary and a new epoch
   requires explicit resynchronization. Never silently overwrite divergent state.
7. USB disconnect, lease expiry, queue exhaustion, MCU reset or invalid VTREF
   causes an explicit failed/offline state. No unbounded offline simulation and
   no invented successful response. Electrical fail behavior is bus-specific:
   release I2C lines, deselect/tri-state SPI MISO, isolate push-pull outputs.

Live HIL observes real target clocks and bridge timestamps. It cannot claim the
same timing guarantees as manual virtual-clock scenarios. Define a clock mapping,
timer budget and allowed skew before timed profiles are enabled. Scheduled local
events are part of the journal; manual clock advance requires detached HIL.

## Electrical blocks

- ESP32-S3-WROOM-1-N8R8 at 3.3 V; onboard antenna keepout on every copper layer.
- USB-C USB2 device: separate 5.1 kΩ Rd on CC1 and CC2, paired D+/D− contacts,
  low-capacitance data-line ESD near the receptacle, reviewed VBUS protection and
  current budget. No USB-PD dependency. Do not assume an arbitrary USB host grants
  500 mA before enumeration; firmware/power policy must respect the source.
- Dedicated 3.3 V regulator with transient margin, local module bulk/decoupling,
  EN reset network and BOOT access. Power dissipation must be evaluated before
  selecting a compact LDO over a buck.
- Target VTREF is an input reference, nominally 1.8 V or 3.3 V. Default V1 must
  not power the target or tie VTREF to the bridge's 3.3 V. A later V2 accessory
  supply is separate, explicitly selected and protected against backfeed.
- Push-pull signals use dual-supply direction-controlled translators with
  output enable and partial-power-down isolation. MCU/control side is the rail
  to which DIR/OE thresholds are referenced. UART TX/RX and SPI MISO cannot share
  a single direction bank with oppositely directed lines.
- I2C uses a dedicated open-drain translator and independent pullups to the
  correct rail on each side. Target pullups are configurable to avoid excessive
  combined sink current with target-board pullups. Both sides propagate SCL low
  for stretching. Equal-rail operation and enable biasing need explicit review.
- Hardware defaults isolate outputs during boot/reset/unpowered VTREF. Software
  GPIO defaults alone do not establish safe isolation. SPI MISO OE must obey CS
  in slave mode, even if a translator would otherwise drive an idle logic level.
- Separate target I2C, SPI, UART and GPIO connectors with adjacent grounds and
  explicit VTREF markings. Reserve probe access on both sides of translators.
- Four layers: signals/components, continuous GND, power/secondary routing,
  signals. Start with a roughly 50 × 50 mm placement envelope; actual dimensions
  follow connector, antenna and thermal constraints, not a frozen promise.

## V1 feasibility gates

| Bus | Initial hardware provision | Release gate |
| --- | --- | --- |
| I2C | Two controller pin pairs; two separate ports by default | One configured slave address/controller; shared-bus two-address wiring and repeated-START responses need proof |
| SPI | One SPI2 port on native mux pins | Prequeued TX is not a general same-CS command/address decoder; arbitrary flash/sensor emulation is blocked without further implementation evidence |
| UART | One full-duplex 1.8/3.3 V TTL port | Bounded response/buffering latency and parser behavior; no RS232/RS485 electrical claim |
| GPIO | Four individually directed target channels proposed | Startup isolation, edge latency, active-low handling and journal ordering |

Do not solve a SPI gate by requiring a new handshake or two-transaction protocol
in an unchanged target driver. Such a protocol can only be a separately labeled
cooperative endpoint. Do not promise arbitrary simultaneous I2C addresses by
reprogramming one address between transactions.

## V2 reservation

I2C translators remain bidirectional. SPI direction banks and MISO isolation
must support role reversal while all enables are inactive; CS changes to an
output in master mode. UART remains full duplex, with clear signal naming from
the bridge perspective. GPIO directions are configured only while isolated.
Connecting V2 to a board that already drives SPI/I2C requires electrical bus
ownership arbitration; the default is a physically separate peripheral fixture.

## Evidence

- [ESP-IDF 5.5.3 I2C](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2c.html)
- [ESP-IDF 5.5.3 SPI slave](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/spi_slave.html)
- [Module datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf)
- Independent delegated technical/sourcing reports are under `research/`.

No bench timing or conformance measurement has been performed. Firmware support,
final schematic, procurement readiness and fabrication release remain distinct
milestones.
