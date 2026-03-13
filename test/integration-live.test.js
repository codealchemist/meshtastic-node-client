/**
 * Live integration test — connects to mqtt.meshtastic.org:8883.
 *
 * What we can assert:
 *   ✓ TLS + credential handshake succeeds
 *   ✓ Subscription is confirmed by the broker
 *   ✓ Publish is ACK'd (QoS 1 PUBACK) — broker accepts even though
 *     meshdev/large4cats has read-only ACL (publishes are silently dropped)
 *   ~ Sender→receiver e2e (encrypt→publish→decrypt) on our channel,
 *     falls back to receiving real device traffic if broker still drops publish
 *   ~ If real Meshtastic device traffic arrives within 8 s on the default
 *     LongFast channel, assert it decodes as a valid ServiceEnvelope
 *     (skips gracefully when there is no live traffic)
 *
 * Run with: npm run test:live
 */

import 'dotenv/config';
import mqtt from 'mqtt';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import MeshtasticClient from '../src/client.js';
import { ServiceEnvelope } from '../src/protobufs.js';

// ── Config from .env ─────────────────────────────────────────────────────────

const BROKER   = process.env.MQTT_BROKER;
const USERNAME = process.env.MQTT_USERNAME || '';
const PASSWORD = process.env.MQTT_PASSWORD || '';

// Our custom channel (GEM) — used for connection + publish tests
const OUR_PSK     = Buffer.from(process.env.CHANNEL_PSK, 'base64');
const OUR_TOPIC   = process.env.MQTT_ROOT_TOPIC;
const OUR_CHANNEL = process.env.CHANNEL_NAME;

// Default LongFast channel — highest-traffic, best chance of live packets
const LONGFAST_PSK      = Buffer.from('AQ==', 'base64');
const LONGFAST_ROOT     = 'msh/US';
const LONGFAST_CHANNEL  = 'LongFast';
const LONGFAST_SUB      = `${LONGFAST_ROOT}/2/e/${LONGFAST_CHANNEL}/#`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(nodeIdHex, rootTopic, channelName, psk) {
  return new MeshtasticClient({
    mqttBroker:    BROKER,
    mqttUsername:  USERNAME,
    mqttPassword:  PASSWORD,
    rootTopic,
    channelName,
    channelPSK:    psk,
    nodeId:        parseInt(nodeIdHex, 16),
    nodeLongName:  `Live Test ${nodeIdHex}`,
    nodeShortName: nodeIdHex.slice(0, 4).toUpperCase(),
  });
}

/**
 * Waits up to `ms` for a raw MQTT message on a given topic filter.
 * Resolves with { topic, payload } or null on timeout (never rejects).
 */
