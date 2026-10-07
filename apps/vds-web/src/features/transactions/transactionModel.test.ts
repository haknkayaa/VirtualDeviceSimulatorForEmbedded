import { describe, expect, it } from 'vitest'

import { buildLiveTransactions } from './transactionModel'
import type { DomainEvent } from '../../types/events'

function domainEvent(
  eventId: number,
  payload: DomainEvent['payload'],
): DomainEvent {
  return {
    event_id: eventId,
    event_type: payload.kind,
    timestamp_virtual_ns: eventId * 10,
    timestamp_wall_ns: eventId * 100,
    device_id: 'flash-0',
    payload,
  }
}

describe('live transaction event pairing', () => {
  it('pairs started and completed events without losing byte payloads', () => {
    const result = buildLiveTransactions([
      domainEvent(1, { kind: 'transaction_started', transaction_id: 4, request: [0x9f, 0] }),
      domainEvent(2, { kind: 'transaction_completed', transaction_id: 4, response: [0, 0xef], result: 'success', error_code: null }),
    ], [{ id: 'flash-0', bus: 'spi', state: 'ready' }])

    expect(result).toEqual([expect.objectContaining({
      id: 'flash-0:4',
      busType: 'spi',
      request: [0x9f, 0],
      response: [0, 0xef],
      status: 'success',
    })])
  })

  it('keeps a replayed completion with no start as a partial transaction', () => {
    const result = buildLiveTransactions([
      domainEvent(3, { kind: 'transaction_completed', transaction_id: 8, response: [], result: 'error', error_code: 'device_busy' }),
    ], [])

    expect(result[0]).toMatchObject({
      request: [],
      status: 'error',
      errorCode: 'device_busy',
      busType: 'unknown',
    })
  })

  it('pairs GPIO line-state exchanges as GPIO transactions', () => {
    const started = domainEvent(4, {
      kind: 'transaction_started',
      transaction_id: 9,
      request: [1, 0, 1],
    })
    const completed = domainEvent(5, {
      kind: 'transaction_completed',
      transaction_id: 9,
      response: [1, 1, 0],
      result: 'success',
      error_code: null,
    })
    started.device_id = 'gpio-bank'
    completed.device_id = 'gpio-bank'

    const result = buildLiveTransactions(
      [started, completed],
      [{ id: 'gpio-bank', bus: 'gpio', state: null }],
    )

    expect(result[0]).toMatchObject({
      busType: 'gpio',
      request: [1, 0, 1],
      response: [1, 1, 0],
      status: 'success',
    })
  })

  it('pairs runtime-injected transactions without an adapter id sequentially per device', () => {
    const result = buildLiveTransactions([
      domainEvent(10, { kind: 'transaction_started', transaction_id: null, request: [0x9f] }),
      domainEvent(11, { kind: 'transaction_completed', transaction_id: null, response: [0x20, 0xba, 0x19], result: 'success', error_code: null }),
      domainEvent(12, { kind: 'transaction_started', transaction_id: null, request: [0x06] }),
      domainEvent(13, { kind: 'transaction_completed', transaction_id: null, response: [], result: 'success', error_code: null }),
      domainEvent(14, { kind: 'transaction_completed', transaction_id: null, response: [1], result: 'success', error_code: null }),
    ], [{ id: 'flash-0', bus: 'spi', state: 'ready' }])

    expect(result).toEqual([
      expect.objectContaining({ id: 'flash-0:ev12', transactionId: 12, request: [0x06], response: [], status: 'success' }),
      expect.objectContaining({ id: 'flash-0:ev10', transactionId: 10, request: [0x9f], response: [0x20, 0xba, 0x19], status: 'success' }),
    ])
  })
})
