/**
 * Gemini plugin for meshtastic-node-client.
 *
 * Listens for messages starting with TRIGGER_TEXT (default "G, "), sends the
 * remainder to the Google Gemini API, and broadcasts the reply to the channel.
 *
 * Required env: GEMINI_API_KEY
 * Optional env: GEMINI_TRIGGER_TEXT, GEMINI_MODEL, GEMINI_MAX_LENGTH,
 *               GEMINI_CHUNK_SIZE, GEMINI_USE_WS
 */

import { createLogger } from '../src/log.js'
import { magenta } from '../src/color.js'

const log = createLogger('gemini', magenta)

const DEFAULT_TRIGGER = 'G, '
const DEFAULT_MODEL = 'gemini-2.0-flash'
const DEFAULT_CHUNK_SIZE = 200 // per-message limit (Meshtastic ≈ 228 bytes)
const GEMINI_MAX_LENGTH = process.env.GEMINI_MAX_LENGTH || 600 // total response budget

// Keep instructions separated by newlines.
// We use this format to generate the systemInstruction parts for the WS client.
const SYSTEM_INSTRUCTION = `
Be concise.
Keep your total response under ${GEMINI_MAX_LENGTH} characters.
Reply in plain text only, no markdown, no bullet points, no special formatting.
Answer in the same language as the question.
Don't repeat the question in your answer.
Don't state your focus if not asked to.
`

const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/**
 * Split text into chunks of at most `size` chars, breaking on word boundaries.
 * Every chunk except the last gets a '…' suffix.
 */
function splitMessage(text, size) {
  const chunks = []
  let remaining = text.trim()

  while (remaining.length > size) {
    // Find the last space at or before the limit (leave 1 char for '…')
    let cut = remaining.lastIndexOf(' ', size - 1)
    if (cut <= 0) cut = size - 1 // no space found — hard cut
    chunks.push(remaining.slice(0, cut) + '…')
    remaining = remaining.slice(cut).trimStart()
  }

  if (remaining.length) chunks.push(remaining)
  return chunks
}

/**
 * Persistent WebSocket client for the Gemini Live API.
 * Used with models that require a WS connection (e.g. gemini-2.5-flash-native-audio).
 * Reconnects automatically before each request if the connection has dropped.
 */
class GeminiLiveClient {
  constructor({ apiKey, setup, maxLen }) {
    this.apiKey = apiKey
    this.setup = setup
    this.maxLen = maxLen
    this.ws = null
    this._resolve = null
    this._reject = null
    this._buffer = ''
    this._connecting = null

    // Connect.
    this.connect().catch(err => {
      log.error('WebSocket connection failed:', err.message)
    })
  }

  async connect() {
    if (this._connecting) return this._connecting
    this._connecting = this._doConnect().finally(() => {
      this._connecting = null
    })
    return this._connecting
  }

  async _doConnect() {
    const url = `${WS_BASE}?key=${this.apiKey}`
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      // Server sends binary WebSocket frames containing UTF-8 JSON
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket setup timed out'))
      }, 15000)

      const done = (fn, arg) => {
        clearTimeout(timer)
        fn(arg)
      }

      // Send initial setup message to configure the model.
      ws.onopen = () => {
        // Live API uses proto3 JSON (camelCase field names)
        // ws.send(JSON.stringify(this.config))

        ws.send(
          JSON.stringify({
            setup: this.setup
          })
        )
      }

      ws.onmessage = ev => {
        let msg
        try {
          const text =
            typeof ev.data === 'string'
              ? ev.data
              : Buffer.from(ev.data).toString('utf8')
          msg = JSON.parse(text)
        } catch {
          return
        }
        if (msg.setupComplete) {
          ws.onmessage = ev => this._onMessage(ev)
          ws.onerror = () => {
            this.ws = null
            this._fail(new Error('WebSocket error'))
          }
          ws.onclose = () => {
            this.ws = null
            this._fail(new Error('WebSocket closed'))
          }
          done(resolve, undefined)
        } else if (msg.error) {
          done(
            reject,
            new Error(
              `Gemini setup error ${msg.error.code}: ${msg.error.message}`
            )
          )
        }
      }

      ws.onerror = err => done(reject, err)
      ws.onclose = ev =>
        done(
          reject,
          new Error(
            `WebSocket closed during setup (code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ''})`
          )
        )
    })
  }

  _onMessage(ev) {
    let msg
    try {
      const text =
        typeof ev.data === 'string'
          ? ev.data
          : Buffer.from(ev.data).toString('utf8')
      msg = JSON.parse(text)
    } catch {
      return
    }
    const sc = msg.serverContent
    if (!sc) return
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.text) this._buffer += part.text
    }
    if (sc.turnComplete && this._resolve) {
      const text = this._buffer.trim()
      this._buffer = ''
      const resolve = this._resolve
      this._resolve = null
      this._reject = null
      resolve(text)
    }
  }

  _fail(err) {
    if (this._reject) {
      const reject = this._reject
      this._resolve = null
      this._reject = null
      reject(err)
    }
  }

  isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  async generate(text) {
    if (!this.isOpen()) await this.connect()
    return new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
      this._buffer = ''
      this.ws.send(
        JSON.stringify({
          // Live API uses proto3 JSON (camelCase field names)
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          }
        })
      )
    })
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
  }
}

