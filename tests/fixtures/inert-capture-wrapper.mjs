import { capture } from '../../src/capture.mjs';

const [root, helper] = process.argv.slice(2);
await capture({ root, helper, seconds: 30, onFirstFrame: () => process.send('first-frame') });
