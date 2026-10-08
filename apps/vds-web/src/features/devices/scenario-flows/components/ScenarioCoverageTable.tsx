import type { CoverageMetric, CoverageMetricName, ScenarioCoverage } from '../../../../types/api'

const metrics: { name: CoverageMetricName; label: string }[] = [
  { name: 'commands', label: 'Commands' },
  { name: 'registers', label: 'Registers' },
  { name: 'states', label: 'States' },
  { name: 'transitions', label: 'Transitions' },
  { name: 'faults', label: 'Faults' },
]

function MetricCell({ metric }: { metric: CoverageMetric }) {
  if (metric.total === 0) return <td className="num dim">—</td>
  const ratio = metric.covered / metric.total
  return (
    <td className="num coverage-cell" title={metric.missed.length ? `Not exercised: ${metric.missed.join(', ')}` : 'All exercised'}>
      <span className="mono">{metric.covered}/{metric.total}</span>
      <span aria-hidden="true" className="coverage-bar"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
    </td>
  )
}

/**
 * Declared device behavior a scenario run exercised (ADR 0013): commands sent,
 * registers reached through the device, states and transitions observed and
 * faults triggered. Inspection asserts do not count.
 */
export function ScenarioCoverageTable({ coverage }: { coverage: ScenarioCoverage }) {
  if (coverage.devices.length === 0) return null
  return (
    <div aria-label="Scenario coverage" className="scenario-coverage" role="group">
      <table className="data-table">
        <thead>
          <tr>
            <th>Coverage</th>
            {metrics.map((metric) => <th className="num" key={metric.name}>{metric.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {coverage.devices.map((device) => (
            <tr key={device.device_id}>
              <td className="mono">{device.device_id}</td>
              {metrics.map((metric) => <MetricCell key={metric.name} metric={device[metric.name]} />)}
            </tr>
          ))}
        </tbody>
      </table>
      {coverage.devices.map((device) => {
        const missed = metrics.filter((metric) => device[metric.name].missed.length > 0)
        if (missed.length === 0) return null
        return (
          <details className="scenario-coverage-missed" key={device.device_id}>
            <summary>Not exercised on <span className="mono">{device.device_id}</span></summary>
            <dl>
              {missed.map((metric) => (
                <div key={metric.name}>
                  <dt>{metric.label}</dt>
                  <dd className="mono">{device[metric.name].missed.join(', ')}</dd>
                </div>
              ))}
            </dl>
          </details>
        )
      })}
    </div>
  )
}
