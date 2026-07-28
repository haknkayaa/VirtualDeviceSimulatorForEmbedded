interface TransactionHexViewerProps {
  request: number[]
  response: number[]
}

function rows(bytes: number[]) {
  const bytesPerRow = 16
  return Array.from({ length: Math.max(1, Math.ceil(bytes.length / bytesPerRow)) }, (_, row) => {
    const chunk = bytes.slice(row * bytesPerRow, row * bytesPerRow + bytesPerRow)
    const hex = (group: number[]) => group
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ')

    return {
      offset: (row * bytesPerRow).toString(16).padStart(8, '0'),
      leftHex: hex(chunk.slice(0, 8)),
      rightHex: hex(chunk.slice(8, 16)),
      ascii: chunk.map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join(''),
    }
  })
}

function HexBlock({ label, bytes }: { label: string; bytes: number[] }) {
  return (
    <section className="transaction-hex-block">
      <header><strong>{label}</strong><span>{bytes.length} bytes</span></header>
      <div className="hex-viewer">
        {rows(bytes).map((row) => (
          <div key={row.offset}>
            <code className="hexdump-line">
              <span className="hexdump-offset">{row.offset}</span>
              {'  '}
              <span>{(row.leftHex || '—').padEnd(23, ' ')}</span>
              {'  '}
              <span>{row.rightHex.padEnd(23, ' ')}</span>
              {'  '}
              <span className="hexdump-ascii">|{row.ascii}|</span>
            </code>
          </div>
        ))}
      </div>
    </section>
  )
}

export function TransactionHexViewer({ request, response }: TransactionHexViewerProps) {
  return (
    <div className="transaction-hex-grid">
      <HexBlock bytes={response} label="RX Buffer" />
      <HexBlock bytes={request} label="TX Buffer" />
    </div>
  )
}
