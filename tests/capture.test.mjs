import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, validateSeconds, wavHeader, sampleStats } from '../src/capture.mjs';
const canonicalTemp = await realpath(tmpdir());

test('rejects missing, fractional, string, zero, excessive and nonfinite durations', () => {
  for (const x of [undefined, null, '1', 0, -1, 1.5, 31, NaN, Infinity]) assert.throws(() => validateSeconds(x));
  assert.equal(validateSeconds(1), 1); assert.equal(validateSeconds(30), 30);
});
test('WAV bytes declare mono PCM and actual data size', () => {
  const h = wavHeader(32000); assert.equal(h.readUInt32LE(4), 32036);
  assert.equal(h.readUInt32LE(40), 32000); assert.equal(h.readUInt16LE(22), 1);
  assert.equal(h.readUInt32LE(24), 16000);
});
test('silence and energy are separate, neither proves speech', () => {
  assert.equal(sampleStats(Buffer.alloc(20)).peak, 0);
  const pcm = Buffer.from([0xff, 0x7f, 0, 0x80]); assert.equal(sampleStats(pcm).peak, 1);
});
test('actual subprocess silence is retained with no spoken-word pass', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-silence-'));
  const r = await capture({ seconds: 1, root, helper: process.execPath,
    args: ['-e', 'process.on("SIGTERM",()=>process.exit(0));process.stdout.write(Buffer.alloc(32000));setInterval(()=>{},100)'] });
  assert.equal(r.status, 'silent_audio'); assert.equal(r.spokenWordsVerified, false);
  assert.equal(r.frames, 16000); assert.equal((await readFile(join(r.directory, 'audio.wav'))).length, 32044);
});
test('deadline escalates for a helper that ignores TERM', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-hung-'));
  const r = await capture({ seconds: 1, root, helper: process.execPath, graceMs: 100,
    args: ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},50)'] });
  assert.equal(r.escalated, true); assert.equal(r.exitSignal, 'SIGKILL');
  assert.equal(r.status, 'failed_or_partial'); assert.ok(r.elapsedSeconds < 3);
});
test('cooperative helper stops at wall deadline and retains actual energetic samples as unverified', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-deadline-'));
  const r = await capture({ seconds: 1, root, helper: process.execPath,
    args: ['-e', 'process.on("SIGTERM",()=>process.exit(0));process.stdout.write(Buffer.alloc(320,127));setInterval(()=>{},50)'] });
  assert.equal(r.stopReason, 'deadline'); assert.equal(r.escalated, false);
  assert.equal(r.status, 'recorded_audio_unverified'); assert.equal(r.spokenWordsVerified, false);
  assert.ok(r.elapsedSeconds >= 0.9 && r.elapsedSeconds < 2);
});
test('oversized output is capped and failing helper cannot become a pass', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-cap-'));
  const r = await capture({ seconds: 1, root, helper: process.execPath,
    args: ['-e', 'process.stdout.write(Buffer.alloc(1000000,127));process.exitCode=3'] });
  assert.ok(r.frames <= 16000); assert.equal(r.status, 'failed_or_partial');
});
test('missing helper produces durable failure evidence', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-missing-'));
  const r = await capture({ seconds: 1, root, helper: '/nonexistent-reader-helper' });
  assert.equal(r.status, 'failed_or_partial'); assert.match(r.spawnError, /ENOENT/);
  assert.equal(JSON.parse(await readFile(join(r.directory, 'result.json'))).spokenWordsVerified, false);
});
test('symlink destination is rejected before spawn', async () => {
  const parent = await mkdtemp(join(canonicalTemp, 'reader-link-')); await mkdir(join(parent, 'real'));
  await symlink(join(parent, 'real'), join(parent, 'link'));
  await assert.rejects(capture({ seconds: 1, root: join(parent, 'link'), helper: process.execPath }), /symlink/);
});
test('cancellation terminates child and marks partial', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-cancel-')); const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const r = await capture({ seconds: 5, root, helper: process.execPath, signal: controller.signal,
    args: ['-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},50)'] });
  assert.equal(r.stopReason, 'cancelled'); assert.equal(r.status, 'failed_or_partial'); assert.ok(r.elapsedSeconds < 2);
});

test('a helper reporting recording permission denial retains a partial receipt and never announces readiness', async () => {
  const root = await mkdtemp(join(canonicalTemp, 'reader-denied-'));
  let notified = false;
  const r = await capture({ seconds: 1, root, helper: process.execPath, onFirstFrame: () => { notified = true; },
    args: ['-e', "process.stderr.write('screen recording permission denied'); process.exitCode = 3;"] });
  assert.equal(notified, false);
  assert.equal(r.status, 'failed_or_partial'); assert.equal(r.exitCode, 3);
  assert.match(r.helperDiagnostics, /permission denied/);
  assert.equal(r.firstFrameUtc, null); assert.equal(r.lastFrameUtc, null);
  assert.equal(JSON.parse(await readFile(join(r.directory, 'result.json'))).frames, 0);
});
