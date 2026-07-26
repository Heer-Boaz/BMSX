import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const cartName = process.argv[2] || 'renderhwtest';
const sourceTimeline = path.join(repoRoot, 'tests/carts', cartName, `${cartName}_demo.json`);
const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `bmsx-${cartName}-pixel-parity-`));
const referenceRoot = path.join(workRoot, 'ts-software');
const cppSoftwareRoot = path.join(workRoot, 'cpp-software');
const cppGles2Root = path.join(workRoot, 'cpp-gles2');
const referenceTimeline = path.join(referenceRoot, `${cartName}_demo.json`);
const cppSoftwareTimeline = path.join(cppSoftwareRoot, `${cartName}_demo.json`);
const cppGles2Timeline = path.join(cppGles2Root, `${cartName}_demo.json`);
const runTimeoutMs = 120000;

await fsp.mkdir(referenceRoot, { recursive: true });
await fsp.mkdir(cppSoftwareRoot, { recursive: true });
await fsp.mkdir(cppGles2Root, { recursive: true });
await fsp.copyFile(sourceTimeline, referenceTimeline);
await fsp.copyFile(sourceTimeline, cppSoftwareTimeline);
await fsp.copyFile(sourceTimeline, cppGles2Timeline);

function writeRunLog(filePath, result) {
	const out = [];
	out.push(result.stdout);
	out.push(result.stderr);
	fs.writeFileSync(filePath, out.join(''));
}

function runCapture(label, command, args, env, logPath) {
	console.log(`[pixel-parity] ${label}: ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		timeout: runTimeoutMs,
	});
	writeRunLog(logPath, result);
	if (result.error) {
		throw new Error(`[pixel-parity] ${label} failed before exit. Log: ${logPath}. Output root: ${workRoot}. ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`[pixel-parity] ${label} exited with ${result.status}. Log: ${logPath}. Output root: ${workRoot}.`);
	}
}

function screenshotNames(dir) {
	return fs.readdirSync(dir).filter(name => name.endsWith('.png')).sort();
}

function assertSameScreenshotSet(referenceNames, candidateNames, candidateLabel) {
	if (referenceNames.length === 0) {
		throw new Error(`[pixel-parity] TS software produced no screenshots. Output root: ${workRoot}.`);
	}
	if (candidateNames.length === 0) {
		throw new Error(`[pixel-parity] ${candidateLabel} produced no screenshots. Output root: ${workRoot}.`);
	}
	if (referenceNames.length !== candidateNames.length) {
		throw new Error(`[pixel-parity] Screenshot count mismatch: TS software=${referenceNames.length}, ${candidateLabel}=${candidateNames.length}. Output root: ${workRoot}.`);
	}
	for (let index = 0; index < referenceNames.length; index += 1) {
		if (referenceNames[index] !== candidateNames[index]) {
			throw new Error(`[pixel-parity] Screenshot filename mismatch at ${index}: TS software=${referenceNames[index]}, ${candidateLabel}=${candidateNames[index]}. Output root: ${workRoot}.`);
		}
	}
}

function readPng(filePath) {
	return PNG.sync.read(fs.readFileSync(filePath));
}

