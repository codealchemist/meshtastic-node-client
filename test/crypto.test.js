import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, expandPSK } from '../src/crypto.js';

const PSK_DEFAULT = Buffer.from('AQ==', 'base64');          // 1 byte → Meshtastic default key
const PSK_32     = Buffer.from('b0hEUel8sqN/B8nMa66Z735QeCDMRi17pCPsChA5Bas=', 'base64'); // 32 bytes
const PACKET_ID  = 0x12345678;
const NODE_ID    = 0xdeadbeef;

describe('expandPSK', () => {
  it('expands 0x01 to the 16-byte Meshtastic default key', () => {
    const key = expandPSK(Buffer.from([0x01]));
    assert.equal(key.length, 16);
    assert.equal(key.toString('hex'), 'd4f1bb3a20290759d7a6e21d260d4d1e');
  });

  it('passes through a 16-byte PSK unchanged', () => {
    const psk = Buffer.alloc(16, 0xab);
    assert.deepEqual(expandPSK(psk), psk);
  });

  it('passes through a 32-byte PSK unchanged', () => {
    assert.deepEqual(expandPSK(PSK_32), PSK_32);
  });

  it('throws on an unsupported PSK length', () => {
    assert.throws(() => expandPSK(Buffer.alloc(8)), /Invalid PSK/);
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips with the default PSK (AES-128-CTR)', () => {
    const plain = Buffer.from('Hello Meshtastic!');
    const cipher = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    assert.deepEqual(decrypt(cipher, PSK_DEFAULT, PACKET_ID, NODE_ID), plain);
  });

  it('round-trips with a 32-byte PSK (AES-256-CTR)', () => {
    const plain = Buffer.from('Hello Meshtastic!');
    const cipher = encrypt(plain, PSK_32, PACKET_ID, NODE_ID);
    assert.deepEqual(decrypt(cipher, PSK_32, PACKET_ID, NODE_ID), plain);
  });

  it('ciphertext differs from plaintext', () => {
    const plain = Buffer.from('Hello Meshtastic!');
    assert.notDeepEqual(encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID), plain);
  });

  it('is deterministic (same inputs → same ciphertext)', () => {
    const plain = Buffer.from('test');
    const c1 = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    const c2 = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    assert.deepEqual(c1, c2);
  });

  it('different packetId → different ciphertext', () => {
    const plain = Buffer.from('test');
    const c1 = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    const c2 = encrypt(plain, PSK_DEFAULT, PACKET_ID + 1, NODE_ID);
    assert.notDeepEqual(c1, c2);
  });

  it('different nodeId → different ciphertext', () => {
    const plain = Buffer.from('test');
    const c1 = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    const c2 = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID + 1);
    assert.notDeepEqual(c1, c2);
  });

  it('wrong packetId during decrypt produces wrong plaintext', () => {
    const plain = Buffer.from('Hello Meshtastic!');
    const cipher = encrypt(plain, PSK_DEFAULT, PACKET_ID, NODE_ID);
    assert.notDeepEqual(decrypt(cipher, PSK_DEFAULT, PACKET_ID + 1, NODE_ID), plain);
  });
});
