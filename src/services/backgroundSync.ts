export function startBackgroundSync(
  sync: () => void | Promise<void>,
  targetWindow: Window = window,
  targetDocument: Document = document,
): () => void {
  const onOnline = (): void => { void sync() }
  const onVisibilityChange = (): void => {
    if (targetDocument.visibilityState === 'visible') void sync()
  }

  targetWindow.addEventListener('online', onOnline)
  targetDocument.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    targetWindow.removeEventListener('online', onOnline)
    targetDocument.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
