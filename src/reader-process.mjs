// Internal process ownership only. MCP never accepts a worker path or executable.
import { spawn } from 'node:child_process';

const cancelled = message => Object.assign(new Error(message), { name: 'AbortError' });

export async function runReaderWorker(workerPath, args, { signal, timeoutMs }) {
  if (signal?.aborted) throw cancelled('Reader operation cancelled before start.');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...args],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', error = '', stopReason = null, closed = false, spawnError;
    const stop = reason => {
      if (closed || stopReason) return;
      stopReason = reason;
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (e) { if (e.code !== 'ESRCH') spawnError = e; }
      }
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    // Covers cancellation between the initial check and listener registration.
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      const remaining = 65536 - Buffer.byteLength(text);
      if (remaining > 0) text += chunk.subarray(0, remaining).toString();
      if (chunk.length > remaining) stop('output-limit');
    });
    child.stderr.on('data', chunk => {
      if (error.length < 8192) error += chunk.toString().slice(0, 8192 - error.length);
    });
    // Spawn errors also emit close. Never settle while the owned child is open.
    child.once('error', e => { spawnError = e; });
    child.once('close', code => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (stopReason === 'cancelled' || signal?.aborted) {
        reject(cancelled('Reader operation cancelled; worker closed.')); return;
      }
      if (stopReason === 'timeout') {
        reject(new Error('Reader operation timed out; worker closed.')); return;
      }
      if (stopReason === 'output-limit') {
        reject(new Error('Reader output exceeded its limit; worker closed.')); return;
      }
      if (spawnError) { reject(spawnError); return; }
      try {
        const result = JSON.parse(text);
        if (code !== 0 || result.error) reject(new Error(result.error || error));
        else resolve(result);
      } catch (e) { reject(e); }
    });
  });
}

export function createReaderScope(run) {
  const shutdown = new AbortController(), pending = new Set();
  let closing;
  return {
    run(action, options = {}) {
      if (shutdown.signal.aborted) return Promise.reject(cancelled('Reader server is closing.'));
      const signal = options.signal ? AbortSignal.any([shutdown.signal, options.signal]) : shutdown.signal;
      const operation = Promise.resolve().then(() => run(action, { ...options, signal }));
      pending.add(operation);
      return operation.finally(() => pending.delete(operation));
    },
    close() {
      if (!closing) {
        shutdown.abort();
        closing = Promise.allSettled([...pending]).then(() => undefined);
      }
      return closing;
    }
  };
}

// SDK close aborts handlers but does not await them; stdio EOF is not forwarded
// by the pinned server transport. Drain our reader children before transport close.
export function installReaderShutdown({ server, readers, stdin = process.stdin,
  signals = process, onError = () => { console.error('Reader shutdown failed.'); process.exitCode = 1; } }) {
  const previousClose = server.onclose;
  let closing;
  const cleanup = () => {
    stdin.removeListener('end', onEnd);
    signals.removeListener('SIGINT', onEnd);
    signals.removeListener('SIGTERM', onEnd);
    if (server.onclose === onClosed) server.onclose = previousClose;
  };
  const close = () => {
    if (!closing) closing = (async () => {
      await readers.close();
      await server.close();
    })().finally(cleanup);
    return closing;
  };
  const onEnd = () => { void close().catch(onError); };
  const onClosed = () => { previousClose?.(); onEnd(); };
  stdin.once('end', onEnd);
  signals.once('SIGINT', onEnd);
  signals.once('SIGTERM', onEnd);
  server.onclose = onClosed;
  return { close };
}
