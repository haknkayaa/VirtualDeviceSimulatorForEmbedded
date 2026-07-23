interface TransactionHexViewerProps {
  request: number[]
  response: number[]
}

function rows(bytes: number[]) {
  return Array.from({ length: Math.max(1, Math.ceil(bytes.length / 16)) }, (_, row) => {
    const chunk = bytes.slice(row * 16, row * 16 + 16)
    return {
      offset: (row * 16).toString(16).padStart(4, '0').toUpperCase(),
      hex: chunk.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '),
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
            <code>{row.offset}</code>
            <code>{row.hex || '—'}</code>
            <code>{row.ascii || '—'}</code>
          </div>
        ))}
      </div>
    </section>
  )
}

export function TransactionHexViewer({ request, response }: TransactionHexViewerProps) {
  return (
    <div className="transaction-hex-grid">
      <HexBlock bytes={request} label="TX Buffer" />
      <HexBlock bytes={response} label="RX Buffer" />
    </div>
  )
}

