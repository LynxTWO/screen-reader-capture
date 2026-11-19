import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, access, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const commit = 'ec73182566c40b3febe8b434f336d6ece08b8d28';
const checkout = join(root, 'work/reuse-research/BugorBN-audio-mcp');
await mkdir(join(root, 'work/reuse-research'), { recursive: true });
try { await access(join(checkout, '.git')); }
catch {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-checkout', 'https://github.com/BugorBN/audio-mcp.git', checkout], { stdio: 'inherit' });
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', checkout, 'checkout', '--detach', commit], { stdio: 'inherit' });
}
const actual = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actual !== commit) throw new Error('Dependency commit differs from reviewed pin. No build performed.');
if (execFileSync('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Reviewed dependency has tracked edits. No build performed.');
// Extract only committed package files. Ignored build products and untracked
// Swift sources in an earlier dependency checkout cannot enter this build.
const buildRoot = join(root, '.build');
await mkdir(buildRoot, { recursive: true });
const packagePath = await mkdtemp(join(buildRoot, 'audio-helper-'));
const archive = execFileSync('git', ['-C', checkout, 'archive', commit + ':swift-helper']);
execFileSync('tar', ['-xf', '-', '-C', packagePath], { input: archive });
const entry = join(root, 'native/main.swift');
await copyFile(entry, join(packagePath, 'Sources/AudioCaptureHelper/main.swift'));
// Only compile the package. Never invoke upstream signing/notarization or setup scripts.
execFileSync('swift', ['build', '-c', 'debug', '--package-path', packagePath], { stdio: 'inherit' });
const binPath = execFileSync('swift', ['build', '-c', 'debug', '--package-path', packagePath, '--show-bin-path'], { encoding: 'utf8' }).trim();
const bundle = join(root, '.build-app/ReaderCaptureAudio.app/Contents');
await mkdir(join(bundle, 'MacOS'), { recursive: true });
const helper = join(bundle, 'MacOS/audio-capture-helper');
await copyFile(join(binPath, 'audio-capture-helper'), helper); await chmod(helper, 0o755);
await writeFile(join(bundle, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.reader-capture.audio-prototype</string>
<key>CFBundleName</key><string>Reader Capture Audio Prototype</string>
<key>CFBundleExecutable</key><string>audio-capture-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Record system audio during a deliberately requested, bounded accessibility test. No microphone is used.</string>
</dict></plist>\n`);
const binary = await readFile(helper);
const receipt = { source: 'https://github.com/BugorBN/audio-mcp', commit, helper, packagePath,
  entrySha256: createHash('sha256').update(await readFile(entry)).digest('hex'),
  sha256: createHash('sha256').update(binary).digest('hex'), signing: 'local source build; no Developer ID signing or notarization performed' };
await writeFile(join(root, 'work/helper-build.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
