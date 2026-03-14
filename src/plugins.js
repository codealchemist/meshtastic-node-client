/**
 * Dispatch a lifecycle hook to all plugins, catching errors per-plugin.
 *
 * @param {Array}   plugins          - loaded plugin objects
 * @param {string}  hookName         - e.g. 'onStart', 'onEnd', 'onConsoleInput'
 * @param {object}  args             - arguments passed to the hook
 * @param {object}  [opts]
 * @param {boolean} [opts.fireAndForget] - if true, don't await; swallow errors silently
 * @param {Function}[opts.log]       - logger for error reporting
 */
export async function dispatchHook(plugins, hookName, args, { fireAndForget = false, log } = {}) {
  for (const p of plugins) {
    if (!p || typeof p[hookName] !== 'function') continue
    try {
      if (fireAndForget) {
        p[hookName](args).catch(() => {})
      } else {
        await p[hookName](args)
      }
    } catch (err) {
      log?.error(`plugin "${p?.name}" ${hookName} error:`, err?.message ?? err)
    }
  }
}
