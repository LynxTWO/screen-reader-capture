import { spawn } from 'node:child_process';
import { mkdir, realpath, open, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function validateSeconds(value) {
  if (!Number.isInteger(value) || value < 1 || value > 30) throw new Error('seconds must be an integer from 1 through 30');
  return value;
}

export function wavHeader(bytes, rate = 16000) {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}

export function sampleStats(pcm) {
  let peak = 0, sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const value = pcm.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(value)); sum += value * value;
  }
  return { frames: Math.floor(pcm.length / 2), peak, rms: pcm.length ? Math.sqrt(sum / (pcm.length / 2)) : 0 };
}

// A recording request has a mandatory deadline, PCM byte cap and bounded shutdown.
// Speech content is deliberately not inferred from waveform energy.
export async function capture({ seconds, root, helper, args, signal, onFirstFrame, graceMs = 1000 }) {
  validateSeconds(seconds);
  if (!isAbsolute(root) || await realpath(root) !== resolve(root)) throw new Error('root must be an existing real directory without symlinks');
  if (!isAbsolute(helper)) throw new Error('helper must be an absolute path');
  if (signal?.aborted) throw new Error('capture cancelled before start');
  const directory = join(root, randomUUID());
  await mkdir(directory, { mode: 0o700 });
  const started = performance.now();
  const chunks = [];
  let bytes = 0, stderr = '', spawnError, exitCode, exitSignal;
  let stopReason = 'early_exit', escalated = false, closed = false, stopping = false;
  const maxBytes = seconds * 16000 * 2;
  let firstFrameUtc = null, lastFrameUtc = null;
  const helperArgs = args ?? ['capture', '--mode=system', '--sample-rate=16000',
    '--seconds=' + seconds, '--owner-pid=' + process.pid];
  const child = spawn(helper, helperArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' } });
  const kill = sig => { if (child.pid) { try { process.kill(-child.pid, sig); } catch (e) { if (e.code !== 'ESRCH') throw e; } } };
  let escalation;
  const stop = reason => {
    if (closed || stopping) return;
    stopping = true; stopReason = reason; kill('SIGTERM');
    escalation = setTimeout(() => { escalated = true; kill('SIGKILL'); }, graceMs);
  };
  const deadline = setTimeout(() => stop('deadline'), seconds * 1000);
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const onTermination = () => stop('interrupted');
  process.once('SIGINT', onTermination); process.once('SIGTERM', onTermination);
  child.stdout.on('data', chunk => {
    const remaining = maxBytes - bytes;
    if (remaining > 0) { const accepted = chunk.subarray(0, remaining); chunks.push(accepted); bytes += accepted.length; }
    if (remaining > 0 && bytes >= 2) {
      lastFrameUtc = new Date().toISOString();
      if (!firstFrameUtc) {
        firstFrameUtc = lastFrameUtc;
        onFirstFrame?.();
      }
    }
    if (bytes >= maxBytes) stop('frame_limit');
  });
  child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString('utf8').slice(0, 8192 - stderr.length); });
  await new Promise(done => {
    child.once('error', error => { spawnError = error.message; });
    child.once('close', (code, sig) => { exitCode = code; exitSignal = sig; closed = true; done(); });
  });
  clearTimeout(deadline); clearTimeout(escalation);
  signal?.removeEventListener('abort', abort);
  process.removeListener('SIGINT', onTermination); process.removeListener('SIGTERM', onTermination);
  const pcm = Buffer.concat(chunks).subarray(0, bytes - bytes % 2);
  const stats = sampleStats(pcm);
  const healthy = !spawnError && exitCode === 0 && !escalated && ['deadline', 'frame_limit'].includes(stopReason);
  const status = !healthy ? 'failed_or_partial' : (stats.frames === 0 ? 'no_audio_frames' : (stats.peak === 0 ? 'silent_audio' : 'recorded_audio_unverified'));
  const audio = await open(join(directory, 'audio.wav'), 'wx', 0o600);
  try { await audio.writeFile(Buffer.concat([wavHeader(pcm.length), pcm])); await audio.sync(); } finally { await audio.close(); }
  const result = { schemaVersion: 1, status, startedUtc: new Date(Date.now() - (performance.now() - started)).toISOString(),
    elapsedSeconds: (performance.now() - started) / 1000, requestedSeconds: seconds,
    firstFrameUtc, lastFrameUtc, audioSeconds: stats.frames / 16000, ...stats, stopReason, escalated, exitCode, exitSignal,
    spawnError: spawnError ?? null, helperDiagnostics: stderr,
    microphone: 'unused', audioScope: 'system_output', spokenWordsVerified: false,
    captionStatus: 'separate_reader_phrase_tool_required', directory };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}
