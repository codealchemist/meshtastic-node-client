import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import createGeminiPlugin, { metadata, splitMessage } from '../plugins/gemini.js'
import { setLogWriter } from '../src/log.js'

// Suppress plugin log output during tests
before(() => setLogWriter(() => {}))
after(() => setLogWriter(null))

// ── splitMessage ─────────────────────────────────────────────────────────────

describe('splitMessage', () => {
  it('returns single element when text fits within size', () => {
    assert.deepEqual(splitMessage('hello world', 200), ['hello world'])
  })

  it('returns single element when text length equals size exactly', () => {
    assert.deepEqual(splitMessage('abcde', 5), ['abcde'])
  })

  it('splits at word boundary and appends ellipsis on non-final chunks', () => {
    // 'hello world foo bar' with size 11
    // pass 1: lastIndexOf(' ', 10) = 5 → chunk 'hello…', remaining 'world foo bar'
    // pass 2: lastIndexOf(' ', 10) = 9 → chunk 'world foo…', remaining 'bar'
    const chunks = splitMessage('hello world foo bar', 11)
    assert.equal(chunks.length, 3)
    assert.equal(chunks[0], 'hello…')
    assert.equal(chunks[1], 'world foo…')
    assert.equal(chunks[2], 'bar')
  })

  it('last chunk never has an ellipsis suffix', () => {
    const chunks = splitMessage('one two three four five', 8)
    assert.ok(!chunks[chunks.length - 1].endsWith('…'))
  })

  it('hard-cuts when no space is found within the limit', () => {
    // 'abcdefghij' has no space; with size=5, cut falls back to size-1=4
    const chunks = splitMessage('abcdefghij', 5)
    assert.ok(chunks.length >= 2)
    // First chunk: slice(0,4) + '…' = 'abcd…' (5 chars)
    assert.equal(chunks[0], 'abcd…')
  })

  it('trims leading whitespace from continuation chunks', () => {
    const chunks = splitMessage('hello world', 6)
    // pass 1: lastIndexOf(' ', 5) = 5 → chunk 'hello…', remaining ' world'.trimStart() = 'world'
    assert.equal(chunks[0], 'hello…')
    assert.equal(chunks[1], 'world')
    assert.ok(!chunks[1].startsWith(' '))
  })

  it('trims leading/trailing whitespace from the input', () => {
    assert.deepEqual(splitMessage('  hello  ', 200), ['hello'])
  })

  it('returns empty array for empty string', () => {
    assert.deepEqual(splitMessage('', 200), [])
  })
})

// ── metadata ─────────────────────────────────────────────────────────────────

describe('gemini plugin — metadata', () => {
  it('exports metadata with name "gemini"', () => {
    assert.equal(metadata.name, 'gemini')
    assert.ok(typeof metadata.description === 'string')
  })
})

// ── disabled (no API key) ─────────────────────────────────────────────────────

describe('gemini plugin — disabled without API key', () => {
  it('returns a no-op plugin when GEMINI_API_KEY is not set', async () => {
    const saved = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY

    const plugin = createGeminiPlugin()
    assert.equal(plugin.name, 'gemini')
    await assert.doesNotReject(
      plugin.onMessage({ event: { text: 'G, hi' }, client: {}, sendJsonMode: false })
    )

    if (saved !== undefined) process.env.GEMINI_API_KEY = saved
  })
})

// ── HTTP path ─────────────────────────────────────────────────────────────────

describe('gemini plugin — HTTP path', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.GEMINI_API_KEY = 'test-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_CHUNK_SIZE
  })

  function mockFetch(replyText) {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: replyText }] } }]
      })
    })
  }

  it('plugin name is "gemini"', () => {
    const plugin = createGeminiPlugin()
    assert.equal(plugin.name, 'gemini')
  })

  it('ignores messages that do not start with the trigger', async () => {
    let fetchCalled = false
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } }

    const plugin = createGeminiPlugin()
    await plugin.onMessage({ event: { text: 'hello world' }, client: {}, sendJsonMode: false })
    assert.equal(fetchCalled, false)
  })

  it('ignores events with no text field', async () => {
    let fetchCalled = false
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } }

    const plugin = createGeminiPlugin()
    await plugin.onMessage({ event: { user: {} }, client: {}, sendJsonMode: false })
    assert.equal(fetchCalled, false)
  })

  it('sends query to Gemini and broadcasts reply via sendText', async () => {
    mockFetch('Paris')
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, capital of France?' }, client, sendJsonMode: false })
    assert.equal(sent.length, 1)
    assert.equal(sent[0], 'Paris')
  })

  it('sends reply via sendJson when sendJsonMode is true', async () => {
    mockFetch('Paris')
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendJson: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, capital of France?' }, client, sendJsonMode: true })
    assert.equal(sent.length, 1)
    assert.equal(sent[0], 'Paris')
  })

  it('sends an error message when fetch fails', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'Internal Server Error' })
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    assert.equal(sent.length, 1)
    assert.ok(sent[0].startsWith('[Gemini]'), `expected error prefix, got: ${sent[0]}`)
  })

  it('handles fetch network error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('connection refused') }
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    assert.equal(sent.length, 1)
    assert.ok(sent[0].includes('connection refused'))
  })

  it('splits long replies into multiple sendText calls', async () => {
    // 'word ' repeated 60 times = 300 chars; with chunkSize=50 → multiple chunks
    const longReply = 'word '.repeat(60).trim()
    mockFetch(longReply)
    process.env.GEMINI_CHUNK_SIZE = '50'
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    assert.ok(sent.length > 1, `expected multiple chunks, got ${sent.length}`)
    for (const chunk of sent) {
      assert.ok(chunk.length <= 51, `chunk too long (${chunk.length}): "${chunk}"`)
    }
  })

  it('truncates reply to maxLen before splitting', async () => {
    const veryLong = 'x'.repeat(1000)
    mockFetch(veryLong)
    const plugin = createGeminiPlugin() // DEFAULT_MAX_LEN = 600
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    const total = sent.join('').replace(/…/g, '').length
    assert.ok(total <= 600, `total chars should be ≤600, got ${total}`)
  })

  it('falls back to "(empty response)" when Gemini returns no text', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [] })
    })
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    assert.equal(sent[0], '(empty response)')
  })

  it('includes system_instruction in the request body', async () => {
    let capturedBody
    globalThis.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }
    }
    const plugin = createGeminiPlugin()
    const client = { sendText: async () => {} }

    await plugin.onMessage({ event: { text: 'G, test' }, client, sendJsonMode: false })
    assert.ok(capturedBody.system_instruction, 'request should have system_instruction')
    assert.ok(
      capturedBody.system_instruction.parts[0].text.includes('plain text'),
      'system instruction should mention plain text'
    )
  })
})

