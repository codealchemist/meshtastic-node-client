import { createLogger } from 'src/log.js'
import { cyan } from 'src/color.js'

const log = createLogger('echo', cyan)

/**
 * A simple plugin that echoes back any received text messages with an "ECHO:" prefix.
 * Useful for testing and debugging.
 */
export default function createEchoPlugin() {
  return {
    name: 'echo',
    onMessage: async ({ event, client, sendJsonMode }) => {
      if (event.text === undefined) return
      if (typeof event.text === 'string' && event.text.startsWith('ECHO:'))
        return
      const echoText = `ECHO: ${event.text}`
      log(echoText)

      try {
        if (sendJsonMode) await client.sendJson(echoText)
        else await client.sendText(echoText)
      } catch {
        // ignore send errors from plugin
      }
    }
  }
}

const metadata = {
  name: 'echo',
  description:
    'A simple plugin that echoes back any received text messages with an "ECHO:" prefix. Useful for testing and debugging.'
}

export { metadata }
