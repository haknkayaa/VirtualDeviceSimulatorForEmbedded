interface TransactionHexViewerProps {
  request: number[]
  response: number[]
}

const BYTES_PER_ROW = 16

function rows(bytes: number[]) {
  return Array.from({ length: Math.max(1, Math.ceil(bytes.length / BYTES_PER_ROW)) }, (_, row) => {
    const chunk = bytes.slice(row * BYTES_PER_ROW, row * BYTES_PER_ROW + BYTES_PER_ROW)
    const hex = (group: number[]) => group
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ')

    return {
      offset: (row * BYTES_PER_ROW).toString(16).padStart(8, '0'),
      leftHex: hex(chunk.slice(0, 8)),
      rightHex: hex(chunk.slice(8, 16)),
      ascii: chunk.map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join(''),
    }
  })
}

function HexBlock({ label, bytes, direction }: { label: string; bytes: number[]; direction: 'tx' | 'rx' }) {
  return (
    <section className={`txa-hex-block ${direction}`}>
      <header>
        <strong>{label}</strong>
        <span>{bytes.length} {bytes.length === 1 ? 'byte' : 'bytes'}</span>
      </header>
      <div className="txa-hexdump">
        {bytes.length === 0
          ? <span className="txa-hex-empty">empty</span>
          : rows(bytes).map((row) => (
            <code className="txa-hex-line" key={row.offset}>
              <span className="txa-hex-offset">{row.offset}</span>
              {'  '}
              <span>{row.leftHex.padEnd(23, ' ')}</span>
              {'  '}
              <span>{row.rightHex.padEnd(23, ' ')}</span>
              {'  '}
              <span className="txa-hex-ascii">|{row.ascii}|</span>
            </code>
          ))}
      </div>
    </section>
  )
}

/** Classic offset / 16-byte hex / ASCII dump of both directions of a transfer. */
export function TransactionHexViewer({ request, response }: TransactionHexViewerProps) {
  return (
    <div className="txa-hex">
      <HexBlock bytes={request} direction="tx" label="TX Buffer" />
      <HexBlock bytes={response} direction="rx" label="RX Buffer" />
    </div>
  )
}
