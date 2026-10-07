const COPIED_PROPERTIES = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'vector-effect', 'display',
]

/**
 * Rasterise a region of an on-screen SVG to PNG. Theme colours come from CSS
 * custom properties, so computed styles are inlined into the clone first; the
 * exported image therefore matches the active theme.
 */
export function downloadSvgRegionAsPng(
  sourceSvg: SVGSVGElement,
  region: { x: number; y?: number; width: number; height: number },
  fileName: string,
) {
  const { x, y = 0, width, height } = region
  const clone = sourceSvg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const sourceNodes = [sourceSvg, ...sourceSvg.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  sourceNodes.forEach((sourceNode, index) => {
    const computed = window.getComputedStyle(sourceNode)
    cloneNodes[index].setAttribute(
      'style',
      COPIED_PROPERTIES.map((property) => `${property}:${computed.getPropertyValue(property)}`).join(';'),
    )
  })

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    const context = canvas.getContext('2d')
    if (!context) {
      URL.revokeObjectURL(url)
      return
    }
    context.scale(pixelRatio, pixelRatio)
    context.drawImage(image, 0, 0, width, height)
    canvas.toBlob((pngBlob) => {
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
