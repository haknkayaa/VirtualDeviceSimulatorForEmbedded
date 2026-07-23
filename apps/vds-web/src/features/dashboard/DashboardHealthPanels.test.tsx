import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DashboardHealthPanels } from './DashboardHealthPanels'

describe('dashboard health panels', () => {
  it('lists application nodes and linked runtime modules', () => {
    render(<DashboardHealthPanels healthStatus="ok" />)

    expect(screen.getByRole('heading', { name: 'Server Health' })).toBeInTheDocument()
    expect(screen.getByText('vds-server')).toBeInTheDocument()
    expect(screen.getByText('vds-web')).toBeInTheDocument()
    expect(screen.getByText('vds-cli')).toBeInTheDocument()
    expect(screen.queryByText('C client SDK')).not.toBeInTheDocument()
    expect(screen.queryByText('Event stream')).not.toBeInTheDocument()
    expect(screen.getByText('vds-core')).toBeInTheDocument()
    expect(screen.getByText('vds-device-model')).toBeInTheDocument()
    expect(screen.getByText('vds-events')).toBeInTheDocument()
    expect(screen.getByText('vds-protocol')).toBeInTheDocument()
    expect(screen.getByText('vds-registers')).toBeInTheDocument()
    expect(screen.getByText('vds-scenario')).toBeInTheDocument()
    expect(screen.getAllByText('RUNNING')).toHaveLength(9)
    expect(
      screen.getByRole('heading', { name: 'System Health' }).compareDocumentPosition(
        screen.getByRole('heading', { name: 'Server Health' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows unavailable host telemetry honestly when the API omits metrics', () => {
    render(<DashboardHealthPanels healthStatus="ok" />)

    expect(screen.getByRole('heading', { name: 'System Health' })).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('RAM')).toBeInTheDocument()
    expect(screen.getByText('Disk')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getAllByText('Not exposed').length).toBeGreaterThanOrEqual(4)
  })

  it('marks server-backed modules as failed when server health is unavailable', () => {
    render(<DashboardHealthPanels healthStatus="offline" />)

    expect(screen.getAllByText('FAIL')).toHaveLength(8)
    expect(screen.getAllByText('RUNNING')).toHaveLength(1)
  })

  it('formats typed host telemetry when supplied by the health contract', () => {
    render(
      <DashboardHealthPanels
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
