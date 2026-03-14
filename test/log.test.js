import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createLogger, setLogWriter } from '../src/log.js'

describe('createLogger / setLogWriter', () => {
  let lines

  beforeEach(() => {
    lines = []
    setLogWriter(line => lines.push(line))
  })

  afterEach(() => {
    setLogWriter(null)
  })

  it('log() emits a line containing the prefix tag and message', () => {
    const log = createLogger('test')
    log('hello')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('[test]'), 'line should contain prefix tag')
    assert.ok(lines[0].includes('hello'), 'line should contain message')
  })

  it('log.warn() emits a line containing the prefix tag and message', () => {
    const log = createLogger('test')
    log.warn('something went wrong')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('[test]'))
    assert.ok(lines[0].includes('something went wrong'))
  })

  it('log.error() emits a line containing the prefix tag and message', () => {
    const log = createLogger('test')
    log.error('fatal error')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('[test]'))
    assert.ok(lines[0].includes('fatal error'))
  })

  it('multiple args are joined into one line', () => {
    const log = createLogger('test')
    log('a', 'b', 'c')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('a'))
    assert.ok(lines[0].includes('b'))
    assert.ok(lines[0].includes('c'))
  })

  it('log.warn multiple args are joined', () => {
    const log = createLogger('test')
    log.warn('x', 'y')
    assert.ok(lines[0].includes('x'))
    assert.ok(lines[0].includes('y'))
  })

  it('custom colorFn is applied to the prefix tag', () => {
    const blueTag = s => `BLUE(${s})`
    const log = createLogger('widget', blueTag)
    log('hi')
    assert.ok(lines[0].includes('BLUE([widget])'))
  })

  it('multiple loggers emit to the same writer independently', () => {
    const logA = createLogger('alpha')
    const logB = createLogger('beta')
    logA('msg-a')
    logB('msg-b')
    assert.equal(lines.length, 2)
    assert.ok(lines[0].includes('[alpha]') && lines[0].includes('msg-a'))
    assert.ok(lines[1].includes('[beta]') && lines[1].includes('msg-b'))
  })

  it('changing the writer mid-session redirects subsequent output', () => {
    const log = createLogger('test')
    const other = []
    log('first')
    setLogWriter(line => other.push(line))
    log('second')

    assert.equal(lines.length, 1)
    assert.equal(other.length, 1)
    assert.ok(lines[0].includes('first'))
    assert.ok(other[0].includes('second'))
  })

  it('setLogWriter(null) falls back to stdout without throwing', () => {
    setLogWriter(null)
    const log = createLogger('test')
    assert.doesNotThrow(() => log('stdout fallback'))
  })

  it('log.warn output contains yellow ANSI code (33)', () => {
    const log = createLogger('test')
    log.warn('warning text')
    assert.ok(lines[0].includes('\x1b[33m'), 'warn should use yellow (33)')
  })

  it('log.error output contains red ANSI code (31)', () => {
    const log = createLogger('test')
    log.error('error text')
    assert.ok(lines[0].includes('\x1b[31m'), 'error should use red (31)')
  })
})
