import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import MeshtasticClient from './src/client.js'
import { dim, green, yellow } from './src/color.js'
import { createLogger, setLogWriter } from './src/log.js'

const log = createLogger('chat', green)

const sendJsonMode =
  process.argv.includes('--json') || process.env.CHAT_JSON === '1'
const listenMode = process.argv.includes('--listen')

// First non-flag argument is an optional one-shot message to send on connect
const initMessage = process.argv.slice(2).find(a => !a.startsWith('--'))

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

/**
 * Plugins are enabled by concatenating their name to the CHAT_ENABLED_PLUGINS env var,
 * separated by commas.
 * Or by passing them as --plugins=echo,gemini,... on the command line.
 * No plugins are enabled by default.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isPluginEnabled(name) {
  if (!name) return false

  const env = process.env.CHAT_ENABLED_PLUGINS || ''
  const cliIndex = process.argv.findIndex(arg => arg.startsWith('--plugins='))
  const cli = cliIndex >= 0 ? process.argv[cliIndex].split('=')[1] : ''

  const enabledPlugins = env
    .split(',')
    .concat(cli.split(','))
    .map(s => s.trim())
    .filter(Boolean)

  return enabledPlugins.includes(name)
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

  // Load plugins from ./plugins/*.js
  const plugins = []
  const pluginsDir = new URL('./plugins/', import.meta.url)
  if (fs.existsSync(pluginsDir.pathname)) {
    for (const file of fs.readdirSync(pluginsDir.pathname)) {
      if (!file.endsWith('.js')) continue
      try {
        const mod = await import(
          new URL(path.posix.join('./plugins', file), import.meta.url).href
        )

        // Get plugin metadata to check if it's enabled, then create plugin instance
        const metadata = mod.metadata ?? {}

        const factory = mod.default ?? mod
        const enabled = isPluginEnabled(metadata?.name)
        if (!enabled) {
          log(`plugin "${metadata?.name ?? file}" is disabled, skipping`)
          continue
        }
        const plugin =
          typeof factory === 'function' ? factory({ sendJsonMode }) : factory
        plugins.push(plugin)
      } catch (err) {
        log.error('plugin load failed:', file, err?.message ?? err)
      }
    }
  }

  const enabled = plugins.map(p => p?.name ?? '<unnamed>').filter(Boolean)
  if (enabled.length > 0) log(`plugins enabled: ${enabled.join(', ')}`)

  // ── readline setup (interactive mode only) ──────────────────────────────
  let rl = null
  const pending = new Map() // packetId → text, for delivery tick

  function printLine(line) {
    if (rl) {
      process.stdout.write('\r\x1b[K')
      console.log(line)
      rl.prompt(true)
    } else {
      console.log(line)
    }
  }

  if (!listenMode) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    setLogWriter(line => {
      process.stdout.write('\r\x1b[K')
      console.log(line)
      rl.prompt(true)
    })
    log(
      `ready — type a message and press Enter, Ctrl-C to quit${sendJsonMode ? ' (JSON mode)' : ''}\n`
    )
    rl.setPrompt(sendJsonMode ? '> (json) ' : '> ')
    rl.prompt()

    client.on('ack', ({ requestId, fromHex }) => {
      if (!pending.has(requestId)) return
      pending.delete(requestId)
      printLine(`${dim(`(${fromHex})`)}  ${green('✓')}`)
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
          log.error(err.message)
        }
      }
      rl.prompt()
    })

    let closing = false
    const shutdown = async () => {
      if (closing) return
      closing = true
      log('\ndisconnecting…')
      await client.disconnect()
      process.exit(0)
    }

    rl.on('close', shutdown)
    process.on('SIGINT', () => rl.close())
  } else {
    let closing = false
    process.on('SIGINT', async () => {
      if (closing) return
      closing = true
      log('\ndisconnecting…')
      await client.disconnect()
      process.exit(0)
    })
    log('listening… (Ctrl-C to exit)')
  }

  // ── message display + plugin dispatch ───────────────────────────────────
  client.on('message', event => {
    const ts = new Date().toLocaleTimeString()
    const fromLong = event.user?.longName ?? event.gatewayId ?? event.fromHex
    const short = event.user?.shortName
    const nameLabel =
      short ?? event.user?.longName ?? event.gatewayId ?? event.fromHex
    const namePrefix = nameLabel ? `[${nameLabel}] ` : ''

    let line
    if (event.text !== undefined) {
      if (nameLabel && fromLong && nameLabel === fromLong) {
        line = `${dim(`[${ts}]`)} ${namePrefix}${event.text}`
      } else {
        line = `${dim(`[${ts}]`)} ${namePrefix}${fromLong}: ${event.text}`
      }
    } else if (event.user) {
      if (nameLabel && fromLong && nameLabel === fromLong) {
        line = `${dim(`[${ts}]`)} ${yellow('**')} ${namePrefix}is on the channel`
      } else {
        line = `${dim(`[${ts}]`)} ${yellow('**')} ${namePrefix}${fromLong} is on the channel`
      }
    } else {
      return
    }

    printLine(line)

    for (const p of plugins) {
      try {
        if (p && typeof p.onMessage === 'function') {
          p.onMessage({ event, client, sendJsonMode }).catch(() => {})
        }
      } catch {
        // ignore plugin errors
      }
    }
  })

  // ── one-shot message ─────────────────────────────────────────────────────
  if (initMessage) {
    try {
      if (sendJsonMode) await client.sendJson(initMessage)
      else await client.sendText(initMessage)
    } catch (err) {
      log.error(err.message)
    }
  }
}

main().catch(err => {
  log.error('fatal:', err.message)
  process.exit(1)
})
