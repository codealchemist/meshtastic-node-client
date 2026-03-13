import 'dotenv/config';
import MeshtasticClient from './src/client.js';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const nodeIdHex = requiredEnv('NODE_ID');
  const nodeId    = parseInt(nodeIdHex, 16);
  if (isNaN(nodeId)) throw new Error(`NODE_ID must be a hex string, got: "${nodeIdHex}"`);

  const pskBase64 = requiredEnv('CHANNEL_PSK');
  const psk       = Buffer.from(pskBase64, 'base64');

  const mode = (process.env.MQTT_MODE ?? 'public').toLowerCase()
  const pfx  = mode === 'private' ? 'PRIVATE' : 'PUBLIC'
  let mqttBroker   = process.env[`${pfx}_MQTT_BROKER`]   || ''
  const mqttUsername = process.env[`${pfx}_MQTT_USERNAME`] || ''
  const mqttPassword = process.env[`${pfx}_MQTT_PASSWORD`] || ''
  if (!mqttBroker) throw new Error(`${pfx}_MQTT_BROKER is not set`)
  if (!/^[a-z]+:\/\//i.test(mqttBroker)) mqttBroker = `mqtts://${mqttBroker}`
  console.log(`[meshtastic] mode: ${mode} (${mqttBroker})`)

  const dedupWindowMs = parseInt(process.env.DEDUP_WINDOW_MS ?? '30000', 10)

  const client = new MeshtasticClient({
    mqttBroker,
    mqttUsername,
    mqttPassword,
    rootTopic:     requiredEnv('MQTT_ROOT_TOPIC'),
    channelName:   requiredEnv('CHANNEL_NAME'),
    channelPSK:    psk,
    nodeId,
    nodeLongName:  requiredEnv('NODE_LONG_NAME'),
    nodeShortName: requiredEnv('NODE_SHORT_NAME'),
    hwModel:       parseInt(process.env.NODE_HW_MODEL ?? '0', 10),
    dedupWindowMs,
  });

  client.on('message', (event) => {
    const ts   = new Date().toISOString();
    const from = event.user ? `${event.user.longName} (${event.fromHex})` : event.fromHex;

    if (event.text !== undefined) {
      console.log(`[${ts}] TEXT from ${from}: ${event.text}`);
    } else if (event.user) {
      console.log(`[${ts}] NODEINFO from ${from} (short: ${event.user.shortName})`);
    } else {
      console.log(`[${ts}] PACKET from ${event.fromHex} portnum=${event.portnum} bytes=${event.payload.length}`);
    }
  });

  await client.connect();

  // Optionally send a message passed as a CLI argument
  const message = process.argv[2];
  if (message) {
    await client.sendText(message);
  }

  // Stay alive to receive messages
  console.log('[meshtastic] listening… (Ctrl-C to exit)');

  process.on('SIGINT', async () => {
    console.log('\n[meshtastic] disconnecting…');
    await client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[meshtastic] fatal:', err.message);
  process.exit(1);
});
