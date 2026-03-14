/**
 * Tests for bin/sync-plugins.js — registry scanning and merging logic.
 * Uses temporary directories so no real node_modules are touched.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadRegistry, scanNodeModules, syncRegistry } from '../bin/sync-plugins.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-sync-test-'))
}

function writePackageJson(dir, content) {
  const pkgDir = path.join(dir, 'node_modules', content.name.replace('/', path.sep))
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(content))
}

function writeRegistry(dir, content) {
  fs.writeFileSync(path.join(dir, 'plugins.json'), JSON.stringify(content))
}

// ── loadRegistry ─────────────────────────────────────────────────────────────

describe('loadRegistry', () => {
  it('returns { plugins: [] } when file does not exist', () => {
    const tmp = makeTmpDir()
    const result = loadRegistry(path.join(tmp, 'nonexistent.json'))
    assert.deepEqual(result, { plugins: [] })
    fs.rmSync(tmp, { recursive: true })
  })

  it('returns { plugins: [] } for corrupt JSON', () => {
    const tmp = makeTmpDir()
    const file = path.join(tmp, 'plugins.json')
    fs.writeFileSync(file, 'not json {{{')
    const result = loadRegistry(file)
    assert.deepEqual(result, { plugins: [] })
    fs.rmSync(tmp, { recursive: true })
  })

  it('returns parsed registry when file is valid', () => {
    const tmp = makeTmpDir()
    const file = path.join(tmp, 'plugins.json')
    const data = { plugins: [{ name: 'foo', package: 'foo-pkg', enabled: true }] }
    fs.writeFileSync(file, JSON.stringify(data))
    const result = loadRegistry(file)
    assert.deepEqual(result, data)
    fs.rmSync(tmp, { recursive: true })
  })
})

// ── scanNodeModules ───────────────────────────────────────────────────────────

describe('scanNodeModules', () => {
  it('returns [] when node_modules does not exist', () => {
    const tmp = makeTmpDir()
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.deepEqual(result, [])
    fs.rmSync(tmp, { recursive: true })
  })

  it('returns [] when no packages have meshtasticPlugin', () => {
    const tmp = makeTmpDir()
    writePackageJson(tmp, { name: 'ordinary-package', version: '1.0.0' })
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.deepEqual(result, [])
    fs.rmSync(tmp, { recursive: true })
  })

  it('discovers a package with meshtasticPlugin', () => {
    const tmp = makeTmpDir()
    writePackageJson(tmp, {
      name: 'meshtastic-plugin-foo',
      version: '1.0.0',
      meshtasticPlugin: { name: 'foo', description: 'Test plugin' }
    })
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'foo')
    assert.equal(result[0].package, 'meshtastic-plugin-foo')
    fs.rmSync(tmp, { recursive: true })
  })

  it('skips meshtasticPlugin entries with missing name', () => {
    const tmp = makeTmpDir()
    writePackageJson(tmp, {
      name: 'meshtastic-plugin-noname',
      version: '1.0.0',
      meshtasticPlugin: { description: 'No name here' }
    })
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.deepEqual(result, [])
    fs.rmSync(tmp, { recursive: true })
  })

  it('discovers scoped packages (@scope/pkg)', () => {
    const tmp = makeTmpDir()
    const scopedPkg = { name: '@myorg/meshtastic-plugin-bar', version: '1.0.0', meshtasticPlugin: { name: 'bar', description: 'Scoped plugin' } }
    writePackageJson(tmp, scopedPkg)
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'bar')
    assert.equal(result[0].package, '@myorg/meshtastic-plugin-bar')
    fs.rmSync(tmp, { recursive: true })
  })

  it('ignores entries with corrupt package.json', () => {
    const tmp = makeTmpDir()
    const pkgDir = path.join(tmp, 'node_modules', 'bad-pkg')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{{bad}}')
    const result = scanNodeModules(path.join(tmp, 'node_modules'))
    assert.deepEqual(result, [])
    fs.rmSync(tmp, { recursive: true })
  })
})

// ── syncRegistry ──────────────────────────────────────────────────────────────

describe('syncRegistry', () => {
  it('writes { plugins: [] } when no meshtastic packages are installed', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    const nmDir = path.join(tmp, 'node_modules')
    fs.mkdirSync(nmDir)
    syncRegistry(registry, nmDir)
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.deepEqual(result, { plugins: [] })
    fs.rmSync(tmp, { recursive: true })
  })

  it('adds new plugins with enabled: false', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    writePackageJson(tmp, { name: 'meshtastic-plugin-new', version: '1.0.0', meshtasticPlugin: { name: 'new', description: 'New plugin' } })
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.equal(result.plugins.length, 1)
    assert.equal(result.plugins[0].name, 'new')
    assert.equal(result.plugins[0].enabled, false)
    fs.rmSync(tmp, { recursive: true })
  })

  it('preserves enabled: true for existing entries on re-sync', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    writePackageJson(tmp, { name: 'meshtastic-plugin-foo', version: '1.0.0', meshtasticPlugin: { name: 'foo', description: 'Foo' } })
    // First sync: adds with enabled: false
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    // User enables it
    const data = JSON.parse(fs.readFileSync(registry, 'utf8'))
    data.plugins[0].enabled = true
    fs.writeFileSync(registry, JSON.stringify(data))
    // Second sync: should preserve enabled: true
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.equal(result.plugins[0].enabled, true)
    fs.rmSync(tmp, { recursive: true })
  })

  it('removes stale entries that are no longer installed', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    // Pre-seed registry with a stale entry
    writeRegistry(tmp, { plugins: [{ name: 'old', package: 'meshtastic-plugin-old', enabled: false }] })
    // node_modules has no meshtastic packages
    fs.mkdirSync(path.join(tmp, 'node_modules'))
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.deepEqual(result.plugins, [])
    fs.rmSync(tmp, { recursive: true })
  })

  it('handles missing plugins.json gracefully (creates a fresh one)', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    fs.mkdirSync(path.join(tmp, 'node_modules'))
    // registry file doesn't exist yet
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    assert.ok(fs.existsSync(registry))
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.deepEqual(result, { plugins: [] })
    fs.rmSync(tmp, { recursive: true })
  })

  it('handles corrupt plugins.json gracefully (treats as empty)', () => {
    const tmp = makeTmpDir()
    const registry = path.join(tmp, 'plugins.json')
    fs.writeFileSync(registry, 'not json')
    writePackageJson(tmp, { name: 'meshtastic-plugin-x', version: '1.0.0', meshtasticPlugin: { name: 'x', description: 'X' } })
    syncRegistry(registry, path.join(tmp, 'node_modules'))
    const result = JSON.parse(fs.readFileSync(registry, 'utf8'))
    assert.equal(result.plugins.length, 1)
    assert.equal(result.plugins[0].name, 'x')
    fs.rmSync(tmp, { recursive: true })
  })
})
