import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import MeshtasticClient from './src/client.js'

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

  const psk = Buffer.from(requiredEnv('CHANNEL_PSK'), 'base64')

  const mode = (process.env.MQTT_MODE ?? 'public').toLowerCase()
  const pfx = mode === 'private' ? 'PRIVATE' : 'PUBLIC'
  let mqttBroker = process.env[`${pfx}_MQTT_BROKER`] || ''
  const mqttUsername = process.env[`${pfx}_MQTT_USERNAME`] || ''
  const mqttPassword = process.env[`${pfx}_MQTT_PASSWORD`] || ''
  if (!mqttBroker) throw new Error(`${pfx}_MQTT_BROKER is not set`)
  if (!/^[a-z]+:\/\//i.test(mqttBroker)) mqttBroker = `mqtts://${mqttBroker}`

  const dedupWindowMs = parseInt(process.env.DEDUP_WINDOW_MS ?? '30000', 10)

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
    hwModel: parseInt(process.env.NODE_HW_MODEL ?? '0', 10),
    dedupWindowMs
  })

  await client.connect()
  const sendJsonMode =
    process.argv.includes('--json') || process.env.CHAT_JSON === '1'
  const echoMode =
    process.argv.includes('--echo') || process.env.CHAT_ECHO === '1'
  console.log(
    `[chat] ready — type a message and press Enter, Ctrl-C to quit${sendJsonMode ? ' (JSON mode)' : ''}\n`
  )

  // Load chat plugins from ./plugins/*.js — each plugin should default-export
  // a factory: `export default function(opts) { return { onMessage: async ({event, client, sendJsonMode}) => {} } }`
  const plugins = []
  const pluginsDir = new URL('./plugins/', import.meta.url)
  if (fs.existsSync(pluginsDir.pathname)) {
    for (const file of fs.readdirSync(pluginsDir.pathname)) {
      if (!file.endsWith('.js')) continue
      try {
        const mod = await import(
          new URL(path.posix.join('./plugins', file), import.meta.url).href
        )
        const factory = mod.default ?? mod
        const plugin =
          typeof factory === 'function'
            ? factory({ echoMode, sendJsonMode })
            : factory
        plugins.push(plugin)
      } catch (err) {
        console.error('[chat] plugin load failed:', file, err?.message ?? err)
      }
    }
  }

  const enabled = plugins.map(p => p?.name ?? '<unnamed>').filter(Boolean)
  if (enabled.length > 0)
    console.log(`[chat] plugins enabled: ${enabled.join(', ')}`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  rl.setPrompt(sendJsonMode ? '> (json) ' : '> ')
  rl.prompt()

  // packetId → sent text, for delivery tick display
  const pending = new Map()

  function printLine(line) {
    process.stdout.write('\r\x1b[K')
    console.log(line)
    rl.prompt(true)
  }

  client.on('ack', ({ requestId, fromHex }) => {
    if (!pending.has(requestId)) return
    const text = pending.get(requestId)
    pending.delete(requestId)
    printLine(`(${fromHex})  ✓ `)
    // process.stdout.write(' ✓ ')
  })

  client.on('message', event => {
    const ts = new Date().toLocaleTimeString()
    const fromLong = event.user?.longName ?? event.gatewayId ?? event.fromHex
    const short = event.user?.shortName
    const nameLabel =
      short ?? event.user?.longName ?? event.gatewayId ?? event.fromHex
    const namePrefix = nameLabel ? `[${nameLabel}] ` : ''

    let line
    if (event.text !== undefined) {
      // If the bracket label is the same as the long name, avoid duplicating it.
      if (nameLabel && fromLong && nameLabel === fromLong) {
        line = `[${ts}] ${namePrefix}${event.text}`
      } else {
        line = `[${ts}] ${namePrefix}${fromLong}: ${event.text}`
      }
    } else if (event.user) {
      if (nameLabel && fromLong && nameLabel === fromLong) {
        line = `[${ts}] ** ${namePrefix}is on the channel`
      } else {
        line = `[${ts}] ** ${namePrefix}${fromLong} is on the channel`
      }
    } else {
      return
    }

    printLine(line)

    // Dispatch to plugins
    for (const p of plugins) {
      try {
        if (p && typeof p.onMessage === 'function') {
          // plugin handles sending as needed
          p.onMessage({ event, client, sendJsonMode }).catch(() => {})
        }
      } catch {
        // ignore plugin errors
      }
    }
  })

  rl.on('line', async line => {
    line = line.trim()
    if (line) {
      try {
        if (sendJsonMode) {
          await client.sendJson(line)
        } else {
          const packetId = await client.sendText(line)
          pending.set(packetId, line)
        }
      } catch (err) {
        console.error(`[error] ${err.message}`)
      }
    }
    rl.prompt()
  })

  rl.on('close', async () => {
    console.log('\n[chat] disconnecting…')
    await client.disconnect()
    process.exit(0)
  })

  process.on('SIGINT', () => rl.close())
}

main().catch(err => {
  console.error('[chat] fatal:', err.message)
  process.exit(1)
})