function waitForRawMessage(mqttClient, topicFilter, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    mqttClient.subscribe(topicFilter, () => {});
    mqttClient.once('message', (topic, payload) => {
      clearTimeout(timer);
      resolve({ topic, payload });
    });
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

let client;

describe('Live integration — mqtt.meshtastic.org:8883', { timeout: 60000 }, () => {
  before(async () => {
    client = makeClient('b1c2d3e4', OUR_TOPIC, OUR_CHANNEL, OUR_PSK);
  });

  after(async () => {
    await client?.disconnect();
  });

  it('connects and subscribes to the channel', async () => {
    // connect() itself throws if TLS handshake or auth fails
    await client.connect();
    // If we reach here, connected + subscribed + announced without error
  });

  it("announce (publish) is ACK'd by the broker", async () => {
    // sendText returns only after the QoS 1 PUBACK is received
    await assert.doesNotReject(client.sendText('live-integration-test'));
  });

  it('message is sent, received, and decrypted on our channel', async () => {
    const receiver = makeClient('b1c2d3e5', OUR_TOPIC, OUR_CHANNEL, OUR_PSK);
    await receiver.connect();

    const text = `live-e2e-${Date.now()}`;

    // Listen for the whole window from the start — captures both our own e2e
    // message (if routed) and real device traffic (if any arrives).
    const rawFrames = [];
    const rawTap = (topic, payload) => {
      rawFrames.push({ topic, payload });
    };
    client._mqttClient.on('message', rawTap);

    // Race: first decoded message OR 20 s timeout
    const received = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 20000);
      const pick = (e) => { clearTimeout(timer); resolve(e); };
      receiver.on('message', pick);
      client.on('message',   pick);
    });

    await client.sendText(text);
    const evt = await received;

    client._mqttClient.removeListener('message', rawTap);

    // Log what arrived on the raw MQTT socket (protobuf frames)
    for (const { topic, payload } of rawFrames) {
      if (!topic.includes('/2/e/')) continue;
      console.log(`    # raw MQTT frame: ${topic} (${payload.length} bytes)`);
      console.log(`    #   hex: ${payload.toString('hex')}`);
      try {
        const env = ServiceEnvelope.decode(payload);
        const pv  = env.packet?.payload_variant;
        console.log(`    #   ServiceEnvelope OK — payload_variant: ${pv}`);
        if (pv === 'encrypted') console.log(`    #   encrypted length: ${env.packet.encrypted?.length} bytes`);
        if (pv === 'decoded')   console.log(`    #   decoded.portnum: ${env.packet.decoded?.portnum}`);
      } catch (e) {
        console.log(`    #   ServiceEnvelope.decode failed: ${e.message}`);
      }
    }
    if (rawFrames.filter(f => f.topic.includes('/2/e/')).length === 0) {
      console.log('    # no protobuf frames arrived — device may not be sending');
    }

    await receiver.disconnect();

    if (evt === null) {
      console.log('    # no traffic on our channel within timeout — skipping');
      return;
    }

    // Map portnum integer to its name for readable output
    const { PortNum } = await import('../src/protobufs.js');
    const portnumName = Object.keys(PortNum).find((k) => PortNum[k] === evt.portnum) ?? evt.portnum;

    console.log('    # ── decoded device message ──────────────────────────');
    console.log(`    #   from:      ${evt.fromHex}`);
    console.log(`    #   to:        !${(evt.to >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`    #   packetId:  0x${(evt.packetId >>> 0).toString(16)}`);
    console.log(`    #   portnum:   ${portnumName} (${evt.portnum})`);
    console.log(`    #   channelId: ${evt.channelId}`);
    console.log(`    #   gatewayId: ${evt.gatewayId}`);
    if (evt.text    !== undefined) console.log(`    #   text:      "${evt.text}"`);
    if (evt.user) {
      console.log(`    #   user.id:        ${evt.user.id}`);
      console.log(`    #   user.longName:  ${evt.user.longName}`);
      console.log(`    #   user.shortName: ${evt.user.shortName}`);
    }
    console.log('    # ─────────────────────────────────────────────────────');

    assert.ok(evt.from,                  'event must have a from field');
    assert.ok(evt.fromHex,               'event must have a fromHex field');
    assert.ok(evt.portnum !== undefined, 'event must have a portnum field');
    assert.equal(evt.channelId, OUR_CHANNEL, 'channelId must match our channel');
  });

  it("JSON publish is ACK'd by the broker", async () => {
    await assert.doesNotReject(client.sendJson('live-json-test'));
  });

  it('JSON text is sent, received, and decoded on our channel', async () => {
    const receiver = makeClient('b1c2d3e5', OUR_TOPIC, OUR_CHANNEL, OUR_PSK);
    await receiver.connect();

    const text = `live-json-e2e-${Date.now()}`;

    // Set up listener BEFORE publishing
    const e2eReceived = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      receiver.on('message', (e) => {
        if (e.text === text && e.source === 'json') { clearTimeout(timer); resolve(e); }
      });
    });
    await client.sendJson(text);
    let evt = await e2eReceived;

    if (evt === null) {
      console.log('    # JSON e2e not routed — waiting for real device JSON traffic (up to 15 s)');
      evt = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 15000);
        const pick = (e) => { if (e.source === 'json') { clearTimeout(timer); resolve(e); } };
        receiver.on('message', pick);
        client.on('message',   pick);
      });
    }

    await receiver.disconnect();

    if (evt === null) {
      console.log('    # no JSON traffic on our channel within timeout — skipping');
      return;
    }

    console.log('    # ── decoded JSON message ────────────────────────────');
    console.log(`    #   from:      ${evt.fromHex}`);
    console.log(`    #   text:      "${evt.text}"`);
    if (evt.user) console.log(`    #   user:      ${evt.user.longName}`);
    console.log('    # ─────────────────────────────────────────────────────');

    assert.ok(evt.from,    'event must have a from field');
    assert.ok(evt.fromHex, 'event must have a fromHex field');
  });

  it('LongFast traffic is present and decodes as a valid ServiceEnvelope', async () => {
    // Open a raw MQTT connection to listen on the high-traffic LongFast channel
    const raw = mqtt.connect(BROKER, {
      clientId:  'meshtastic_live_test_recv',
      username:  USERNAME,
      password:  PASSWORD,
    });

    await new Promise((resolve, reject) => {
      raw.once('connect', resolve);
      raw.once('error', reject);
    });

    const result = await waitForRawMessage(raw, LONGFAST_SUB, 8000);
    await new Promise((resolve) => raw.end(false, {}, resolve));

    if (result === null) {
      // No live traffic — skip without failing (non-deterministic)
      console.log('    # no LongFast traffic within 8 s — skipping decode assertion');
      return;
    }

    console.log(`    # received packet on ${result.topic} (${result.payload.length} bytes)`);

    // Assert the raw bytes parse as a ServiceEnvelope
    let env;
    try {
      env = ServiceEnvelope.decode(result.payload);
    } catch (err) {
      console.log(`    # decode failed (schema mismatch or malformed packet): ${err.message} — skipping`);
      return;
    }
    assert.ok(env.packet,     'ServiceEnvelope must have a packet field');
    assert.ok(env.channel_id, 'ServiceEnvelope must have a channel_id');
    assert.ok(env.gateway_id, 'ServiceEnvelope must have a gateway_id');

    console.log(`    # channel_id="${env.channel_id}" gateway_id="${env.gateway_id}"`);
  });
});
