import { createCipheriv, createDecipheriv } from 'node:crypto';

// The Meshtastic firmware expands a single-byte PSK of 0x01 to this
// hardcoded 16-byte AES key (used for the default LongFast channel).
const DEFAULT_KEY = Buffer.from('d4f1bb3a20290759d7a6e21d260d4d1e', 'hex');

/**
 * Expand a raw PSK buffer to a usable AES key.
 * - 1 byte (0x01): Meshtastic default key (16 bytes)
 * - 16 bytes: AES-128 key, used as-is
 * - 32 bytes: AES-256 key, used as-is
 */
/**
 * Compute the Meshtastic channel hash used in MeshPacket.channel.
 * Firmware algorithm: XOR of raw PSK bytes XOR XOR of channel name bytes.
 * The result is an 8-bit value stored as uint32 in the proto.
 * @param {Buffer} psk   Raw PSK bytes (not expanded)
 * @param {string} name  Channel name, e.g. "GEM"
 * @returns {number} 0–255
 */
export function channelHash(psk, name) {
  let hash = 0
  for (const b of psk) hash ^= b
  for (let i = 0; i < name.length; i++) hash ^= name.charCodeAt(i)
  return hash & 0xFF
}

export function expandPSK(psk) {
  if (psk.length === 1 && psk[0] === 0x01) {
    return DEFAULT_KEY;
  }
  if (psk.length === 16 || psk.length === 32) {
    return psk;
  }
  throw new Error(`Invalid PSK length ${psk.length}: expected 1, 16, or 32 bytes`);
}

/**
 * Build the 16-byte AES-CTR nonce used by Meshtastic.
 *
 * Layout (all little-endian):
 *   bytes  0–3 : packetId  (uint32)
 *   bytes  4–7 : 0x00000000
 *   bytes  8–11: fromNodeId (uint32)
 *   bytes 12–15: 0x00000000
 */
function buildNonce(packetId, fromNodeId) {
  const nonce = Buffer.alloc(16, 0);
  nonce.writeUInt32LE(packetId >>> 0, 0);
  nonce.writeUInt32LE(fromNodeId >>> 0, 8);
  return nonce;
}

/**
 * Encrypt a Data payload buffer using AES-CTR.
 * @param {Buffer} data       Encoded Data protobuf bytes
 * @param {Buffer} psk        Raw PSK bytes (1, 16, or 32 bytes)
 * @param {number} packetId   uint32 packet ID
 * @param {number} fromNodeId uint32 sender node ID
 * @returns {Buffer} ciphertext
 */
export function encrypt(data, psk, packetId, fromNodeId) {
  const key = expandPSK(psk);
  const nonce = buildNonce(packetId, fromNodeId);
  const algorithm = key.length === 16 ? 'aes-128-ctr' : 'aes-256-ctr';
  const cipher = createCipheriv(algorithm, key, nonce);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Decrypt a MeshPacket.encrypted payload using AES-CTR.
 * @param {Buffer} data       Ciphertext bytes
 * @param {Buffer} psk        Raw PSK bytes (1, 16, or 32 bytes)
 * @param {number} packetId   uint32 packet ID
 * @param {number} fromNodeId uint32 sender node ID
 * @returns {Buffer} plaintext (encoded Data protobuf)
 */
export function decrypt(data, psk, packetId, fromNodeId) {
  const key = expandPSK(psk);
  const nonce = buildNonce(packetId, fromNodeId);
  const algorithm = key.length === 16 ? 'aes-128-ctr' : 'aes-256-ctr';
  const decipher = createDecipheriv(algorithm, key, nonce);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
