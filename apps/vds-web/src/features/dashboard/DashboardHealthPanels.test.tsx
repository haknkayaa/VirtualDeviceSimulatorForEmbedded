import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DashboardHealthPanels } from './DashboardHealthPanels'

describe('dashboard health panels', () => {
  it('lists application nodes and linked runtime modules', () => {
    render(<DashboardHealthPanels connectionStatus="connected" healthStatus="ok" />)

    expect(screen.getByRole('heading', { name: 'Server Health' })).toBeInTheDocument()
    expect(screen.getByText('vds-server')).toBeInTheDocument()
    expect(screen.getByText('vds-web')).toBeInTheDocument()
    expect(screen.getByText('vds-cli')).toBeInTheDocument()
    expect(screen.getByText('C client SDK')).toBeInTheDocument()
    expect(screen.getByText('vds-core')).toBeInTheDocument()
    expect(screen.getByText('vds-device-model')).toBeInTheDocument()
    expect(screen.getByText('vds-events')).toBeInTheDocument()
    expect(screen.getByText('vds-protocol')).toBeInTheDocument()
    expect(screen.getByText('vds-registers')).toBeInTheDocument()
    expect(screen.getByText('vds-scenario')).toBeInTheDocument()
  })

  it('shows unavailable host telemetry honestly when the API omits metrics', () => {
    render(<DashboardHealthPanels connectionStatus="disconnected" healthStatus="ok" />)

    expect(screen.getByRole('heading', { name: 'System Health' })).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('RAM')).toBeInTheDocument()
    expect(screen.getByText('Disk')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getAllByText('Not exposed').length).toBeGreaterThanOrEqual(4)
  })

  it('formats typed host telemetry when supplied by the health contract', () => {
    render(
      <DashboardHealthPanels
        connectionStatus="connected"
        healthStatus="ok"
        systemMetrics={{
          cpu_percent: 24.5,
          memory_used_bytes: 4_000_000_000,
          memory_total_bytes: 8_000_000_000,
          disk_used_bytes: 120_000_000_000,
          disk_total_bytes: 500_000_000_000,
          network_rx_bytes_per_sec: 1_500_000,
          network_tx_bytes_per_sec: 250_000,
        }}
      />,
    )

    expect(screen.getByText('24.5%')).toBeInTheDocument()
    expect(screen.getByText('4.0 GB / 8.0 GB')).toBeInTheDocument()
    expect(screen.getByText('120.0 GB / 500.0 GB')).toBeInTheDocument()
    expect(screen.getByText('1.5 MB/s')).toBeInTheDocument()
    expect(screen.getByText('250.0 KB/s')).toBeInTheDocument()
  })
})
