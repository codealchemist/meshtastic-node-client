import { randomBytes } from 'node:crypto'
import mqtt from 'mqtt'
import { encrypt, decrypt, channelHash } from './crypto.js'
import {
  ServiceEnvelope,
  MeshPacket,
  Data,
  User,
  PortNum
} from './protobufs.js'

const BROADCAST_ADDR = 0xffffffff
const DEFAULT_HOP_LIMIT = 3

/**
 * MeshtasticClient
 *
 * Connects to an MQTT broker and participates in a Meshtastic encrypted
 * channel. Call `connect()` to establish the connection; the client
 * will automatically announce itself with a NodeInfo packet, then
 * subscribe to incoming channel traffic.
 *
 * @example
 *   const client = new MeshtasticClient({ ... });
 *   await client.connect();
 *   client.on('message', ({ from, text }) => console.log(from, text));
 *   await client.sendText('Hello mesh!');
 */
export default class MeshtasticClient {
  /**
   * @param {object} opts
   * @param {string}  opts.mqttBroker      MQTT broker URL, e.g. "mqtt://localhost:1883"
   * @param {string}  [opts.mqttUsername]
   * @param {string}  [opts.mqttPassword]
   * @param {string}  opts.rootTopic       Root MQTT topic, e.g. "msh/US"
   * @param {string}  opts.channelName     Channel name, e.g. "LongFast"
   * @param {Buffer}  opts.channelPSK      Raw PSK bytes (1, 16, or 32 bytes)
   * @param {number}  opts.nodeId          Node ID as uint32
   * @param {string}  opts.nodeLongName    Human-readable node name
   * @param {string}  opts.nodeShortName   Short node name (≤ 4 chars)
   */
  constructor(opts) {
    this.mqttBroker = opts.mqttBroker
    this.mqttUsername = opts.mqttUsername
    this.mqttPassword = opts.mqttPassword
    this.rootTopic = opts.rootTopic
    this.channelName = opts.channelName
    this.psk = opts.channelPSK
    this.nodeId = opts.nodeId >>> 0
    this.nodeIdHex = this.nodeId.toString(16).padStart(8, '0')
    // Keep `gatewayId` as the canonical protobuf gateway id (`!<hex>`),
    // which receivers use to map NodeInfo to numeric node ids. For JSON
    // and MQTT-topic presentation prefer a short name when available via
    // `jsonSenderId` so we don't break NodeInfo mapping on remote devices.
    this.gatewayId = opts.gatewayId ?? `!${this.nodeIdHex}`
    this.jsonSenderId = opts.nodeShortName ?? this.gatewayId
    this.nodeLongName = opts.nodeLongName
    this.nodeShortName = opts.nodeShortName
    this.hwModel = opts.hwModel ?? 0

    this._handlers = {} // event → [handler]
    this._mqttClient = null
    this._dedupWindowMs = opts.dedupWindowMs ?? 0
    this._seen = new Map() // key: `${from}:${packetId}` → timestamp
    this._channelHash = channelHash(this.psk, this.channelName)
  }

  _isDuplicate(from, packetId) {
    if (!this._dedupWindowMs || packetId == null) return false
    const key = `${from}:${packetId}`
    const now = Date.now()
    // Evict stale entries
    for (const [k, ts] of this._seen) {
      if (now - ts > this._dedupWindowMs) this._seen.delete(k)
    }
    if (this._seen.has(key)) return true
    this._seen.set(key, now)
    return false
  }

  get _publishTopic() {
    return `${this.rootTopic}/2/e/${this.channelName}/${this.gatewayId}`
  }

  get _subscribeTopic() {
    return `${this.rootTopic}/2/e/${this.channelName}/#`
  }

  get _jsonPublishTopic() {
    return `${this.rootTopic}/2/json/${this.channelName}/${this.jsonSenderId}`
  }

  get _jsonSubscribeTopic() {
    return `${this.rootTopic}/2/json/${this.channelName}/#`
  }

  /** Register an event handler. Events: 'message', 'ack'. */
  on(event, handler) {
    ;(this._handlers[event] ??= []).push(handler)
  }

  _emit(event, payload) {
    for (const h of this._handlers[event] ?? []) {
      try {
        h(payload)
      } catch {
        /* don't let a bad handler crash us */
      }
    }
  }

