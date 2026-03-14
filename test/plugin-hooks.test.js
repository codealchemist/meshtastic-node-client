/**
 * Tests for the dispatchHook utility in src/plugins.js.
 * Verifies lifecycle hook dispatch, error isolation, and fire-and-forget mode.
 *
 * Requires --import ./loader.js because src/plugins.js uses bare 'src/...' specifiers
 * (indirectly, through the test importing from src/).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchHook } from '../src/plugins.js'

// ── dispatchHook — basic dispatch ─────────────────────────────────────────────

describe('dispatchHook — basic dispatch', () => {
  it('calls the named hook on each plugin', async () => {
    const calls = []
    const plugins = [
      { name: 'a', onStart: async ({ x }) => calls.push(`a:${x}`) },
      { name: 'b', onStart: async ({ x }) => calls.push(`b:${x}`) }
    ]
    await dispatchHook(plugins, 'onStart', { x: 1 })
    assert.deepEqual(calls, ['a:1', 'b:1'])
  })

  it('skips plugins that do not implement the hook', async () => {
    const calls = []
    const plugins = [
      { name: 'a', onStart: async () => calls.push('a') },
      { name: 'b' /* no onStart */ }
    ]
    await dispatchHook(plugins, 'onStart', {})
    assert.deepEqual(calls, ['a'])
  })

  it('skips null/undefined entries in the plugins array', async () => {
    const calls = []
    const plugins = [null, undefined, { name: 'a', onStart: async () => calls.push('a') }]
    await assert.doesNotReject(dispatchHook(plugins, 'onStart', {}))
    assert.deepEqual(calls, ['a'])
  })

  it('skips non-function hook values', async () => {
    const plugins = [{ name: 'a', onStart: 'not a function' }]
    await assert.doesNotReject(dispatchHook(plugins, 'onStart', {}))
  })
})

// ── dispatchHook — error isolation ────────────────────────────────────────────

describe('dispatchHook — error isolation', () => {
  it('catches errors from one plugin and continues to the next', async () => {
    const calls = []
    const plugins = [
      { name: 'fail', onStart: async () => { throw new Error('boom') } },
      { name: 'ok', onStart: async () => calls.push('ok') }
    ]
    await assert.doesNotReject(dispatchHook(plugins, 'onStart', {}))
    assert.deepEqual(calls, ['ok'])
  })

  it('logs error when log option is provided', async () => {
    const errors = []
    const fakeLog = { error: (...args) => errors.push(args.join(' ')) }
    const plugins = [
      { name: 'bad', onStart: async () => { throw new Error('plugin error') } }
    ]
    await dispatchHook(plugins, 'onStart', {}, { log: fakeLog })
    assert.equal(errors.length, 1)
    assert.ok(errors[0].includes('bad'), `expected plugin name in error: ${errors[0]}`)
    assert.ok(errors[0].includes('plugin error'), `expected error message: ${errors[0]}`)
  })

  it('does not throw when log is not provided', async () => {
    const plugins = [
      { name: 'bad', onStart: async () => { throw new Error('silent error') } }
    ]
    await assert.doesNotReject(dispatchHook(plugins, 'onStart', {}))
  })
})

// ── dispatchHook — fire-and-forget mode ───────────────────────────────────────

describe('dispatchHook — fire-and-forget mode', () => {
  it('does not await plugins in fireAndForget mode', async () => {
    let resolved = false
    const plugins = [
      {
        name: 'slow',
        onConsoleInput: () => new Promise(resolve => {
          setTimeout(() => { resolved = true; resolve() }, 50)
        })
      }
    ]
    await dispatchHook(plugins, 'onConsoleInput', {}, { fireAndForget: true })
    // Should return before the 50ms timeout
    assert.equal(resolved, false, 'should not have awaited the slow plugin')
  })

  it('silently ignores errors in fireAndForget mode', async () => {
    const plugins = [
      {
        name: 'fail',
        onConsoleInput: () => Promise.reject(new Error('fire-and-forget error'))
      }
    ]
    await assert.doesNotReject(
      dispatchHook(plugins, 'onConsoleInput', {}, { fireAndForget: true })
    )
  })
})

// ── dispatchHook — empty plugins array ────────────────────────────────────────

describe('dispatchHook — edge cases', () => {
  it('handles an empty plugins array', async () => {
    await assert.doesNotReject(dispatchHook([], 'onStart', {}))
  })

  it('passes args object through to the hook', async () => {
    let received
    const plugins = [{ name: 'a', onEnd: async args => { received = args } }]
    await dispatchHook(plugins, 'onEnd', { client: 'mockClient' })
    assert.equal(received.client, 'mockClient')
  })
})
