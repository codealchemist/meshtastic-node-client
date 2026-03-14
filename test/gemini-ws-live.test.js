/**
 * Live integration test for the Gemini WebSocket (Live API) connection.
 *
 * Requires a real GEMINI_API_KEY in .env and network access to Google.
 * Skipped automatically if GEMINI_API_KEY is not set.
 *
 * Run with: npm run test:gemini-ws
 *
 * Only models that support bidiGenerateContent are compatible (e.g. gemini-2.5-flash-native-audio).
 * Override the model with GEMINI_LIVE_MODEL env var.
 */
import 'dotenv/config'
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { GeminiLiveClient } from '../plugins/gemini.js'
import { setLogWriter } from '../src/log.js'

setLogWriter(line => process.stdout.write(line + '\n'))

const API_KEY = process.env.GEMINI_API_KEY
// bidiGenerateContent is only supported by native audio models.
// Set GEMINI_LIVE_MODEL to override.
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest'

const SKIP = !API_KEY ? 'GEMINI_API_KEY not set — skipping live WS test' : false

describe('Gemini Live API — real WebSocket connection', { timeout: 30000, skip: SKIP }, () => {
  let client

  after(async () => {
    client?.disconnect()
    setLogWriter(null)
  })

  it('connects and receives setupComplete from the Live API', async () => {
    client = new GeminiLiveClient({
      apiKey: API_KEY,
      model: LIVE_MODEL,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
      }
    })

    await assert.doesNotReject(client.connect(), 'connect() should resolve without error')
    assert.ok(client.isOpen(), 'client should report open after connect')
  })

  it('generates a text reply to a simple query', async () => {
    // Reuse the already-connected client from the previous test
    if (!client?.isOpen()) {
      client = new GeminiLiveClient({
        apiKey: API_KEY,
        model: LIVE_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
        }
      })
      await client.connect()
    }

    const reply = await client.generate('Say just the number 4.')
    assert.ok(
      typeof reply === 'string' && reply.length > 0,
      `expected non-empty text reply, got: ${JSON.stringify(reply)}`
    )
  })
})
