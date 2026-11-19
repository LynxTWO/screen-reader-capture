// Attended, local-only phrase and silence calibration through the stdio server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';

const expected = 'Capture check. Ten seconds. Thirty seconds.';
const matches = phrase => phrase?.origin === 'voiceover_last_phrase_api' && phrase.text?.includes(expected);

export async function calibrate(call, report, wait = delay) {
  await call('voiceover_setup');
  report.preflight = await call('voiceover_action', { action: 'describe' });
  if (!matches(report.preflight)) throw new Error('Place the VoiceOver cursor on the fictional calibration button.');

  // Describe can queue speech and delayed usage hints. Let them finish outside
  // the recordings. Silence still has to be established from the actual PCM.
  report.settleMilliseconds = 15000;
  await wait(report.settleMilliseconds);
  const ready = Promise.withResolvers();
  const recording = call('record_system_audio', { seconds: 10 }, ({ message }) => {
    if (message === 'First PCM frame received') ready.resolve(true);
  });
  try {
    const hasFrames = await Promise.race([ready.promise, recording.then(() => false)]);
    if (!hasFrames) throw new Error('Capture ended before first-frame notification.');
    report.actionStartedUtc = new Date().toISOString();
    try { report.phrase = await call('voiceover_action', { action: 'describe' }); }
    finally { report.actionFinishedUtc = new Date().toISOString(); }
  } finally {
    report.recording = await recording;
  }
  const { firstFrameUtc, lastFrameUtc, status } = report.recording;
  report.actionInsideFrameReceipts = Boolean(firstFrameUtc && lastFrameUtc &&
    firstFrameUtc <= report.actionStartedUtc && report.actionFinishedUtc <= lastFrameUtc);
  if (!report.actionInsideFrameReceipts || !matches(report.phrase) || status !== 'recorded_audio_unverified') {
    throw new Error('Target phrase, nonzero recording and action inside PCM receipt times are required.');
  }
  await wait(report.settleMilliseconds);
  report.quiet = await call('record_system_audio', { seconds: 4 });
  if (report.quiet.status !== 'silent_audio') throw new Error('The control interval was not digitally silent.');
  report.status = 'ready_for_listening_review';
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--live') {
    console.error('Use --live only for an attended run with the fictional button selected and system audio cleared for capture.');
    process.exitCode = 64;
    return;
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const helper = '.build-app/ReaderCaptureAudio.app/Contents/MacOS/audio-capture-helper';
  const captures = join(root, 'work/captures');
  await mkdir(captures, { recursive: true, mode: 0o700 });
  const client = new Client({ name: 'reader-capture-calibration', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(root, 'src/server.mjs')], env: {
      PATH: process.env.PATH, READER_CAPTURE_OUTPUT: captures, READER_CAPTURE_HELPER: join(root, helper)
    }, stderr: 'pipe' });
  const report = { status: 'inconclusive', microphone: 'unused', spokenWordsVerified: false,
    nodeVersion: process.version, sourceSha256: {},
    method: 'Local stdio client. Times bracket PCM arrival and describe call. Listen to the saved WAV to identify speech.' };
  const path = join(root, 'work', 'mcp-calibration-' + randomUUID() + '.json');
  try {
    for (const file of [helper, 'examples/calibration.html', 'package-lock.json', 'src/server.mjs',
      'src/capture.mjs', 'src/reader.mjs', 'src/reader-process.mjs', 'src/reader-worker.mjs',
      'src/guidepup-adapter.mjs', 'scripts/calibrate.mjs']) {
      report.sourceSha256[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
    }
    await client.connect(transport);
    await calibrate(async (name, args = {}, onprogress) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { onprogress });
      if (result.isError) throw new Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    }, report);
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    try { await client.close(); }
    finally {
      await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ status: report.status, report: path, error: report.error }));
    }
  }
}

if (import.meta.main) await main();