  /**
   * Connect to the MQTT broker, subscribe to the channel, and announce
   * this node with a NodeInfo packet.
   * @returns {Promise<void>} resolves once connected and subscribed
   */
  connect() {
    return new Promise((resolve, reject) => {
      const mqttOpts = { clientId: this.gatewayId }
      if (this.mqttUsername) mqttOpts.username = this.mqttUsername
      if (this.mqttPassword) mqttOpts.password = this.mqttPassword

      console.log(
        `[meshtastic] connecting to ${this.mqttBroker} as ${this.gatewayId}…`
      )
      this._mqttClient = mqtt.connect(this.mqttBroker, mqttOpts)

      this._mqttClient.once('connect', async () => {
        console.log(`[meshtastic] connected`)

        // Wait for subscribe to confirm before announcing
        await new Promise((res, rej) => {
          this._mqttClient.subscribe(
            [this._subscribeTopic, this._jsonSubscribeTopic],
            err => (err ? rej(err) : res())
          )
        }).catch(reject)

        console.log(`[meshtastic] subscribed to ${this._subscribeTopic}`)
        console.log(`[meshtastic] subscribed to ${this._jsonSubscribeTopic}`)
        this._mqttClient.on('message', (topic, payload) => {
          if (topic.includes('/2/json/')) {
            this._handleJsonMessage(topic, payload)
          } else {
            this._handleMqttMessage(topic, payload)
          }
        })

        // Persistent error / disconnect logging
        this._mqttClient.on('error', err =>
          console.error('[meshtastic] MQTT error:', err.message)
        )
        this._mqttClient.on('offline', () =>
          console.warn('[meshtastic] broker offline / connection lost')
        )
        this._mqttClient.on('reconnect', () =>
          console.log('[meshtastic] reconnecting…')
        )

        await this.announce()
        resolve()
      })

      this._mqttClient.once('error', err =>
        reject(new Error(`MQTT connect failed: ${err.message}`))
      )
    })
  }

  /** Disconnect from the MQTT broker. */
  disconnect() {
    return new Promise(resolve => {
      if (this._mqttClient) this._mqttClient.end(false, {}, resolve)
      else resolve()
    })
  }

  /**
   * Broadcast a NodeInfo (User) packet so other nodes know we exist.
   * Called automatically on `connect()`; can also be called manually to refresh.
   */
  async announce() {
    const macaddr = Buffer.alloc(6, 0)
    macaddr.writeUInt32BE(this.nodeId, 2)

    const userBytes = User.encode(
      User.create({
        id: this.gatewayId,
        long_name: this.nodeLongName,
        short_name: this.nodeShortName,
        macaddr,
        hw_model: this.hwModel
      })
    ).finish()

    await this._sendData(PortNum.NODEINFO_APP, Buffer.from(userBytes), {
      wantResponse: true
    })
    console.log(
      `[meshtastic] announced as ${this.gatewayId} long="${this.nodeLongName}" short="${this.nodeShortName}" hw_model=${this.hwModel}`
    )
  }

  /**
   * Send a plain-text message to the channel broadcast address.
   * @param {string} text
   */
  async sendText(text) {
    const packetId = await this._sendData(
      PortNum.TEXT_MESSAGE_APP,
      Buffer.from(text, 'utf8'),
      { wantAck: true }
    )
    // console.log(`[meshtastic] sent: ${text}`)
    return packetId
  }

  /**
   * Send a text message as Meshtastic JSON format on the /2/json/ topic path.
   * Some brokers and devices accept JSON messages without requiring protobuf.
   * @param {string} text
   */
  async sendJson(text) {
    const packetId = randomBytes(4).readUInt32LE(0)
    const msg = JSON.stringify({
      from: this.nodeId >>> 0,
      to: 0xffffffff,
      id: packetId,
      type: 'text',
      channel: this._channelHash,
      payload: {
        text,
        node: {
          id: this.gatewayId,
          longname: this.nodeLongName,
          shortname: this.nodeShortName,
          hw_model: this.hwModel
        }
      },
      sender: this.jsonSenderId
    })
    await this._publish(this._jsonPublishTopic, Buffer.from(msg))
    // console.log(`[meshtastic] sent JSON: ${text}`)
  }

  // ── private ───────────────────────────────────────────────────────────────

  /** Send a ROUTING_APP ACK for a received packet. */
  async _sendAck(to, requestId) {
    // Routing { error_reason: NONE } encodes as field 3, varint 0 → 0x18 0x00
    const routingBytes = Buffer.from([0x18, 0x00])
    await this._sendData(PortNum.ROUTING_APP, routingBytes, { to, requestId })
  }

  /** Encode, encrypt, and publish a Data payload. */
  async _sendData(
    portnum,
    payload,
    {
      wantResponse = false,
      to = BROADCAST_ADDR,
      requestId = 0,
      wantAck = false
    } = {}
  ) {
    const data = Data.create({
      portnum,
      payload,
      want_response: wantResponse,
      ...(requestId ? { request_id: requestId } : {})
    })
    const packetId = randomBytes(4).readUInt32LE(0)

    // When no PSK is configured send an unencrypted packet (decoded field),
    // matching devices that have "encryption disabled" on their channel.
    let packetFields
    if (this.psk && this.psk.length > 0) {
      const dataBytes = Data.encode(data).finish()
      const encrypted = encrypt(
        Buffer.from(dataBytes),
        this.psk,
        packetId,
        this.nodeId
      )
      packetFields = { encrypted: Buffer.from(encrypted) }
    } else {
      packetFields = { decoded: data }
    }

    const packet = MeshPacket.create({
      from: this.nodeId,
      to,
      channel: this._channelHash,
      ...packetFields,
      id: packetId,
      hop_limit: DEFAULT_HOP_LIMIT,
      hop_start: DEFAULT_HOP_LIMIT,
      want_ack: wantAck,
      via_mqtt: true
    })

    const envelope = ServiceEnvelope.create({
      packet,
      channel_id: this.channelName,
      gateway_id: this.gatewayId
    })

    const envelopeBytes = ServiceEnvelope.encode(envelope).finish()
    await this._publish(this._publishTopic, Buffer.from(envelopeBytes))
    return packetId
  }

