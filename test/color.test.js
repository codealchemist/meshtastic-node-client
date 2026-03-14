import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dim, red, green, yellow, cyan, magenta, bold } from '../src/color.js'

const ALL = { dim, red, green, yellow, cyan, magenta, bold }

describe('color helpers', () => {
  it('each helper wraps text with ANSI escape codes', () => {
    for (const [name, fn] of Object.entries(ALL)) {
      const result = fn('x')
      assert.ok(result.startsWith('\x1b['), `${name}: should start with ESC[`)
      assert.ok(result.endsWith('\x1b[0m'), `${name}: should end with reset code`)
    }
  })

  it('each helper uses the correct ANSI code', () => {
    assert.ok(dim('x').includes('\x1b[2m'),  'dim: code 2')
    assert.ok(red('x').includes('\x1b[31m'), 'red: code 31')
    assert.ok(green('x').includes('\x1b[32m'), 'green: code 32')
    assert.ok(yellow('x').includes('\x1b[33m'), 'yellow: code 33')
    assert.ok(cyan('x').includes('\x1b[36m'), 'cyan: code 36')
    assert.ok(magenta('x').includes('\x1b[35m'), 'magenta: code 35')
    assert.ok(bold('x').includes('\x1b[1m'), 'bold: code 1')
  })

  it('preserves the original text inside the escape sequence', () => {
    const text = 'hello world'
    for (const [name, fn] of Object.entries(ALL)) {
      assert.ok(fn(text).includes(text), `${name}: must include original text`)
    }
  })

  it('produces different outputs for different colors', () => {
    const results = Object.values(ALL).map(fn => fn('x'))
    const unique = new Set(results)
    assert.equal(unique.size, results.length, 'each color should produce unique output')
  })

  it('can be composed (bold + red)', () => {
    const result = bold(red('alert'))
    assert.ok(result.includes('alert'))
    assert.ok(result.includes('\x1b[1m'))
    assert.ok(result.includes('\x1b[31m'))
  })
})
