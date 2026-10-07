export type DigitalLogicLevel = 0 | 1 | -1 // -1 is high-impedance / idle

export interface WaveformSample {
  timeNs: number
  value: DigitalLogicLevel
}

export type ProtocolPacketType =
  | 'start'
  | 'stop'
  | 'address'
  | 'data'
  | 'ack'
  | 'nack'
  | 'control'
  | 'error'
  | 'edge'

export interface ProtocolPacket {
  id: string
  transactionId?: number
  bus: string
  deviceId: string
  channelId?: string
  startTimeNs: number
  endTimeNs: number
  type: ProtocolPacketType
  label: string
  detail?: string
  byte?: number
  hex?: string
  bits?: number[]
}

export interface WaveformChannel {
  id: string
  name: string
  bus: string
  deviceId: string
  pinType: string
  color: string
  visible: boolean
  samples: WaveformSample[]
  packets: ProtocolPacket[]
}

export interface TimingCursorState {
  cursorANs: number | null
  cursorBNs: number | null
}

export interface DeltaMeasurement {
  timeANs: number | null
  timeBNs: number | null
  deltaNs: number | null
  frequencyHz: number | null
}

export interface WaveformTimelineViewport {
  startNs: number
  endNs: number
  totalDurationNs: number
  zoomLevel: number // 1 = fit, >1 zoomed in
}