export default function createGeminiPlugin(_opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  const trigger = process.env.GEMINI_TRIGGER_TEXT ?? DEFAULT_TRIGGER
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
  const maxLen = parseInt(GEMINI_MAX_LENGTH, 10)
  const chunkSize = parseInt(
    process.env.GEMINI_CHUNK_SIZE ?? String(DEFAULT_CHUNK_SIZE),
    10
  )
  const useWs = process.env.GEMINI_USE_WS === '1'

  if (!apiKey) {
    log.warn('GEMINI_API_KEY not set — plugin disabled')
    return { name: 'gemini', onMessage: async () => {} }
  }

  log(
    `ready  trigger="${trigger}"  model=${model}  maxLen=${maxLen}  chunkSize=${chunkSize}${useWs ? '  transport=ws' : ''}`
  )

  // WS transport: persistent connection, reconnects automatically on drop
  const liveClient = useWs
    ? new GeminiLiveClient({
        apiKey,
        maxLen,
        setup: {
          model: `models/${model}`,
          systemInstruction: {
            parts: SYSTEM_INSTRUCTION.split('\n')
              .filter(line => line.trim() !== '')
              .map(line => ({ text: line }))
          },
          generationConfig: {
            candidateCount: 1,
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
            },
            temperature: 0.7
          },
          tools: [{ google_search: {} }]
        }
      })
    : null

  return {
    name: 'gemini',

    onMessage: async ({ event, client, sendJsonMode }) => {
      if (event.text === undefined) return
      if (!event.text.startsWith(trigger)) return

      const query = event.text.slice(trigger.length).trim()
      if (!query) return

      let reply
      try {
        if (liveClient) {
          // ── WebSocket (Live API) path ────────────────────────────────────
          reply = (await liveClient.generate(query)) || '(empty response)'
        } else {
          // ── HTTP path ────────────────────────────────────────────────────
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: {
                parts: [
                  {
                    text: SYSTEM_INSTRUCTION.replace(/\n/g, ' ').trim()
                  }
                ]
              },
              contents: [{ parts: [{ text: query }] }]
            })
          })

          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`)
          }

          const json = await res.json()
          reply =
            json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
            '(empty response)'
        }
      } catch (err) {
        reply = `[Gemini] ${err.message}`
      }

      // Enforce total budget then split into per-message chunks
      if (reply.length > maxLen) reply = reply.slice(0, maxLen - 1) + '…'
      const chunks = splitMessage(reply, chunkSize)

      for (const chunk of chunks) {
        try {
          log(chunk)
          if (sendJsonMode) await client.sendJson(chunk)
          else await client.sendText(chunk)
        } catch {
          // ignore send errors from plugin
        }
      }
    }
  }
}

const metadata = {
  name: 'gemini',
  description:
    'Gemini plugin for meshtastic-node-client. Listens for messages starting with TRIGGER_TEXT (default "G, "), sends the remainder to the Google Gemini API, and broadcasts the reply to the channel. Required env: GEMINI_API_KEY. Optional env: GEMINI_TRIGGER_TEXT, GEMINI_MODEL, GEMINI_MAX_LENGTH, GEMINI_CHUNK_SIZE, GEMINI_USE_WS.'
}

export { metadata, splitMessage, GeminiLiveClient }
