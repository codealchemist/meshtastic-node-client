'use strict';

/**
 * Integration test — spins up an in-process MQTT broker (aedes) so the test
 * is fully self-contained and doesn't depend on the Meshtastic public broker.
 *
 * Two clients connect to the local broker on the same channel:
 *   - sender  (node !cafe0001) sends text + announces
 *   - receiver (node !cafe0002) must receive and decrypt both
 *
 * Run with: npm run test:integration
 */

import 'dotenv/config';
import net from 'node:net';
import aedes from 'aedes';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import MeshtasticClient from '../src/client.js';

const PSK        = Buffer.from(process.env.CHANNEL_PSK, 'base64');
const ROOT_TOPIC = process.env.MQTT_ROOT_TOPIC;
const CHANNEL    = process.env.CHANNEL_NAME;
const TEST_PORT  = 18883; // avoid clashing with any local broker on 1883

function makeClient(nodeIdHex, brokerUrl) {
  return new MeshtasticClient({
    mqttBroker:    brokerUrl,
    rootTopic:     ROOT_TOPIC,
    channelName:   CHANNEL,
    channelPSK:    PSK,
    nodeId:        parseInt(nodeIdHex, 16),
    nodeLongName:  `Integration ${nodeIdHex}`,
    nodeShortName: nodeIdHex.slice(0, 4).toUpperCase(),
  });
}

/** Resolves when client emits an event matching predicate, or rejects on timeout. */
function waitForMessage(client, predicate, ms = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms waiting for message`)),
      ms
    );
    client.on('message', (evt) => {
      if (predicate(evt)) {
        clearTimeout(timer);
        resolve(evt);
      }
    });
  });
}

// ── Broker + client lifecycle ────────────────────────────────────────────────

let broker, server, sender, receiver;

describe('Integration — in-process MQTT broker', { timeout: 30000 }, () => {
  before(async () => {
    // Start an in-process MQTT broker
    broker = aedes();
    server = net.createServer(broker.handle);
    await new Promise((resolve) => server.listen(TEST_PORT, resolve));

    const url = `mqtt://localhost:${TEST_PORT}`;
    sender   = makeClient('cafe0001', url);
    receiver = makeClient('cafe0002', url);

    // Receiver subscribes first so it is ready before sender publishes
    await receiver.connect();
    await sender.connect();
  });

  after(async () => {
    await sender.disconnect();
    await receiver.disconnect();
    await new Promise((resolve) => broker.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  it('receiver decrypts a text message sent by sender', async () => {
    const text = `integration-test-${Date.now()}`;

    const received = waitForMessage(receiver, (evt) => evt.text === text);
    await sender.sendText(text);
    const evt = await received;

    assert.equal(evt.text, text);
    assert.equal(evt.from >>> 0, 0xcafe0001);
    assert.equal(evt.fromHex, '!cafe0001');
  });

  it('receiver decodes NodeInfo announced by sender', async () => {
    const received = waitForMessage(
      receiver,
      (evt) => evt.user && evt.user.id === '!cafe0001'
    );
    await sender.announce();
    const evt = await received;

    assert.equal(evt.user.id,        '!cafe0001');
    assert.equal(evt.user.longName,  'Integration cafe0001');
    assert.equal(evt.user.shortName, 'CAFE');
  });
});