function assertSamePixels(name, referencePng, candidatePng, candidateLabel) {
	if (referencePng.width !== candidatePng.width || referencePng.height !== candidatePng.height) {
		throw new Error(`[pixel-parity] ${name} dimensions differ: TS software=${referencePng.width}x${referencePng.height}, ${candidateLabel}=${candidatePng.width}x${candidatePng.height}. Output root: ${workRoot}.`);
	}
	if (referencePng.data.byteLength !== candidatePng.data.byteLength) {
		throw new Error(`[pixel-parity] ${name} byte length differs: TS software=${referencePng.data.byteLength}, ${candidateLabel}=${candidatePng.data.byteLength}. Output root: ${workRoot}.`);
	}
	let firstByte = -1;
	let mismatchedBytes = 0;
	let mismatchedPixels = 0;
	let previousPixel = -1;
	for (let index = 0; index < referencePng.data.byteLength; index += 1) {
		if (referencePng.data[index] !== candidatePng.data[index]) {
			if (firstByte < 0) {
				firstByte = index;
			}
			mismatchedBytes += 1;
			const pixel = index >> 2;
			if (pixel !== previousPixel) {
				mismatchedPixels += 1;
				previousPixel = pixel;
			}
		}
	}
	if (firstByte >= 0) {
		const pixel = firstByte >> 2;
		const x = pixel % referencePng.width;
		const y = (pixel - x) / referencePng.width;
		const channel = firstByte & 3;
		throw new Error(`[pixel-parity] ${name} differs: pixels=${mismatchedPixels}, bytes=${mismatchedBytes}, first=(${x},${y}) channel=${channel}, TS software=${referencePng.data[firstByte]}, ${candidateLabel}=${candidatePng.data[firstByte]}. Output root: ${workRoot}.`);
	}
}

try {
	runCapture('TS software', 'node', [
		'dist/host_headless.js',
		'--system-rom', 'dist/bmsx-bios.rom',
		'--input-timeline', referenceTimeline,
		cartName,
	], {}, path.join(workRoot, 'ts-software.log'));
	runCapture('C++ software', './build-libretro-host-wsl/bmsx_libretro_host', [
		'--core', './dist/libretro_bmsx.so',
		`./dist/${cartName}.rom`,
		'--video', 'sdl',
		'--backend', 'software',
		'--system-dir', './dist',
		'--no-audio',
		'--input-timeline', cppSoftwareTimeline,
		'--crt-postprocessing', 'off',
		'--crt-noise', 'off',
	], { SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }, path.join(workRoot, 'cpp-software.log'));
	runCapture('C++ GLES2', './build-libretro-host-wsl/bmsx_libretro_host', [
		'--core', './dist/libretro_bmsx.so',
		`./dist/${cartName}.rom`,
		'--video', 'sdl',
		'--backend', 'gles2',
		'--hidden-window',
		'--system-dir', './dist',
		'--no-audio',
		'--input-timeline', cppGles2Timeline,
		'--crt-postprocessing', 'off',
		'--crt-noise', 'off',
	], { SDL_VIDEODRIVER: 'offscreen', SDL_AUDIODRIVER: 'dummy' }, path.join(workRoot, 'cpp-gles2.log'));

	const referenceScreenshotDir = path.join(referenceRoot, 'screenshots');
	const cppSoftwareScreenshotDir = path.join(cppSoftwareRoot, 'screenshots');
	const cppGles2ScreenshotDir = path.join(cppGles2Root, 'screenshots');
	const referenceNames = screenshotNames(referenceScreenshotDir);
	const cppSoftwareNames = screenshotNames(cppSoftwareScreenshotDir);
	const cppGles2Names = screenshotNames(cppGles2ScreenshotDir);
	assertSameScreenshotSet(referenceNames, cppSoftwareNames, 'C++ software');
	assertSameScreenshotSet(referenceNames, cppGles2Names, 'C++ GLES2');
	for (let index = 0; index < referenceNames.length; index += 1) {
		const name = referenceNames[index];
		const reference = readPng(path.join(referenceScreenshotDir, name));
		assertSamePixels(name, reference, readPng(path.join(cppSoftwareScreenshotDir, name)), 'C++ software');
		assertSamePixels(name, reference, readPng(path.join(cppGles2ScreenshotDir, name)), 'C++ GLES2');
	}
	await fsp.rm(workRoot, { recursive: true, force: true });
	console.log(`[pixel-parity] ${cartName}: ${referenceNames.length} TS software, C++ software, and C++ GLES2 screenshots match exactly.`);
} catch (error) {
	console.error(error);
	process.exitCode = 1;
}
