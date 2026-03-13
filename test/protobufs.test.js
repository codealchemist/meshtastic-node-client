import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceEnvelope, MeshPacket, Data, User, PortNum } from '../src/protobufs.js';

describe('PortNum', () => {
  it('defines expected values', () => {
    assert.equal(PortNum.UNKNOWN_APP, 0);
    assert.equal(PortNum.TEXT_MESSAGE_APP, 1);
    assert.equal(PortNum.POSITION_APP, 3);
    assert.equal(PortNum.NODEINFO_APP, 67);
  });
});

describe('Data', () => {
  it('round-trips TEXT_MESSAGE_APP with payload', () => {
    const payload = Buffer.from('hello mesh');
    const bytes = Buffer.from(
      Data.encode(Data.create({ portnum: PortNum.TEXT_MESSAGE_APP, payload })).finish()
    );
    const decoded = Data.decode(bytes);
    assert.equal(decoded.portnum, PortNum.TEXT_MESSAGE_APP);
    assert.deepEqual(Buffer.from(decoded.payload), payload);
  });

  it('round-trips NODEINFO_APP', () => {
    const payload = Buffer.from('nodedata');
    const bytes = Buffer.from(
      Data.encode(Data.create({ portnum: PortNum.NODEINFO_APP, payload })).finish()
    );
    const decoded = Data.decode(bytes);
    assert.equal(decoded.portnum, PortNum.NODEINFO_APP);
    assert.deepEqual(Buffer.from(decoded.payload), payload);
  });
});

describe('User', () => {
  it('round-trips all fields', () => {
    const mac = Buffer.alloc(6, 0);
    mac.writeUInt32BE(0xdeadbeef, 2);
    const u = User.create({
      id:         '!deadbeef',
      long_name:  'Test Node',
      short_name: 'TST',
      macaddr:    mac,
      hw_model:   0,
    });
    const decoded = User.decode(Buffer.from(User.encode(u).finish()));
    assert.equal(decoded.id, '!deadbeef');
    assert.equal(decoded.long_name, 'Test Node');
    assert.equal(decoded.short_name, 'TST');
    assert.deepEqual(Buffer.from(decoded.macaddr), mac);
  });
});

describe('MeshPacket', () => {
  it('round-trips with encrypted payload', () => {
    const encrypted = Buffer.from('fakeciphertext');
    const p = MeshPacket.create({
      from:      0xdeadbeef,
      to:        0xffffffff,
      channel:   0,
      encrypted,
      id:        0x12345678,
      hop_limit: 3,
    });
    const decoded = MeshPacket.decode(Buffer.from(MeshPacket.encode(p).finish()));
    assert.equal(decoded.from >>> 0, 0xdeadbeef);
    assert.equal(decoded.to  >>> 0, 0xffffffff);
    assert.equal(decoded.id  >>> 0, 0x12345678);
    assert.equal(decoded.hop_limit, 3);
    assert.deepEqual(Buffer.from(decoded.encrypted), encrypted);
    assert.equal(decoded.payload_variant, 'encrypted');
  });
});

describe('ServiceEnvelope', () => {
  it('round-trips with a nested MeshPacket', () => {
    const packet = MeshPacket.create({
      from:      0xdeadbeef,
      to:        0xffffffff,
      encrypted: Buffer.from('x'),
      id:        1,
      hop_limit: 3,
    });
    const env = ServiceEnvelope.create({
      packet,
      channel_id: 'GEM',
      gateway_id: '!deadbeef',
    });
    const decoded = ServiceEnvelope.decode(Buffer.from(ServiceEnvelope.encode(env).finish()));
    assert.equal(decoded.channel_id, 'GEM');
    assert.equal(decoded.gateway_id, '!deadbeef');
    assert.equal(decoded.packet.from >>> 0, 0xdeadbeef);
    assert.equal(decoded.packet.to   >>> 0, 0xffffffff);
  });
});
