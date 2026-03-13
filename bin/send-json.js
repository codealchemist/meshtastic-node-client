#!/usr/bin/env node
import 'dotenv/config'
import MeshtasticClient from '../src/client.js'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function main() {
  const nodeIdHex = requiredEnv('NODE_ID')
  const nodeId = parseInt(nodeIdHex, 16)
  if (isNaN(nodeId))
    throw new Error(`NODE_ID must be a hex string, got: "${nodeIdHex}"`)

  const pskBase64 = requiredEnv('CHANNEL_PSK')
  const psk = Buffer.from(pskBase64, 'base64')

  const mode = (process.env.MQTT_MODE ?? 'public').toLowerCase()
  const pfx = mode === 'private' ? 'PRIVATE' : 'PUBLIC'
  let mqttBroker = process.env[`${pfx}_MQTT_BROKER`] || ''
  const mqttUsername = process.env[`${pfx}_MQTT_USERNAME`] || ''
  const mqttPassword = process.env[`${pfx}_MQTT_PASSWORD`] || ''
  if (!mqttBroker) throw new Error(`${pfx}_MQTT_BROKER is not set`)
  if (!/^[a-z]+:\/\//i.test(mqttBroker)) mqttBroker = `mqtts://${mqttBroker}`

  const client = new MeshtasticClient({
    mqttBroker,
    mqttUsername,
    mqttPassword,
    rootTopic: requiredEnv('MQTT_ROOT_TOPIC'),
    channelName: requiredEnv('CHANNEL_NAME'),
    channelPSK: psk,
    nodeId,
    nodeLongName: requiredEnv('NODE_LONG_NAME'),
    nodeShortName: requiredEnv('NODE_SHORT_NAME'),
    hwModel: parseInt(process.env.NODE_HW_MODEL ?? '0', 10)
  })

  const message = process.argv[2]
  if (!message) {
    console.error('Usage: send-json "message text"')
    process.exit(2)
  }

  await client.connect()
  await client.sendJson(message)
  console.log('[meshtastic] sent JSON message')
  await client.disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error('[meshtastic] fatal:', err.message)
  process.exit(1)
})
