import type { LiveTransaction } from './transactionModel'

interface BusSignalScopeProps {
  transaction: LiveTransaction
}

function bits(bytes: number[]) {
  return bytes.slice(0, 8).flatMap((byte) =>
    Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1),
  )
}

function BitLane({ label, values }: { label: string; values: number[] }) {
  return (
    <div className="signal-lane">
      <strong>{label}</strong>
      <div className="signal-cells">
        {values.map((value, index) => (
          <i className={value ? 'high' : 'low'} key={`${label}-${index}`} title={`${value}`} />
        ))}
      </div>
    </div>
  )
}

function ByteLane({ label, values }: { label: string; values: number[] }) {
  return (
    <div className="signal-lane signal-byte-lane">
      <strong>{label}</strong>
      <div className="signal-byte-cells">
        {values.slice(0, 16).map((value, index) => (
          <i key={`${label}-${index}`}>{value.toString(16).padStart(2, '0').toUpperCase()}</i>
        ))}
      </div>
    </div>
  )
}

export function BusSignalScope({ transaction }: BusSignalScopeProps) {
  const txBits = bits(transaction.request)
  const rxBits = bits(transaction.response)
  const length = Math.max(txBits.length, rxBits.length, 8)
  const paddedTx = Array.from({ length }, (_, index) => txBits[index] ?? 0)
  const paddedRx = Array.from({ length }, (_, index) => rxBits[index] ?? 0)
  const clock = Array.from({ length }, (_, index) => index % 2)
  const bus = transaction.busType.toLowerCase()
  const pins = bus === 'spi'
    ? ['CS', 'SCLK', 'MOSI', 'MISO', 'GND']
    : bus === 'i2c'
      ? ['SCL', 'SDA', 'VCC', 'GND']
      : bus === 'ethernet'
        ? ['TX+', 'TX−', 'RX+', 'RX−']
        : ['TX', 'RX']

  return (
    <section className="bus-signal-scope">
      <header>
        <div><span>Decoded bus preview</span><strong>{bus.toUpperCase()} signal scope</strong></div>
        <small>Byte-derived preview · not an electrical measurement</small>
      </header>
      <div className="signal-pin-rail">
        <span>Active pins</span>
        {pins.map((pin) => <i key={pin}>{pin}</i>)}
      </div>
      {bus === 'spi' && (
        <div className="signal-lanes">
          <BitLane label="CS" values={Array.from({ length }, () => 0)} />
          <BitLane label="CLK" values={clock} />
          <BitLane label="MOSI" values={paddedTx} />
          <BitLane label="MISO" values={paddedRx} />
        </div>
      )}
      {bus === 'i2c' && (
        <div className="signal-lanes">
          <BitLane label="SCL" values={clock} />
          <BitLane label="SDA" values={paddedTx} />
        </div>
      )}
      {bus === 'ethernet' && (
        <div className="signal-lanes">
          <ByteLane label="TX" values={transaction.request} />
          <ByteLane label="RX" values={transaction.response} />
        </div>
      )}
      {!['spi', 'i2c', 'ethernet'].includes(bus) && (
        <div className="signal-lanes">
          <ByteLane label="TX" values={transaction.request} />
          <ByteLane label="RX" values={transaction.response} />
        </div>
      )}
    </section>
  )
}
