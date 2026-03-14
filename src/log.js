import { cyan, yellow, red } from './color.js'

// Optional output function installed by the interactive shell to ensure the
// readline prompt is always redrawn below log output.
let _writer = null
export function setLogWriter(fn) { _writer = fn }

function emit(line) {
  if (_writer) _writer(line)
  else process.stdout.write(line + '\n')
}

/**
 * Returns a logger bound to a coloured `[prefix]` tag.
 * The prefix always uses `colorFn`. Warning messages are printed in yellow,
 * error messages in red.
 *
 * @param {string}   prefix        - Label shown in brackets, e.g. 'meshtastic'
 * @param {function} [colorFn=cyan] - Color function from src/color.js
 *
 * @example
 *   const log = createLogger('meshtastic', cyan)
 *   log('connected')           // [meshtastic] connected
 *   log.warn('offline')        // [meshtastic] (yellow) offline
 *   log.error('bad packet')    // [meshtastic] (red) bad packet
 */
export function createLogger(prefix, colorFn = cyan) {
  const tag = colorFn(`[${prefix}]`)

  const log = (...args) => emit([tag, ...args].join(' '))
  log.warn  = (...args) => emit([tag, yellow(args.map(String).join(' '))].join(' '))
  log.error = (...args) => emit([tag, red(args.map(String).join(' '))].join(' '))

  return log
}
