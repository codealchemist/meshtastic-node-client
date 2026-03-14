// Registers the ESM resolution hook so plugins can import via 'src/...' instead
// of relative paths like '../src/...'.
// Loaded via --import ./loader.js on every node invocation.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hooks.js', pathToFileURL('./'))
