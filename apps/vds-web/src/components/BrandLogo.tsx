import darkPng from '../assets/brand/vds4e-logo-dark-transparent.png'
import darkWebp from '../assets/brand/vds4e-logo-dark-transparent.webp'
import lightPng from '../assets/brand/vds4e-logo-light-transparent.png'
import lightWebp from '../assets/brand/vds4e-logo-light-transparent.webp'

const logoSources = {
  dark: { fallback: darkPng, webp: darkWebp },
  light: { fallback: lightPng, webp: lightWebp },
} as const

interface BrandLogoProps {
  className?: string
  decorative?: boolean
  variant?: keyof typeof logoSources
}

export function BrandLogo({ className, decorative = false, variant = 'dark' }: BrandLogoProps) {
  const source = logoSources[variant]

  return (
    <picture className={className}>
      <source srcSet={source.webp} type="image/webp" />
      <img
        alt={decorative ? '' : 'VDS4E — Virtual Device Simulator for Embedded'}
        decoding="async"
        src={source.fallback}
      />
    </picture>
  )
}
