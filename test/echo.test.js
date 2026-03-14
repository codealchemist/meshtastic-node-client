/**
 * Echo plugin tests.
 * Requires --import ./loader.js because the plugin uses bare 'src/...' specifiers.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import createEchoPlugin, { metadata } from '../plugins/echo.js'
import { setLogWriter } from '../src/log.js'

// Suppress log output during tests
before(() => setLogWriter(() => {}))
after(() => setLogWriter(null))

function makeClient() {
  const sent = []
  return {
    sent,
    sendText: async text => { sent.push({ mode: 'text', text }) },
    sendJson: async text => { sent.push({ mode: 'json', text }) }
  }
}

describe('echo plugin — metadata', () => {
  it('exports metadata with name "echo"', () => {
    assert.equal(metadata.name, 'echo')
    assert.ok(typeof metadata.description === 'string' && metadata.description.length > 0)
  })
})

describe('echo plugin — onMessage', () => {
  it('ignores events with no text field', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({ event: { user: { id: '!abc' } }, client, sendJsonMode: false })
    assert.equal(client.sent.length, 0)
  })

  it('ignores events where text is undefined', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({ event: {}, client, sendJsonMode: false })
    assert.equal(client.sent.length, 0)
  })

  it('ignores messages already prefixed with "ECHO:"', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({ event: { text: 'ECHO: hello' }, client, sendJsonMode: false })
    assert.equal(client.sent.length, 0)
  })

  it('echoes a text message with "ECHO: " prefix via sendText', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({ event: { text: 'hello' }, client, sendJsonMode: false })
    assert.equal(client.sent.length, 1)
    assert.equal(client.sent[0].mode, 'text')
    assert.equal(client.sent[0].text, 'ECHO: hello')
  })

  it('echoes via sendJson when sendJsonMode is true', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({ event: { text: 'hello' }, client, sendJsonMode: true })
    assert.equal(client.sent.length, 1)
    assert.equal(client.sent[0].mode, 'json')
    assert.equal(client.sent[0].text, 'ECHO: hello')
  })

  it('does not skip messages containing "ECHO:" not at the start', async () => {
    const plugin = createEchoPlugin()
    const client = makeClient()
    await plugin.onMessage({
      event: { text: 'this is not ECHO: a reflected message' },
      client,
      sendJsonMode: false
    })
    assert.equal(client.sent.length, 1)
    assert.equal(client.sent[0].text, 'ECHO: this is not ECHO: a reflected message')
  })

  it('handles send errors gracefully (does not throw)', async () => {
    const plugin = createEchoPlugin()
    const failClient = {
      sendText: async () => { throw new Error('network error') },
      sendJson: async () => { throw new Error('network error') }
    }
    await assert.doesNotReject(
      plugin.onMessage({ event: { text: 'hello' }, client: failClient, sendJsonMode: false })
    )
  })

  it('plugin name is "echo"', () => {
    const plugin = createEchoPlugin()
    assert.equal(plugin.name, 'echo')
  })
})
