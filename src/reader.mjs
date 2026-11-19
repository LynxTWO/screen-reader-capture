import { fileURLToPath } from 'node:url';
import { runReaderWorker } from './reader-process.mjs';

export const readerActions = ['phrase', 'describe', 'next', 'previous', 'activate', 'escape', 'interact', 'stop_interacting', 'sync_focus'];
export async function reader(action, { setup = false, signal } = {}) {
  if (!readerActions.includes(action)) throw new Error('Unsupported reader action');
  if (setup && action !== 'phrase') throw new Error('Setup may only request phrase access, never perform an action');
  return runReaderWorker(fileURLToPath(new URL('./reader-worker.mjs', import.meta.url)),
    [action, ...(setup ? ['--setup'] : [])], { signal, timeoutMs: setup ? 48000 : 6000 });
}
