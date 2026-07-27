import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DashboardHealthPanels } from './DashboardHealthPanels'

describe('dashboard health panels', () => {
  it('lists only independently running processes', () => {
    render(<DashboardHealthPanels
      adapters={[{
        id: 'spi0',
        name: 'SPI 0',
        bus_type: 'spi',
        driver: 'cuse',
        state: 'loaded',
        readiness: 'ready',
        bus_number: 0,
        bindings: [{ device_id: 'flash-0', endpoint: 0, device_path: '/dev/spidev0.0' }],
        daemon_pids: [4321],
      }]}
      healthStatus="ok"
    />)

    expect(screen.getByRole('heading', { name: 'Server Health' })).toBeInTheDocument()
    expect(screen.getByText('vds-server')).toBeInTheDocument()
    expect(screen.getByText('spi0 adapter')).toBeInTheDocument()
    expect(screen.getByText('cuse daemon · endpoint 0 · PID 4321')).toBeInTheDocument()
    expect(screen.queryByText('vds-web')).not.toBeInTheDocument()
    expect(screen.queryByText('vds-events')).not.toBeInTheDocument()
    expect(screen.queryByText('vds-core')).not.toBeInTheDocument()
    expect(screen.getAllByText('RUNNING')).toHaveLength(2)
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

  it('marks the server process as failed when health is unavailable', () => {
    render(<DashboardHealthPanels healthStatus="offline" />)

    expect(screen.getByText('FAIL')).toBeInTheDocument()
    expect(screen.queryByText('RUNNING')).not.toBeInTheDocument()
    expect(screen.getByText('No separate adapter processes are running.')).toBeInTheDocument()
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

  it('rounds byte-level network rates', () => {
    render(
      <DashboardHealthPanels
        healthStatus="ok"
        systemMetrics={{
          network_rx_bytes_per_sec: 42.738291,
          network_tx_bytes_per_sec: 7.193847,
        }}
      />,
    )

    expect(screen.getByText('43 B/s')).toBeInTheDocument()
    expect(screen.getByText('7 B/s')).toBeInTheDocument()
  })
})
