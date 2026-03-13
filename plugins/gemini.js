/**
 * Gemini plugin for meshtastic-node-client.
 *
 * Listens for messages starting with TRIGGER_TEXT (default "G, "), sends the
 * remainder to the Google Gemini API, and broadcasts the reply to the channel.
 *
 * Required env: GEMINI_API_KEY
 * Optional env: GEMINI_TRIGGER_TEXT, GEMINI_MODEL, GEMINI_MAX_LENGTH
 */

import { createLogger } from '../src/log.js'
import { magenta } from '../src/color.js'

const log = createLogger('gemini', magenta)

const DEFAULT_TRIGGER = 'G, '
const DEFAULT_MODEL = 'gemini-2.0-flash'
const DEFAULT_MAX_LEN = 600 // total response budget
const DEFAULT_CHUNK_SIZE = 200 // per-message limit (Meshtastic ≈ 228 bytes)

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

export default function createGeminiPlugin(_opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  const trigger = process.env.GEMINI_TRIGGER_TEXT ?? DEFAULT_TRIGGER
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
  const maxLen = parseInt(
    process.env.GEMINI_MAX_LENGTH ?? String(DEFAULT_MAX_LEN),
    10
  )
  const chunkSize = parseInt(
    process.env.GEMINI_CHUNK_SIZE ?? String(DEFAULT_CHUNK_SIZE),
    10
  )

  if (!apiKey) {
    log.warn('GEMINI_API_KEY not set — plugin disabled')
    return { name: 'gemini', onMessage: async () => {} }
  }

  log(
    `ready  trigger="${trigger}"  model=${model}  maxLen=${maxLen}  chunkSize=${chunkSize}`
  )

  return {
    name: 'gemini',

    onMessage: async ({ event, client, sendJsonMode }) => {
      if (event.text === undefined) return
      if (!event.text.startsWith(trigger)) return

      const query = event.text.slice(trigger.length).trim()
      if (!query) return

      let reply
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [
                {
                  text: `Be concise. Keep your total response under ${maxLen} characters. Reply in plain text only — no markdown, no bullet points, no special formatting.`
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
      } catch (err) {
        reply = `[Gemini] ${err.message}`
      }

      // Enforce total budget then split into per-message chunks
      if (reply.length > maxLen) reply = reply.slice(0, maxLen - 1) + '…'
      const chunks = splitMessage(reply, chunkSize)

      for (const [i, chunk] of chunks.entries()) {
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
    'Gemini plugin for meshtastic-node-client. Listens for messages starting with TRIGGER_TEXT (default "G, "), sends the remainder to the Google Gemini API, and broadcasts the reply to the channel. Required env: GEMINI_API_KEY. Optional env: GEMINI_TRIGGER_TEXT, GEMINI_MODEL, GEMINI_MAX_LENGTH.'
}

export { metadata }
