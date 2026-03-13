// ESM resolution hook — maps 'src/...' specifiers to the project root's src/ dir.
const projectRoot = new URL('./', import.meta.url).href

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('src/')) {
    return nextResolve(projectRoot + specifier, context)
  }
  return nextResolve(specifier, context)
}