  _publish(topic, payload) {
    return new Promise((resolve, reject) => {
      this._mqttClient.publish(topic, payload, { qos: 1 }, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  _handleMqttMessage(_topic, payload) {
    let envelope
    try {
      envelope = ServiceEnvelope.decode(payload)
    } catch {
      return // not a valid ServiceEnvelope, skip silently
    }

    const packet = envelope.packet
    if (!packet) return

    // Ignore our own transmissions
    if (packet.from >>> 0 === this.nodeId) return

    let dataBytes

    if (
      packet.payload_variant === 'encrypted' &&
      packet.encrypted &&
      packet.encrypted.length > 0
    ) {
      try {
        dataBytes = decrypt(
          Buffer.from(packet.encrypted),
          this.psk,
          packet.id >>> 0,
          packet.from >>> 0
        )
      } catch {
        return // decryption failed — different PSK or corrupted
      }
    } else if (packet.payload_variant === 'decoded' && packet.decoded) {
      dataBytes = Data.encode(packet.decoded).finish()
    } else {
      return
    }

    // ACK unicast packets after successful decode, before the dedup check
    // so retransmits also get ACKed. Skip broadcasts (0xffffffff) —
    // Meshtastic doesn't use ACKs for channel messages.
    if (packet.id && packet.to >>> 0 !== BROADCAST_ADDR) {
      this._sendAck(packet.from >>> 0, packet.id >>> 0).catch(() => {})
    }

    if (this._isDuplicate(packet.from >>> 0, packet.id >>> 0)) return

    let data
    try {
      data = Data.decode(dataBytes)
    } catch {
      return
    }

    const event = {
      from: packet.from >>> 0,
      fromHex: `!${(packet.from >>> 0).toString(16).padStart(8, '0')}`,
      to: packet.to >>> 0,
      packetId: packet.id >>> 0,
      portnum: data.portnum,
      payload: Buffer.from(data.payload),
      channelId: envelope.channel_id,
      gatewayId: envelope.gateway_id
    }

    if (data.portnum === PortNum.ROUTING_APP) {
      const requestId = data.request_id >>> 0
      if (requestId) {
        this._emit('ack', {
          requestId,
          from: event.from,
          fromHex: event.fromHex
        })
      }
      return
    }

    if (data.portnum === PortNum.TEXT_MESSAGE_APP) {
      event.text = event.payload.toString('utf8')
    }

    if (data.portnum === PortNum.NODEINFO_APP) {
      try {
        const user = User.decode(data.payload)
        event.user = {
          id: user.id,
          longName: user.long_name,
          shortName: user.short_name
        }
      } catch {
        /* ignore malformed user */
      }
    }

    this._emit('message', event)
  }

  _handleJsonMessage(topic, payload) {
    let msg
    try {
      msg = JSON.parse(payload.toString('utf8'))
    } catch {
      return
    }

    // Ignore our own transmissions
    if (msg.from >>> 0 === this.nodeId) return

    if (this._isDuplicate(msg.from >>> 0, msg.id >>> 0)) return

    const fromId = msg.from >>> 0

    // Resolve portnum — handle all observed Meshtastic JSON type variants:
    //   'sendtext'         — our own format and some firmware versions
    //   'text'             — Heltec V4 firmware
    //   'TEXT_MESSAGE_APP' — enum-name format
    //   undefined + bare payload — old firmware (no type field)
    const isText =
      msg.type === 'sendtext' ||
      msg.type === 'text' ||
      msg.type === 'TEXT_MESSAGE_APP' ||
      (msg.type === undefined && msg.payload !== undefined)
    const isNodeInfo = msg.type === 'nodeinfo' || msg.type === 'NODEINFO_APP'

    // Extract text — payload may be: {text: "..."}, a bare string, or a number
    const rawText = isText
      ? typeof msg.payload === 'object' && msg.payload !== null
        ? String(msg.payload.text ?? '')
        : String(msg.payload ?? '')
      : undefined

    const event = {
      from: fromId,
      fromHex: `!${fromId.toString(16).padStart(8, '0')}`,
      to: msg.to >>> 0,
      packetId: msg.id >>> 0,
      portnum: isText
        ? PortNum.TEXT_MESSAGE_APP
        : isNodeInfo
          ? PortNum.NODEINFO_APP
          : 0,
      payload: Buffer.from(rawText ?? '', 'utf8'),
      channelId: this.channelName,
      gatewayId: msg.sender ?? topic.split('/').pop(),
      source: 'json'
    }

    if (isText && rawText !== undefined) {
      event.text = rawText
    }

    if (isNodeInfo && msg.payload) {
      event.user = {
        id: msg.payload.id,
        longName: msg.payload.longname,
        shortName: msg.payload.shortname
      }
    }

    this._emit('message', event)
  }
}
