#!/usr/bin/env node
/**
 * bin/sync-plugins.js
 *
 * Scans node_modules for packages that declare "meshtasticPlugin" in their
 * package.json and merges the results into plugins.json at the project root.
 *
 * Rules:
 *  - New packages    → added with enabled: false (security default)
 *  - Existing entries → enabled state preserved
 *  - Stale entries   → removed (package no longer in node_modules)
 *  - Missing plugins.json → created from scratch
 *
 * Exported for unit testing; only auto-runs when executed directly.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = path.join(ROOT, 'plugins.json')
const NODE_MODULES = path.join(ROOT, 'node_modules')

/**
 * Read and parse plugins.json. Returns { plugins: [] } on any error.
 * @param {string} [registryPath]
 */
export function loadRegistry(registryPath = REGISTRY) {
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  } catch {
    return { plugins: [] }
  }
}

/**
 * Scan node_modules for packages advertising "meshtasticPlugin".
 * Handles scoped packages (@scope/pkg).
 * @param {string} [nodeModulesPath]
 * @returns {Array<{ name: string, package: string }>}
 */
export function scanNodeModules(nodeModulesPath = NODE_MODULES) {
  const found = []

  if (!fs.existsSync(nodeModulesPath)) return found

  let entries
  try {
    entries = fs.readdirSync(nodeModulesPath)
  } catch {
    return found
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue

    if (entry.startsWith('@')) {
      // Scoped package directory — recurse one level
      const scopeDir = path.join(nodeModulesPath, entry)
      let subEntries
      try {
        subEntries = fs.readdirSync(scopeDir)
      } catch {
        continue
      }
      for (const sub of subEntries) {
        if (sub.startsWith('.')) continue
        tryPackage(`${entry}/${sub}`, nodeModulesPath, found)
      }
    } else {
      tryPackage(entry, nodeModulesPath, found)
    }
  }

  return found
}

function tryPackage(pkgName, nodeModulesPath, found) {
  const pkgJsonPath = path.join(nodeModulesPath, pkgName, 'package.json')
  let pkgJson
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    return
  }
  const meta = pkgJson.meshtasticPlugin
  if (meta?.name) {
    found.push({ name: meta.name, package: pkgName })
  }
}

/**
 * Sync plugins.json with current node_modules state.
 * @param {string} [registryPath]
 * @param {string} [nodeModulesPath]
 */
export function syncRegistry(registryPath = REGISTRY, nodeModulesPath = NODE_MODULES) {
  const current = loadRegistry(registryPath)
  const existing = new Map(current.plugins.map(p => [p.package, p]))
  const scanned = scanNodeModules(nodeModulesPath)

  const merged = scanned.map(({ name, package: pkg }) => {
    if (existing.has(pkg)) {
      // Preserve enabled state; update name in case it changed
      return { name, package: pkg, enabled: existing.get(pkg).enabled }
    }
    return { name, package: pkg, enabled: false }
  })

  fs.writeFileSync(registryPath, JSON.stringify({ plugins: merged }, null, 2) + '\n', 'utf8')

  const added   = merged.filter(m => !existing.has(m.package)).length
  const removed = current.plugins.filter(p => !scanned.some(s => s.package === p.package)).length
  if (added > 0 || removed > 0) {
    console.log(`[sync-plugins] +${added} added, -${removed} removed → ${registryPath}`)
  }
}

// Auto-run only when executed directly (not imported as a module)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncRegistry()
}
