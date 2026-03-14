# meshtastic-node-client

A Node.js client that connects to a Meshtastic mesh network via MQTT. It announces itself as a virtual node, sends and receives encrypted channel messages, and can be extended with plugins.

## How it works

Meshtastic devices (e.g. Heltec LoRa) can act as MQTT gateways: they forward RF mesh traffic to an MQTT broker and relay MQTT messages back to the RF mesh.
This client connects to that broker, participates in an AES-encrypted channel, and appears as a node in the Meshtastic app's node list.

```
Phone app ←BLE→ Heltec ←RF→ mesh ←MQTT→ [broker] ←MQTT→ this client
```

To start playing with this you'll need at least 2 Meshtastic nodes.
Node 1 connected to your local network, where you run this client.
Node 2 connected to your phone.
You can then use your phone to send messages using LoRa between the 2 Meshtastic nodes and let this client work its magic by creating useful plugins that are triggered by incoming messages or send messages based on other triggers.

Think of this client as a Lego plate where you can build Meshtastic features.

## Requirements

- Node.js 22+
- An MQTT broker reachable by both this client and a Meshtastic gateway device
- The gateway device must have **Downlink enabled** on the channel

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your broker URL, channel PSK, and node identity
```

## Configuration

All configuration is via environment variables in `.env`:

| Variable                | Description                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `MQTT_MODE`             | `private` (local broker) or `public` (mqtt.meshtastic.org)                                                                                      |
| `PRIVATE_MQTT_BROKER`   | Broker URL, e.g. `mqtt://localhost:1883`                                                                                                        |
| `PRIVATE_MQTT_USERNAME` | MQTT username (optional)                                                                                                                        |
| `PRIVATE_MQTT_PASSWORD` | MQTT password (optional)                                                                                                                        |
| `PUBLIC_MQTT_BROKER`    | Public broker URL                                                                                                                               |
| `PUBLIC_MQTT_USERNAME`  | Public broker username                                                                                                                          |
| `PUBLIC_MQTT_PASSWORD`  | Public broker password                                                                                                                          |
| `MQTT_ROOT_TOPIC`       | Root topic, e.g. `msh/US`                                                                                                                       |
| `CHANNEL_NAME`          | Channel name, e.g. `LongFast`                                                                                                                   |
| `CHANNEL_PSK`           | Base64-encoded channel PSK (`AQ==` = default LongFast key)                                                                                      |
| `NODE_ID`               | This node's ID as 8-char hex, e.g. `abcdef01`                                                                                                   |
| `NODE_LONG_NAME`        | Human-readable node name shown in the app                                                                                                       |
| `NODE_SHORT_NAME`       | Short name (≤4 chars) shown on the map                                                                                                          |
| `NODE_HW_MODEL`         | Hardware model number (0=UNSET, 255=PRIVATE_HW). See [HardwareModel](https://github.com/meshtastic/protobufs/blob/master/meshtastic/mesh.proto) |
| `DEDUP_WINDOW_MS`       | Dedup window in ms (default `30000`). Set to `0` to disable                                                                                     |

> **Note:** The public broker (`mqtt.meshtastic.org`) has a read-only ACL on
> `/2/e/` — published packets are silently dropped. Use a private broker for
> full bidirectional communication.

## npm scripts

| Script                     | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `npm start`                | Listen mode (headless); pass a message as argument to send it once  |
| `npm run chat`             | Interactive chat shell (protobuf mode)                              |
| `npm run chat:json`        | Interactive chat shell (JSON mode — uses `/2/json/` topic)          |
| `npm run chat:echo`        | Chat shell with echo plugin enabled                                 |
| `npm run chat:json:echo`   | JSON mode + echo plugin                                             |
| `npm run broker`           | Start a local Aedes MQTT broker (reads config from `.env`)          |
| `npm test`                 | Run unit tests                                                      |
| `npm run test:integration` | Run integration tests (requires local broker)                       |
| `npm run test:live`        | Run live tests against a real broker                                |
| `npm run send:json`        | Send a one-shot JSON message via `bin/send-json.js`                 |

### Local broker

The built-in broker is useful for development and for connecting a Heltec
device on your LAN without a cloud service:

```bash
npm run broker
# output shows the LAN IP and port to enter in the Heltec MQTT settings
```

### Sending a one-off message

```bash
node --import ./loader.js index.js "Hello mesh"
```

## Chat modes

The chat shell (`npm run chat`) supports two send modes:

- **Protobuf mode** (default) — encodes messages as `ServiceEnvelope` protobufs
  on the `/2/e/` topic path. Required for messages to reach RF devices.
- **JSON mode** (`--json` or `CHAT_JSON=1`) — sends messages as JSON on the
  `/2/json/` topic path. Useful for debugging or brokers without protobuf support.

A `✓` confirmation is printed when the gateway device ACKs a sent message.

## Plugins

Plugins live in `./plugins/*.js` and are loaded automatically at startup.
A plugin is enabled via the `--plugins=` flag or the `CHAT_ENABLED_PLUGINS` env var.

```bash
# enable one plugin
npm run chat -- --plugins=echo

# enable multiple plugins
node --import ./loader.js index.js --plugins=echo,gemini
```

```env
# .env — always enable certain plugins
CHAT_ENABLED_PLUGINS=echo,gemini
```

### Writing a plugin

Each plugin file must default-export a factory function and export a `metadata`
object with at least a `name` field (used for enablement checks):

```js
// plugins/my-plugin.js
export default function createMyPlugin(opts = {}) {
  // opts.sendJsonMode — true when --json flag is set

  return {
    name: 'my-plugin', // shown in startup log
    onMessage: async ({ event, client, sendJsonMode }) => {
      // event  — decoded incoming message (see event shape below)
      // client — MeshtasticClient instance (call client.sendText / client.sendJson)
    }
  }
}

export const metadata = {
  name: 'my-plugin',
  description: 'What this plugin does.'
}
```

Plugins can import from `src/` using bare specifiers (e.g. `import { createLogger } from 'src/log.js'`)
thanks to the ESM resolution hook loaded via `--import ./loader.js`.

### Event shape

```js
{
  from:      number,   // sender node ID (uint32)
  fromHex:   string,   // e.g. "!49b79878"
  to:        number,   // recipient node ID (0xffffffff = broadcast)
  packetId:  number,
  portnum:   number,   // PortNum enum value
  payload:   Buffer,
  channelId: string,
  gatewayId: string,
  source:    string,   // "protobuf" | "json"
  text:      string,   // present when portnum === TEXT_MESSAGE_APP
  user: {              // present when portnum === NODEINFO_APP
    id:        string,
    longName:  string,
    shortName: string,
  }
}
```

### Bundled plugins

| Plugin    | Description                                                    | Enable with          |
| --------- | -------------------------------------------------------------- | -------------------- |
| `echo`    | Echoes every received message back with an `ECHO:` prefix      | `--plugins=echo`     |
| `gemini`  | Sends trigger messages to Google Gemini and replies to channel | `--plugins=gemini`   |

See [GEMINI_PLUGIN.md](GEMINI_PLUGIN.md) for Gemini plugin setup and options.

### Disabling a plugin temporarily

Remove or rename the file so the loader skips it:

```bash
mv plugins/echo.js plugins/echo.js.disabled
```

Plugins that throw on load are skipped with a warning and do not crash the shell.

## Project structure

```
index.js          — CLI entry point (listen mode + interactive chat)
broker.js         — Local Aedes MQTT broker
loader.js         — Registers ESM resolution hook (--import ./loader.js)
hooks.js          — ESM hook: maps 'src/...' to project src/ directory
bin/send-json.js  — One-shot JSON message sender
src/
  client.js       — MeshtasticClient class
  crypto.js       — AES-CTR encrypt/decrypt, PSK expansion, channel hash
  protobufs.js    — Inline protobufjs schema (no .proto files needed)
  color.js        — ANSI terminal color helpers
  log.js          — createLogger factory for coloured prefix logging
plugins/
  echo.js         — Echo plugin (reflects messages back to channel)
  gemini.js       — Gemini AI plugin
test/             — Unit and integration tests
.env.example      — Configuration template
```
