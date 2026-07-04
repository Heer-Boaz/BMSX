import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const cartName = process.argv[2] || '2025';
const sourceTimeline = path.join(repoRoot, 'tests/carts', cartName, `${cartName}_demo.json`);
const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `bmsx-${cartName}-pixel-parity-`));
const tsRoot = path.join(workRoot, 'ts');
const cppRoot = path.join(workRoot, 'cpp');
const tsTimeline = path.join(tsRoot, `${cartName}_demo.json`);
const cppTimeline = path.join(cppRoot, `${cartName}_demo.json`);
const tsLog = path.join(workRoot, 'ts.log');
const cppLog = path.join(workRoot, 'cpp.log');
const runTimeoutMs = 120000;

await fsp.mkdir(tsRoot, { recursive: true });
await fsp.mkdir(cppRoot, { recursive: true });
await fsp.copyFile(sourceTimeline, tsTimeline);
await fsp.copyFile(sourceTimeline, cppTimeline);

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

function assertSameScreenshotSet(tsNames, cppNames) {
	if (tsNames.length === 0) {
		throw new Error(`[pixel-parity] TS produced no screenshots. Output root: ${workRoot}.`);
	}
	if (cppNames.length === 0) {
		throw new Error(`[pixel-parity] C++ produced no screenshots. Output root: ${workRoot}.`);
	}
	if (tsNames.length !== cppNames.length) {
		throw new Error(`[pixel-parity] Screenshot count mismatch: TS=${tsNames.length}, C++=${cppNames.length}. Output root: ${workRoot}.`);
	}
	for (let index = 0; index < tsNames.length; index += 1) {
		if (tsNames[index] !== cppNames[index]) {
			throw new Error(`[pixel-parity] Screenshot filename mismatch at ${index}: TS=${tsNames[index]}, C++=${cppNames[index]}. Output root: ${workRoot}.`);
		}
	}
}

function readPng(filePath) {
	return PNG.sync.read(fs.readFileSync(filePath));
}

function assertSamePixels(name, tsPng, cppPng) {
	if (tsPng.width !== cppPng.width || tsPng.height !== cppPng.height) {
		throw new Error(`[pixel-parity] ${name} dimensions differ: TS=${tsPng.width}x${tsPng.height}, C++=${cppPng.width}x${cppPng.height}. Output root: ${workRoot}.`);
	}
	if (tsPng.data.byteLength !== cppPng.data.byteLength) {
		throw new Error(`[pixel-parity] ${name} byte length differs: TS=${tsPng.data.byteLength}, C++=${cppPng.data.byteLength}. Output root: ${workRoot}.`);
	}
	let firstByte = -1;
	let mismatchedBytes = 0;
	let mismatchedPixels = 0;
	let previousPixel = -1;
	for (let index = 0; index < tsPng.data.byteLength; index += 1) {
		if (tsPng.data[index] !== cppPng.data[index]) {
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
		const x = pixel % tsPng.width;
		const y = (pixel - x) / tsPng.width;
		const channel = firstByte & 3;
		throw new Error(`[pixel-parity] ${name} differs: pixels=${mismatchedPixels}, bytes=${mismatchedBytes}, first=(${x},${y}) channel=${channel}, TS=${tsPng.data[firstByte]}, C++=${cppPng.data[firstByte]}. Output root: ${workRoot}.`);
	}
}

try {
	runCapture('TS headless', 'node', [
		'dist/host_headless.js',
		'--machine-runtime', 'dist/libbmsx.js',
		'--system-rom', 'dist/bmsx-bios.rom',
		'--input-timeline', tsTimeline,
		cartName,
	], {}, tsLog);
	runCapture('C++ libretro host', './build-libretro-host-wsl/bmsx_libretro_host', [
		'--core', './dist/libretro_bmsx.so',
		`./dist/${cartName}.rom`,
		'--video', 'sdl',
		'--backend', 'software',
		'--system-dir', './dist',
		'--no-audio',
		'--input-timeline', cppTimeline,
		'--crt-postprocessing', 'off',
		'--crt-noise', 'off',
		'--max-frames', '1200',
	], { SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }, cppLog);

	const tsScreenshotDir = path.join(tsRoot, 'screenshots');
	const cppScreenshotDir = path.join(cppRoot, 'screenshots');
	const tsNames = screenshotNames(tsScreenshotDir);
	const cppNames = screenshotNames(cppScreenshotDir);
	assertSameScreenshotSet(tsNames, cppNames);
	for (let index = 0; index < tsNames.length; index += 1) {
		const name = tsNames[index];
		assertSamePixels(name, readPng(path.join(tsScreenshotDir, name)), readPng(path.join(cppScreenshotDir, name)));
	}
	await fsp.rm(workRoot, { recursive: true, force: true });
	console.log(`[pixel-parity] ${cartName}: ${tsNames.length} screenshots match exactly.`);
} catch (error) {
	console.error(error);
	process.exitCode = 1;
}
