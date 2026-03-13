/**
 * Local MQTT broker using Aedes.
 * Reads port and credentials from PRIVATE_MQTT_* in .env.
 *
 * Usage: npm run broker
 */
import 'dotenv/config'
import aedes from 'aedes'
import net from 'node:net'
import os from 'node:os'

// Parse port from PRIVATE_MQTT_BROKER URL, fall back to 1883
const brokerUrl  = process.env.PRIVATE_MQTT_BROKER ?? 'mqtt://localhost:1883'
const parsedUrl  = new URL(brokerUrl)
const port       = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 1883
const username   = process.env.PRIVATE_MQTT_USERNAME || ''
const password   = process.env.PRIVATE_MQTT_PASSWORD || ''
const authNeeded = !!username

const broker = aedes({
  authenticate: authNeeded
    ? (client, user, pass, done) => {
        const ok = user === username && pass?.toString() === password
        done(null, ok)
      }
    : undefined,
})

const server = net.createServer(broker.handle)

server.listen(port, () => {
  const localIPs = Object.values(os.networkInterfaces())
    .flat()
    .filter(n => n?.family === 'IPv4' && !n.internal)
    .map(n => n.address)

  const primaryIP = localIPs[0] ?? '127.0.0.1'

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║           Meshtastic local MQTT broker           ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log('')
  console.log('  Listening on:')
  console.log(`    mqtt://localhost:${port}          (this machine)`)
  for (const ip of localIPs) {
    console.log(`    mqtt://${ip}:${port}    (LAN / Heltec)`)
  }
  if (authNeeded) {
    console.log(`  Auth: username="${username}" password="***"`)
  } else {
    console.log('  Auth: none (anonymous access)')
  }
  console.log('')
  console.log('  ── Heltec device settings ─────────────────────────')
  console.log(`  Broker address : ${primaryIP}`)
  console.log(`  Port           : ${port}`)
  console.log(`  Username       : ${username || '(leave blank)'}`)
  console.log(`  Password       : ${password ? '(set)' : '(leave blank)'}`)
  console.log('  TLS            : disabled')
  console.log('')
  console.log('  Ctrl-C to stop')
  console.log('──────────────────────────────────────────────────────')
})

broker.on('client', (client) => {
  console.log(`[+] connected    ${client.id}`)
})

broker.on('clientDisconnect', (client) => {
  console.log(`[-] disconnected ${client.id}`)
})

broker.on('subscribe', (subs, client) => {
  for (const s of subs) {
    console.log(`[~] subscribe    ${client.id}  →  ${s.topic}`)
  }
})

broker.on('publish', (packet, client) => {
  if (!client) return // system messages
  console.log(`[>] publish      ${client.id}  →  ${packet.topic}  (${packet.payload.length} B)`)
})

broker.on('error', (err) => {
  console.error('[broker error]', err.message)
})

process.on('SIGINT', () => {
  console.log('\n[broker] shutting down…')
  broker.close(() => {
    server.close(() => process.exit(0))
  })
})
