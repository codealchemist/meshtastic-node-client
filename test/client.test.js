/**
 * Client pipeline tests — no real MQTT broker required.
 *
 * Strategy: override the private `_publish` method on a client instance to
 * capture outgoing bytes, then feed those bytes directly into `_handleMqttMessage`
 * on a second client (the receiver) to verify the full encode → decrypt → decode
 * pipeline end-to-end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import MeshtasticClient from '../src/client.js';
import { PortNum } from '../src/protobufs.js';

const PSK     = Buffer.from('b0hEUel8sqN/B8nMa66Z735QeCDMRi17pCPsChA5Bas=', 'base64');
const PSK_ALT = Buffer.from('AQ==', 'base64'); // different PSK

function makeClient(nodeIdHex, psk = PSK) {
  const client = new MeshtasticClient({
    mqttBroker:    'mqtt://localhost', // not used in these tests
    rootTopic:     'msh/test',
    channelName:   'GEM',
    channelPSK:    psk,
    nodeId:        parseInt(nodeIdHex, 16),
    nodeLongName:  `Node ${nodeIdHex}`,
    nodeShortName: nodeIdHex.slice(0, 4).toUpperCase(),
  });
  return client;
}

/** Replace _publish to capture (topic, payload) without a broker. */
function captureSend(client) {
  let captured = null;
  client._publish = async (topic, payload) => { captured = { topic, payload }; };
  return () => captured;
}

/** Collect all message events emitted by a client's handler. */
function collectMessages(client) {
  const events = [];
  client.on('message', (evt) => events.push(evt));
  return events;
}

describe('MeshtasticClient — send/receive pipeline', () => {
  it('text message is encrypted by sender and decoded by receiver', async () => {
    const sender   = makeClient('deadbeef');
    const receiver = makeClient('cafebabe');
    const getCapture = captureSend(sender);

    await sender._sendData(PortNum.TEXT_MESSAGE_APP, Buffer.from('Hello mesh!'));

    const { topic, payload } = getCapture();
    assert.ok(payload, 'sender did not publish anything');
    assert.match(topic, /GEM/);

    const events = collectMessages(receiver);
    receiver._handleMqttMessage(topic, payload);

    assert.equal(events.length, 1);
    assert.equal(events[0].text, 'Hello mesh!');
    assert.equal(events[0].from >>> 0, 0xdeadbeef);
    assert.equal(events[0].fromHex, '!deadbeef');
  });

  it('NodeInfo (announce) is decoded and user fields are populated', async () => {
    const sender   = makeClient('deadbeef');
    const receiver = makeClient('cafebabe');
    const getCapture = captureSend(sender);

    await sender.announce();

    const { topic, payload } = getCapture();
    assert.ok(payload);

    const events = collectMessages(receiver);
    receiver._handleMqttMessage(topic, payload);

    assert.equal(events.length, 1);
    assert.equal(events[0].portnum, PortNum.NODEINFO_APP);
    assert.ok(events[0].user, 'user field missing');
    assert.equal(events[0].user.id, '!deadbeef');
    assert.equal(events[0].user.longName, 'Node deadbeef');
    assert.equal(events[0].user.shortName, 'DEAD');
  });

  it('receiver ignores packets from its own nodeId', async () => {
    const client = makeClient('deadbeef');
    const getCapture = captureSend(client);

    await client._sendData(PortNum.TEXT_MESSAGE_APP, Buffer.from('self'));

    const { topic, payload } = getCapture();
    const events = collectMessages(client);
    client._handleMqttMessage(topic, payload);

    assert.equal(events.length, 0, 'own packet should be silently dropped');
  });

  it('packet encrypted with wrong PSK is silently dropped', async () => {
    const sender      = makeClient('deadbeef', PSK);
    const wrongReceiver = makeClient('cafebabe', PSK_ALT);
    const getCapture  = captureSend(sender);

    await sender._sendData(PortNum.TEXT_MESSAGE_APP, Buffer.from('secret'));

    const { topic, payload } = getCapture();
    const events = collectMessages(wrongReceiver);
    wrongReceiver._handleMqttMessage(topic, payload);

    // Decryption with wrong PSK produces garbage bytes; protobuf decode
    // should either throw (caught → dropped) or produce no text field
    const textEvents = events.filter((e) => e.text === 'secret');
    assert.equal(textEvents.length, 0, 'wrong-PSK receiver must not see plaintext');
  });

  it('publish topic contains channel name and gateway id', async () => {
    const sender = makeClient('deadbeef');
    const getCapture = captureSend(sender);

    await sender._sendData(PortNum.TEXT_MESSAGE_APP, Buffer.from('hi'));

    const { topic } = getCapture();
    assert.ok(topic.includes('GEM'),       'topic must include channel name');
    assert.ok(topic.includes('!deadbeef'), 'topic must include gateway id');
  });
});
