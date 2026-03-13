export default function createEchoPlugin(opts = {}) {
  const enabled = Boolean(opts.echoMode)
  return {
    name: 'echo',
    onMessage: async ({ event, client, sendJsonMode }) => {
      if (!enabled) return
      if (event.text === undefined) return
      if (typeof event.text === 'string' && event.text.startsWith('ECHO:'))
        return
      const echoText = `ECHO: ${event.text}`
      try {
        if (sendJsonMode) await client.sendJson(echoText)
        else await client.sendText(echoText)
      } catch {
        // ignore send errors from plugin
      }
    }
  }
}
