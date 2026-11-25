// Keep at most one pending snapshot per client. A stalled reader reconnects for a fresh snapshot.
export function createLiveWriter(response, timeoutMs = 30_000) {
  let pending = null;
  let timeout = null;

  function write(frame, snapshot = false) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableNeedDrain) {
      if (snapshot) pending = frame;
      return;
    }
    if (!response.write(frame) && !timeout) {
      timeout = setTimeout(() => response.destroy(), timeoutMs);
      timeout.unref?.();
    }
  }

  response.on('drain', () => {
    clearTimeout(timeout);
    timeout = null;
    const latest = pending;
    pending = null;
    if (latest) write(latest, true);
  });
  response.once('close', () => {
    clearTimeout(timeout);
    timeout = null;
    pending = null;
  });
  return write;
}
