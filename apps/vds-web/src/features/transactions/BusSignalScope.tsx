import { Download } from 'lucide-react'
import type { WheelEvent } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { LiveTransaction } from './transactionModel'
import { supportsSignalScope } from './signalScopeSupport'

interface BusSignalScopeProps {
  transaction: LiveTransaction
}

const LABEL_WIDTH = 66
const IDLE_WIDTH = 18
const MIN_CLOCK_WIDTH = 12
const MIN_HORIZONTAL_SCALE = 0.08
const MAX_HORIZONTAL_SCALE = 4
const SVG_HEIGHT = 232

function hex(byte: number) {
  return byte.toString(16).padStart(2, '0').toUpperCase()
}

function dataHexagon(x: number, y: number, dataWidth: number) {
  const left = x + 1
  const right = x + dataWidth - 1
  const bevel = 7
  // Match the data-cell height to the SCLK amplitude (106 - 82 = 24 px).
  const halfHeight = 12
  return [
    `${left},${y}`,
    `${left + bevel},${y - halfHeight}`,
    `${right - bevel},${y - halfHeight}`,
    `${right},${y}`,
    `${right - bevel},${y + halfHeight}`,
    `${left + bevel},${y + halfHeight}`,
  ].join(' ')
}

function downloadVisibleDiagram(
  scroll: HTMLDivElement | null,
  sourceSvg: SVGSVGElement | null,
  width: number,
  fileName: string,
) {
  if (!scroll || !sourceSvg) return

  const captureWidth = Math.max(1, Math.min(scroll.clientWidth, width - scroll.scrollLeft))
  const clone = sourceSvg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${scroll.scrollLeft} 0 ${captureWidth} ${SVG_HEIGHT}`)
  clone.setAttribute('width', String(captureWidth))
  clone.setAttribute('height', String(SVG_HEIGHT))

  const sourceNodes = [sourceSvg, ...sourceSvg.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  const copiedProperties = [
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
    'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight',
    'text-anchor', 'vector-effect',
  ]
  sourceNodes.forEach((sourceNode, index) => {
    const computed = window.getComputedStyle(sourceNode)
    cloneNodes[index].setAttribute(
      'style',
      copiedProperties.map(property => `${property}:${computed.getPropertyValue(property)}`).join(';'),
    )
  })

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(captureWidth * pixelRatio)
    canvas.height = SVG_HEIGHT * pixelRatio
    const context = canvas.getContext('2d')
    if (!context) {
      URL.revokeObjectURL(url)
      return
    }
    context.scale(pixelRatio, pixelRatio)
    context.drawImage(image, 0, 0, captureWidth, SVG_HEIGHT)
    canvas.toBlob(pngBlob => {
      if (!pngBlob) return
      const link = document.createElement('a')
      link.href = URL.createObjectURL(pngBlob)
      link.download = fileName
      link.click()
      URL.revokeObjectURL(link.href)
    }, 'image/png')
    URL.revokeObjectURL(url)
  }
  image.onerror = () => URL.revokeObjectURL(url)
  image.src = url
}

function SpiTimingDiagram({ request, response }: { request: number[]; response: number[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [horizontalScale, setHorizontalScale] = useState(1)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const updateWidth = () => setAvailableWidth(element.clientWidth)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Draw every transmitted byte, including 0x00. The response starts only
  // after the complete MOSI sequence so inactive lanes remain at logic low.
  const mosiBytes = request
  const responseOffset = mosiBytes.length
  const byteCount = Math.max(mosiBytes.length + response.length, 1)
  const bitCount = byteCount * 8
  const activeStart = LABEL_WIDTH + IDLE_WIDTH
  const horizontalUnits = byteCount * 8 + Math.max(byteCount - 1, 0)
  const expandableWidth = Math.max(availableWidth - LABEL_WIDTH - IDLE_WIDTH * 2, 0)
  const baseClockWidth = byteCount < 5
    ? Math.max(MIN_CLOCK_WIDTH, expandableWidth / horizontalUnits)
    : MIN_CLOCK_WIDTH
  const clockWidth = baseClockWidth * horizontalScale
  const byteDataWidth = clockWidth * 8
  const byteGapWidth = clockWidth
  const byteSlotWidth = byteDataWidth + byteGapWidth
  const activeEnd = activeStart + byteCount * byteDataWidth + Math.max(byteCount - 1, 0) * byteGapWidth
  const width = activeEnd + IDLE_WIDTH
  const csHigh = 38
  const csLow = 58
  const clockHigh = 82
  const clockLow = 106
  const mosiY = 153
  const misoY = 201

  const clockPath = Array.from({ length: byteCount }, (_, byte) => {
    const byteStart = activeStart + byte * byteSlotWidth
    const pulses = Array.from({ length: 8 }, (_, bit) => {
      const x = byteStart + bit * clockWidth
      const half = x + clockWidth / 2
      const end = x + clockWidth
      return `L ${half} ${clockLow} L ${half} ${clockHigh} L ${end} ${clockHigh} L ${end} ${clockLow}`
    }).join(' ')
    const gapEnd = byte === byteCount - 1 ? byteStart + byteDataWidth : byteStart + byteSlotWidth
    return `${pulses} L ${gapEnd} ${clockLow}`
  }).join(' ')

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.002)
    setHorizontalScale(current => Math.min(MAX_HORIZONTAL_SCALE, Math.max(MIN_HORIZONTAL_SCALE, current * factor)))
  }

  const downloadPng = () => {
    downloadVisibleDiagram(scrollRef.current, svgRef.current, width, `spi-timing-${byteCount}-bytes.png`)
  }

  return (
    <div className="spi-timing-frame">
      <div className="spi-timing-scroll" onWheel={handleWheel} ref={scrollRef}>
        <svg
          aria-label={`SPI timing diagram with ${byteCount} bytes and ${bitCount} clock cycles`}
          className="spi-timing-svg"
          height={SVG_HEIGHT}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
          width={width}
        >
        <rect className="spi-timing-background" height={SVG_HEIGHT} width={width} />

        <g className="spi-timing-grid">
          {Array.from({ length: byteCount }, (_, byte) => {
            const byteStart = activeStart + byte * byteSlotWidth
            return <g key={byteStart}>
              {Array.from({ length: 9 }, (__, bit) => {
                const x = byteStart + bit * clockWidth
                return <line className={bit === 0 || bit === 8 ? 'byte-boundary' : 'bit-boundary'} key={x} x1={x} x2={x} y1="20" y2="221" />
              })}
              {byte < byteCount - 1 && <rect className="clock-gap" height="201" width={byteGapWidth} x={byteStart + byteDataWidth} y="20" />}
            </g>
          })}
        </g>

        <g className="spi-clock-axis">
          {Array.from({ length: byteCount + 1 }, (_, byte) => {
            const x = byte === byteCount
              ? activeEnd
              : activeStart + byte * byteSlotWidth
            return <text key={x} x={x} y="14">{byte * 8}</text>
          })}
          <text className="axis-unit" x={LABEL_WIDTH - 7} y="14">CLK #</text>
        </g>

        <g className="spi-lane-labels">
          <text className="lane-cs" x="9" y={csLow}>/CS</text>
          <text className="lane-clock" x="9" y={clockLow}>SCLK</text>
          <text className="lane-mosi" x="9" y={mosiY + 4}>MOSI</text>
          <text className="lane-miso" x="9" y={misoY + 4}>MISO</text>
        </g>

        <path
          className="spi-trace spi-trace-cs"
          d={`M ${LABEL_WIDTH} ${csHigh} L ${activeStart} ${csHigh} L ${activeStart} ${csLow} L ${activeEnd} ${csLow} L ${activeEnd} ${csHigh} L ${width} ${csHigh}`}
        />
        <path
          className="spi-trace spi-trace-clock"
          d={`M ${LABEL_WIDTH} ${clockLow} L ${activeStart} ${clockLow} ${clockPath} L ${width} ${clockLow}`}
        />

        <line className="spi-data-low mosi" x1={LABEL_WIDTH} x2={width} y1={mosiY} y2={mosiY} />
        {mosiBytes.map((byte, index) => {
          const x = activeStart + index * byteSlotWidth
          const label = index === 0 ? `OP ${hex(byte)}` : hex(byte)
          return (
            <g className="spi-byte spi-byte-mosi" key={`mosi-${index}`}>
              <title>{`MOSI byte ${index}: 0x${hex(byte)} · ${byte.toString(2).padStart(8, '0')} · clocks ${index * 8}–${index * 8 + 7}`}</title>
              <polygon points={dataHexagon(x, mosiY, byteDataWidth)} />
              <text x={x + byteDataWidth / 2} y={mosiY + 4}>{label}</text>
            </g>
          )
        })}

        <line className="spi-data-low miso" x1={LABEL_WIDTH} x2={width} y1={misoY} y2={misoY} />
        {response.map((byte, index) => {
          const byteIndex = responseOffset + index
          const x = activeStart + byteIndex * byteSlotWidth
          return (
            <g className="spi-byte spi-byte-miso" key={`miso-${index}`}>
              <title>{`MISO byte ${index}: 0x${hex(byte)} · ${byte.toString(2).padStart(8, '0')} · clocks ${byteIndex * 8}–${byteIndex * 8 + 7}`}</title>
              <polygon points={dataHexagon(x, misoY, byteDataWidth)} />
              <text x={x + byteDataWidth / 2} y={misoY + 4}>{hex(byte)}</text>
            </g>
          )
        })}

        <g className="spi-active-window">
          <line x1={activeStart} x2={activeEnd} y1="226" y2="226" />
          <text x={(activeStart + activeEnd) / 2} y="224">{`${byteCount} bytes · ${bitCount} clocks`}</text>
        </g>
        </svg>
      </div>
      <button
        aria-label="Download visible timing diagram as PNG"
        className="spi-timing-download"
        onClick={downloadPng}
        title="Download visible timing diagram as PNG"
        type="button"
      >
        <Download aria-hidden="true" size={15} />
        PNG
      </button>
    </div>
  )
}

type DecodedBus = 'i2c' | 'uart' | 'gpio'
type DirectedByte = { byte: number; direction: 'tx' | 'rx' }

function directedBytes(request: number[], response: number[]): DirectedByte[] {
  return [
    ...request.map(byte => ({ byte, direction: 'tx' as const })),
    ...response.map(byte => ({ byte, direction: 'rx' as const })),
  ]
}

function levelPath(
  values: number[],
  startX: number,
  unitWidth: number,
  highY: number,
  lowY: number,
) {
  let currentY = highY
  let path = `M ${LABEL_WIDTH} ${highY} L ${startX} ${highY}`
  values.forEach((value, index) => {
    const x = startX + index * unitWidth
    const nextY = value ? highY : lowY
    path += ` L ${x} ${currentY} L ${x} ${nextY} L ${x + unitWidth} ${nextY}`
    currentY = nextY
  })
  return { path, currentY }
}

function ProtocolTimingDiagram({
  bus,
  request,
  response,
}: {
  bus: DecodedBus
  request: number[]
  response: number[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [horizontalScale, setHorizontalScale] = useState(1)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateWidth = () => setAvailableWidth(element.clientWidth)
    updateWidth()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bytes = directedBytes(request, response)
  const visibleBytes = bytes.length > 0 ? bytes : [{ byte: 0, direction: 'tx' as const }]
  const byteCount = visibleBytes.length
  const hasRepeatedStart = bus === 'i2c' && request.length > 0 && response.length > 0
  const unitCount = bus === 'i2c'
    ? byteCount * 9 + 2 + (hasRepeatedStart ? 1 : 0)
    : bus === 'uart'
      ? byteCount * 10 + Math.max(byteCount - 1, 0)
      : byteCount
  const minUnitWidth = bus === 'gpio' ? 64 : MIN_CLOCK_WIDTH
  const expandableWidth = Math.max(availableWidth - LABEL_WIDTH - IDLE_WIDTH * 2, 0)
  const baseUnitWidth = byteCount < 5
    ? Math.max(minUnitWidth, expandableWidth / unitCount)
    : minUnitWidth
  const unitWidth = baseUnitWidth * horizontalScale
  const activeStart = LABEL_WIDTH + IDLE_WIDTH
  const activeEnd = activeStart + unitCount * unitWidth
  const width = activeEnd + IDLE_WIDTH

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.002)
    setHorizontalScale(current => Math.min(MAX_HORIZONTAL_SCALE, Math.max(MIN_HORIZONTAL_SCALE, current * factor)))
  }

  const downloadPng = () => {
    downloadVisibleDiagram(
      scrollRef.current,
      svgRef.current,
      width,
      `${bus}-timing-${bytes.length}-bytes.png`,
    )
  }

  const i2cByteStart = (index: number) => activeStart
    + unitWidth
    + index * 9 * unitWidth
    + (hasRepeatedStart && index >= request.length ? unitWidth : 0)
  const uartFrameStart = (index: number) => activeStart + index * 11 * unitWidth

  const renderI2c = () => {
    const sclHigh = 48
    const sclLow = 72
    const sdaHigh = 101
    const sdaLow = 125
    const decodeY = 174
    const firstByteStart = i2cByteStart(0)
    const stopStart = i2cByteStart(byteCount - 1) + 9 * unitWidth
    const repeatedStartX = hasRepeatedStart ? i2cByteStart(request.length) - unitWidth : null
    let sclPath = `M ${LABEL_WIDTH} ${sclHigh} L ${firstByteStart} ${sclHigh} L ${firstByteStart} ${sclLow}`

    visibleBytes.forEach((_, byteIndex) => {
      const byteStart = i2cByteStart(byteIndex)
      if (repeatedStartX !== null && byteIndex === request.length) {
        sclPath += ` L ${repeatedStartX + unitWidth * .25} ${sclLow} L ${repeatedStartX + unitWidth * .25} ${sclHigh} L ${repeatedStartX + unitWidth * .75} ${sclHigh} L ${repeatedStartX + unitWidth * .75} ${sclLow} L ${byteStart} ${sclLow}`
      }
      for (let clock = 0; clock < 9; clock += 1) {
        const x = byteStart + clock * unitWidth
        sclPath += ` L ${x + unitWidth * .25} ${sclLow} L ${x + unitWidth * .25} ${sclHigh} L ${x + unitWidth * .75} ${sclHigh} L ${x + unitWidth * .75} ${sclLow} L ${x + unitWidth} ${sclLow}`
      }
    })
    sclPath += ` L ${stopStart + unitWidth * .25} ${sclLow} L ${stopStart + unitWidth * .25} ${sclHigh} L ${width} ${sclHigh}`

    let sdaPath = `M ${LABEL_WIDTH} ${sdaHigh} L ${activeStart + unitWidth * .5} ${sdaHigh} L ${activeStart + unitWidth * .5} ${sdaLow} L ${firstByteStart} ${sdaLow}`
    let currentY = sdaLow
    visibleBytes.forEach(({ byte }, byteIndex) => {
      const byteStart = i2cByteStart(byteIndex)
      if (repeatedStartX !== null && byteIndex === request.length) {
        sdaPath += ` L ${repeatedStartX + unitWidth * .2} ${currentY} L ${repeatedStartX + unitWidth * .2} ${sdaHigh} L ${repeatedStartX + unitWidth * .7} ${sdaHigh} L ${repeatedStartX + unitWidth * .7} ${sdaLow} L ${byteStart} ${sdaLow}`
        currentY = sdaLow
      }
      const bits = Array.from({ length: 8 }, (__, bit) => (byte >> (7 - bit)) & 1)
      for (const [bitIndex, bit] of bits.entries()) {
        const x = byteStart + bitIndex * unitWidth
        const nextY = bit ? sdaHigh : sdaLow
        sdaPath += ` L ${x} ${currentY} L ${x} ${nextY} L ${x + unitWidth} ${nextY}`
        currentY = nextY
      }
      const ackX = byteStart + 8 * unitWidth
      sdaPath += ` L ${ackX} ${currentY} L ${ackX} ${sdaLow} L ${ackX + unitWidth} ${sdaLow}`
      currentY = sdaLow
    })
    sdaPath += ` L ${stopStart + unitWidth * .55} ${sdaLow} L ${stopStart + unitWidth * .55} ${sdaHigh} L ${width} ${sdaHigh}`

    return <>
      <g className="protocol-grid i2c-grid">
        {visibleBytes.map((_, byteIndex) => {
          const byteStart = i2cByteStart(byteIndex)
          return Array.from({ length: 10 }, (__, boundary) => {
            const x = byteStart + boundary * unitWidth
            return <line className={boundary === 0 || boundary === 9 ? 'frame-boundary' : ''} key={`${byteIndex}-${boundary}`} x1={x} x2={x} y1="21" y2="219" />
          })
        })}
      </g>
      <g className="protocol-axis">
        <text className="axis-unit" x={LABEL_WIDTH - 7} y="14">I2C</text>
        <text x={activeStart + unitWidth * .5} y="14">START</text>
        {repeatedStartX !== null && <text x={repeatedStartX + unitWidth * .5} y="14">RESTART</text>}
        <text x={stopStart + unitWidth * .5} y="14">STOP</text>
      </g>
      <g className="protocol-lane-labels">
        <text className="lane-i2c-clock" x="9" y={sclLow}>SCL</text>
        <text className="lane-i2c-data" x="9" y={sdaLow}>SDA</text>
        <text className="lane-decode" x="9" y={decodeY + 4}>DATA</text>
      </g>
      <path className="protocol-trace i2c-clock-trace" d={sclPath} />
      <path className="protocol-trace i2c-data-trace" d={sdaPath} />
      {visibleBytes.map(({ byte, direction }, byteIndex) => {
        const byteStart = i2cByteStart(byteIndex)
        return <g className={`protocol-byte protocol-byte-${direction}`} key={`${direction}-${byteIndex}`}>
          <title>{`I2C ${direction.toUpperCase()} byte ${byteIndex}: 0x${hex(byte)} · MSB first · ACK clock ${byteIndex * 9 + 8}`}</title>
          <polygon points={dataHexagon(byteStart, decodeY, unitWidth * 8)} />
          <text x={byteStart + unitWidth * 4} y={decodeY + 4}>{`${direction.toUpperCase()} ${hex(byte)}`}</text>
          <text className="ack-label" x={byteStart + unitWidth * 8.5} y={decodeY + 4}>A</text>
        </g>
      })}
      <g className="protocol-summary">
        <line x1={activeStart} x2={activeEnd} y1="226" y2="226" />
        <text x={(activeStart + activeEnd) / 2} y="224">{`${bytes.length} bytes · ${bytes.length * 9} SCL pulses`}</text>
      </g>
    </>
  }

  const renderUart = () => {
    const txHigh = 63
    const txLow = 87
    const rxHigh = 151
    const rxLow = 175
    const lanePath = (direction: 'tx' | 'rx', highY: number, lowY: number) => {
      let path = `M ${LABEL_WIDTH} ${highY} L ${activeStart} ${highY}`
      let currentY = highY
      visibleBytes.forEach((item, index) => {
        const frameStart = uartFrameStart(index)
        const values = item.direction === direction
          ? [0, ...Array.from({ length: 8 }, (__, bit) => (item.byte >> bit) & 1), 1]
          : Array.from({ length: 10 }, () => 1)
        const frame = levelPath(values, frameStart, unitWidth, highY, lowY)
        path += frame.path.replace(/^M [^L]+L [^L]+/, '')
        currentY = frame.currentY
        const frameEnd = frameStart + 10 * unitWidth
        const gapEnd = index === byteCount - 1 ? frameEnd : frameEnd + unitWidth
        path += ` L ${frameEnd} ${currentY} L ${frameEnd} ${highY} L ${gapEnd} ${highY}`
        currentY = highY
      })
      return `${path} L ${width} ${highY}`
    }

    return <>
      <g className="protocol-grid uart-grid">
        {visibleBytes.map((_, frameIndex) => {
          const frameStart = uartFrameStart(frameIndex)
          return Array.from({ length: 11 }, (__, boundary) => {
            const x = frameStart + boundary * unitWidth
            return <line className={boundary === 0 || boundary === 10 ? 'frame-boundary' : ''} key={`${frameIndex}-${boundary}`} x1={x} x2={x} y1="21" y2="219" />
          })
        })}
      </g>
      <g className="protocol-axis">
        <text className="axis-unit" x={LABEL_WIDTH - 7} y="14">8N1</text>
        {visibleBytes.map(({ byte, direction }, index) => <text className={`axis-${direction}`} key={`${direction}-${index}`} x={uartFrameStart(index) + unitWidth * 5} y="14">{`${direction.toUpperCase()} ${hex(byte)}`}</text>)}
      </g>
      <g className="protocol-lane-labels">
        <text className="lane-uart-tx" x="9" y={txLow}>TX</text>
        <text className="lane-uart-rx" x="9" y={rxLow}>RX</text>
      </g>
      <path className="protocol-trace uart-tx-trace" d={lanePath('tx', txHigh, txLow)} />
      <path className="protocol-trace uart-rx-trace" d={lanePath('rx', rxHigh, rxLow)} />
      {visibleBytes.map(({ direction }, index) => {
        const x = uartFrameStart(index)
        const y = direction === 'tx' ? 111 : 199
        return <g className={`uart-frame-label frame-${direction}`} key={`labels-${direction}-${index}`}>
          <text x={x + unitWidth * .5} y={y}>S</text>
          <text x={x + unitWidth * 5} y={y}>D0…D7</text>
          <text x={x + unitWidth * 9.5} y={y}>P</text>
        </g>
      })}
      <g className="protocol-summary">
        <line x1={activeStart} x2={activeEnd} y1="226" y2="226" />
        <text x={(activeStart + activeEnd) / 2} y="224">{`${bytes.length} frames · start + 8 data (LSB first) + stop`}</text>
      </g>
    </>
  }

  const renderGpio = () => {
    const sampleWidth = unitWidth
    return <>
      <g className="protocol-grid gpio-grid">
        {Array.from({ length: byteCount + 1 }, (_, index) => {
          const x = activeStart + index * sampleWidth
          return <line className="frame-boundary" key={x} x1={x} x2={x} y1="21" y2="219" />
        })}
      </g>
      <g className="protocol-axis gpio-axis">
        <text className="axis-unit" x={LABEL_WIDTH - 7} y="14">BANK</text>
        {visibleBytes.map(({ byte, direction }, index) => <text className={`axis-${direction}`} key={`${direction}-${index}`} x={activeStart + (index + .5) * sampleWidth} y="14">{`${direction === 'tx' ? 'OUT' : 'IN'} ${hex(byte)}`}</text>)}
      </g>
      {Array.from({ length: 8 }, (_, bit) => {
        const centerY = 34 + bit * 24
        const highY = centerY - 7
        const lowY = centerY + 7
        let previousY = lowY
        return <g className="gpio-line" key={bit}>
          <text className="gpio-line-label" x="9" y={centerY + 4}>{`G${bit}`}</text>
          <path className="protocol-trace gpio-idle-trace" d={`M ${LABEL_WIDTH} ${lowY} L ${activeStart} ${lowY}`} />
          {visibleBytes.map(({ byte, direction }, index) => {
            const x = activeStart + index * sampleWidth
            const nextY = byte & (1 << bit) ? highY : lowY
            const path = `M ${x} ${previousY} L ${x} ${nextY} L ${x + sampleWidth} ${nextY}`
            previousY = nextY
            return <path className={`protocol-trace gpio-${direction}-trace`} d={path} key={`${direction}-${index}`} />
          })}
          <path className="protocol-trace gpio-idle-trace" d={`M ${activeEnd} ${previousY} L ${width} ${previousY}`} />
        </g>
      })}
      <g className="protocol-summary">
        <line x1={activeStart} x2={activeEnd} y1="226" y2="226" />
        <text x={(activeStart + activeEnd) / 2} y="224">{`${bytes.length} bank samples · G0 is LSB`}</text>
      </g>
    </>
  }

  const ariaLabel = bus === 'i2c'
    ? `I2C timing diagram with ${bytes.length} bytes and ${bytes.length * 9} clock pulses`
    : bus === 'uart'
      ? `UART 8N1 timing diagram with ${bytes.length} frames`
      : `GPIO timing diagram with ${bytes.length} bank samples`

  return <div className={`spi-timing-frame protocol-timing-frame protocol-${bus}`}>
    <div className="spi-timing-scroll" onWheel={handleWheel} ref={scrollRef}>
      <svg
        aria-label={ariaLabel}
        className="spi-timing-svg protocol-timing-svg"
        height={SVG_HEIGHT}
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        width={width}
      >
        <rect className="spi-timing-background" height={SVG_HEIGHT} width={width} />
        {bus === 'i2c' ? renderI2c() : bus === 'uart' ? renderUart() : renderGpio()}
      </svg>
    </div>
    <button
      aria-label={`Download visible ${bus.toUpperCase()} timing diagram as PNG`}
      className="spi-timing-download"
      onClick={downloadPng}
      title={`Download visible ${bus.toUpperCase()} timing diagram as PNG`}
      type="button"
    >
      <Download aria-hidden="true" size={15} />
      PNG
    </button>
  </div>
}

export function BusSignalScope({ transaction }: BusSignalScopeProps) {
  const bus = transaction.busType.toLowerCase()
  if (bus === 'spi') {
    return <section className="bus-signal-scope">
      <header><div><span>Protocol-aware timing diagram</span><strong>SPI signal scope</strong></div><small>Mode 0 · CPOL=0 · CPHA=0 · /CS Active Low · 8 clocks / byte · 1-cycle gap</small></header>
      <div className="signal-pin-rail"><span>Active pins</span>{['/CS', 'SCLK', 'MOSI', 'MISO'].map((pin) => <i key={pin}>{pin}</i>)}</div>
      <SpiTimingDiagram request={transaction.request} response={transaction.response} />
    </section>
  }
  if (!supportsSignalScope(bus)) return null
  const scopeCopy = {
    i2c: {
      title: 'I2C signal scope',
      detail: 'START · MSB first · 8 data clocks + ACK · repeated START · STOP',
      pins: ['SCL', 'SDA'],
    },
    uart: {
      title: 'UART signal scope',
      detail: '8N1 · idle high · start low · 8 data bits LSB first · stop high',
      pins: ['TX', 'RX'],
    },
    gpio: {
      title: 'GPIO signal scope',
      detail: '8-line bank samples · G0 is LSB · high/low line states',
      pins: ['G0…G7'],
    },
  }[bus as DecodedBus]
  return <section className="bus-signal-scope">
    <header><div><span>Protocol-aware timing diagram</span><strong>{scopeCopy.title}</strong></div><small>{scopeCopy.detail}</small></header>
    <div className="signal-pin-rail"><span>Active pins</span>{scopeCopy.pins.map(pin => <i key={pin}>{pin}</i>)}</div>
    <ProtocolTimingDiagram bus={bus as DecodedBus} request={transaction.request} response={transaction.response} />
  </section>
}