// ── WebSocket path ────────────────────────────────────────────────────────────

describe('gemini plugin — WebSocket path', () => {
  let savedWebSocket
  let createdSockets

  // A minimal MockWebSocket that simulates the Gemini Live API handshake.
  // All async events are scheduled via queueMicrotask so the Promise chain
  // resolves correctly when tests await plugin.onMessage().
  function makeMockWebSocket() {
    const sockets = []

    class MockWebSocket {
      static OPEN = 1

      constructor(url) {
        this.url = url
        this.readyState = 0
        this.sentMessages = []
        sockets.push(this)

        queueMicrotask(() => {
          this.readyState = 1
          this.onopen?.()
        })
      }

      send(data) {
        const msg = JSON.parse(data)
        this.sentMessages.push(msg)

        if (msg.setup) {
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) })
          })
        } else if (msg.clientContent) {
          const text = msg.clientContent.turns[0].parts[0].text
          queueMicrotask(() => {
            this.onmessage?.({
              data: JSON.stringify({
                serverContent: {
                  modelTurn: { parts: [{ text: `reply:${text}` }] },
                  turnComplete: true
                }
              })
            })
          })
        }
      }

      close() {
        this.readyState = 3
        this.onclose?.()
      }
    }

    return { MockWebSocket, sockets }
  }

  beforeEach(() => {
    savedWebSocket = globalThis.WebSocket
    createdSockets = []
    const { MockWebSocket, sockets } = makeMockWebSocket()
    createdSockets = sockets
    globalThis.WebSocket = MockWebSocket
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_USE_WS = '1'
  })

  afterEach(() => {
    globalThis.WebSocket = savedWebSocket
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_USE_WS
  })

  it('connects to the Gemini Live API WebSocket URL', async () => {
    const plugin = createGeminiPlugin()
    const client = { sendText: async () => {} }

    await plugin.onMessage({ event: { text: 'G, hello' }, client, sendJsonMode: false })

    assert.equal(createdSockets.length, 1)
    assert.ok(
      createdSockets[0].url.includes('BidiGenerateContent'),
      `unexpected URL: ${createdSockets[0].url}`
    )
  })

  it('sends a setup message with model and system_instruction', async () => {
    const plugin = createGeminiPlugin()
    const client = { sendText: async () => {} }

    await plugin.onMessage({ event: { text: 'G, hello' }, client, sendJsonMode: false })

    const setupMsg = createdSockets[0].sentMessages[0]
    assert.ok(setupMsg.setup, 'first message should be a setup message')
    assert.ok(setupMsg.setup.model.includes('gemini'), 'setup.model should contain "gemini"')
    const parts = setupMsg.setup.systemInstruction?.parts ?? []
    assert.ok(parts.length > 0, 'setup should include systemInstruction parts')
    const fullInstruction = parts.map(p => p.text).join(' ')
    assert.ok(fullInstruction.includes('characters'), 'WS systemInstruction should include maxLen constraint')
  })

  it('returns the model reply and sends it to the channel', async () => {
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, hello' }, client, sendJsonMode: false })

    assert.equal(sent.length, 1)
    assert.equal(sent[0], 'reply:hello')
  })

  it('reuses the WebSocket connection across multiple queries', async () => {
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, first' }, client, sendJsonMode: false })
    await plugin.onMessage({ event: { text: 'G, second' }, client, sendJsonMode: false })

    assert.equal(createdSockets.length, 1, 'should reuse the same socket')
    assert.equal(sent.length, 2)
    assert.equal(sent[0], 'reply:first')
    assert.equal(sent[1], 'reply:second')
  })

  it('reconnects automatically when the WebSocket drops between queries', async () => {
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendText: async t => sent.push(t) }

    // First query — establishes connection
    await plugin.onMessage({ event: { text: 'G, q1' }, client, sendJsonMode: false })
    assert.equal(createdSockets.length, 1)

    // Simulate the connection dropping
    createdSockets[0].close()

    // Second query — should reconnect
    await plugin.onMessage({ event: { text: 'G, q2' }, client, sendJsonMode: false })
    assert.equal(createdSockets.length, 2, 'should have created a new socket after drop')
    assert.equal(sent.length, 2)
  })

  it('sends reply via sendJson when sendJsonMode is true', async () => {
    const plugin = createGeminiPlugin()
    const sent = []
    const client = { sendJson: async t => sent.push(t) }

    await plugin.onMessage({ event: { text: 'G, hello' }, client, sendJsonMode: true })
    assert.equal(sent.length, 1)
    assert.equal(sent[0], 'reply:hello')
  })
})
