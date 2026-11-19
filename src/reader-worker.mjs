// Pinning Guidepup permits these internal imports without its preference-changing lifecycle.
// Do not replace this with voiceOver.start(), which mounts portable test preferences.
import { isRunning } from '@guidepup/guidepup/lib/macOS/VoiceOver/isRunning.js';
import { readerOperation } from './guidepup-adapter.mjs';

const action = process.argv[2];
const setup = process.argv[3] === '--setup';
try {
  const options = { timeout: setup ? 45000 : 1200, retries: 1 };
  if (!await isRunning(options, true)) throw new Error('VoiceOver is not running. Enable it for the attended test first.');
  console.log(JSON.stringify(await readerOperation(action, undefined, options.timeout)));
} catch (error) {
  const causes = [];
  for (let e = error; e && causes.length < 4; e = e.cause) causes.push(String(e.message ?? e).slice(0, 1200));
  console.log(JSON.stringify({ error: causes.join(': '), origin: 'reader_api_failure' })); process.exitCode = 1;
}
