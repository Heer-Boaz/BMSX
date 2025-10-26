import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { inflate } from 'pako';
import { createCanvas, Image, loadImage } from 'canvas';

import type { BootArgs, RomPack, TextureSource } from '../../../src/bmsx/rompack/rompack';
import { getZippedRomAndRomLabelFromBlob, loadResources } from '../bootresources';
import { HeadlessPlatformServices } from '../../../src/bmsx_hostplatform/headless/platform_headless';
import { CLIPlatformServices } from '../../../src/bmsx_hostplatform/cli/platform_cli';
import type { Platform, InputEvt } from '../../../src/bmsx_hostplatform/platform';

declare const __BOOTROM_TARGET__: 'cli' | 'headless';
declare const __BOOTROM_ROM_NAME__: string;
declare const __BOOTROM_DEBUG__: boolean;
declare const __BOOTROM_CASE_INSENSITIVE_LUA__: boolean;

interface LaunchOptions {
	romPath?: string;
	frameIntervalMs?: number;
	debugOverride?: boolean;
	inputTimelinePath?: string;
	inputModulePath?: string;
	ttlMs?: number;
}

interface BootGlobals {
	h406A?: (args: BootArgs) => Promise<void>;
}

interface InputTimelineEntry {
	frame?: number;
	timeMs?: number;
	ms?: number;
	delayMs?: number;
	event: InputEvt;
	repeat?: number;
	repeatEveryFrames?: number;
	repeatEveryMs?: number;
	description?: string;
}

let maxScheduledMs = 0;

if (typeof (globalThis as any).Image === 'undefined') {
	(globalThis as any).Image = Image;
}

if (typeof (globalThis as any).createImageBitmap !== 'function') {
	(globalThis as any).createImageBitmap = async function polyfillCreateImageBitmap(
		source: any,
		...args: any[]
	): Promise<any> {
		const usingCrop = args.length >= 4 && typeof args[0] === 'number';
		let sx = 0;
		let sy = 0;
		let sw: number | undefined;
		let sh: number | undefined;
		let options: any;
		if (usingCrop) {
			[sx, sy, sw, sh, options] = args as [number, number, number, number, any];
		} else {
			options = args[0];
		}

		const resolveImage = async (): Promise<any> => {
			if (source && typeof source.getContext === 'function') {
				return source;
			}
			if (source && typeof source.width === 'number' && typeof source.height === 'number') {
				return source;
			}
			if (typeof Blob !== 'undefined' && source instanceof Blob) {
				const arrayBuffer = await source.arrayBuffer();
				return loadImage(Buffer.from(arrayBuffer));
			}
			if (source instanceof ArrayBuffer) {
				return loadImage(Buffer.from(source));
			}
			if (ArrayBuffer.isView(source)) {
				const view = source as ArrayBufferView;
				const buffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
				return loadImage(buffer);
			}
			if (source instanceof Buffer) {
				return loadImage(source);
			}
			throw new Error('[node_entry] Unsupported source for createImageBitmap polyfill.');
		};

		const image = await resolveImage();
		const drawWidth = usingCrop ? (sw ?? image.width) : image.width;
		const drawHeight = usingCrop ? (sh ?? image.height) : image.height;
		const targetWidth = drawWidth;
		const targetHeight = drawHeight;

		const canvas = createCanvas(targetWidth, targetHeight);
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('[node_entry] Failed to obtain 2D context for createImageBitmap polyfill.');
		}

		if (options?.imageOrientation === 'flipY') {
			ctx.translate(0, targetHeight);
			ctx.scale(1, -1);
		}

		ctx.drawImage(
			image,
			usingCrop ? sx : 0,
			usingCrop ? sy : 0,
			drawWidth,
			drawHeight,
			0,
			0,
			targetWidth,
			targetHeight,
		);

		return canvas as unknown as ImageBitmap;
	};
}

if (typeof (globalThis as any).document === 'undefined') {
	(globalThis as any).document = {
		createElement: (tag: string) => {
			if (tag.toLowerCase() !== 'canvas') {
				throw new Error(`[node_entry] Unsupported element '${tag}' requested in headless environment.`);
			}
			return createCanvas(1, 1);
		},
	};
}

function printHelp(): void {
	console.log('Run a packaged BMSX ROM in a Node environment.');
	console.log('');
	console.log('Usage: node <bundle>.js [options]');
	console.log('');
	console.log('Options:');
	console.log('  --rom, -r <path>         Override ROM file location (defaults to dist directory).');
	console.log('  --frame-interval <ms>    Override frame loop interval in milliseconds (default 20).');
	console.log('  --debug                  Force debug mode.');
	console.log('  --no-debug               Force non-debug mode.');
	console.log('  --ttl <seconds>          Auto-terminate after the given number of seconds (default 10).');
	console.log('  --input-timeline <file>  JSON timeline of InputEvt entries to schedule.');
	console.log('  --input-module <file>    JS/TS module exporting a scheduler for custom input logic.');
	console.log('  --help, -h               Show this help message.');
}

function parseArgs(argv: string[]): LaunchOptions {
	const options: LaunchOptions = {};
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index];
		if (arg === '--rom' || arg === '-r') {
			const next = argv[index + 1];
			if (!next) {
				throw new Error('Expected ROM path after --rom.');
			}
			options.romPath = next;
			index += 2;
			continue;
		}
		if (arg === '--frame-interval') {
			const next = argv[index + 1];
			if (!next) {
				throw new Error('Expected number after --frame-interval.');
			}
			const parsed = Number(next);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error(`Invalid frame interval value: ${next}`);
			}
			options.frameIntervalMs = parsed;
			index += 2;
			continue;
		}
		if (arg === '--debug') {
			options.debugOverride = true;
			index += 1;
			continue;
		}
		if (arg === '--no-debug') {
			options.debugOverride = false;
			index += 1;
			continue;
		}
		if (arg === '--ttl') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected seconds after --ttl.');
			const parsed = Number(next);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error(`Invalid TTL value: ${next}`);
			}
			options.ttlMs = parsed * 1000;
			index += 2;
			continue;
		}
		if (arg === '--input-timeline') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --input-timeline.');
			options.inputTimelinePath = next;
			index += 2;
			continue;
		}
		if (arg === '--input-module') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --input-module.');
			options.inputModulePath = next;
			index += 2;
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unrecognized argument: ${arg}`);
	}
	return options;
}

function resolveRomPath(options: LaunchOptions): string {
	const defaultName = __BOOTROM_DEBUG__ ? `${__BOOTROM_ROM_NAME__}.debug.rom` : `${__BOOTROM_ROM_NAME__}.rom`;
	const defaultPath = path.resolve(__dirname, defaultName);
	if (options.romPath) {
		return path.resolve(options.romPath);
	}
	return defaultPath;
}

async function readRomFile(filePath: string): Promise<ArrayBuffer> {
	try {
		const buffer = await fs.readFile(filePath);
		const start = buffer.byteOffset;
		const end = buffer.byteOffset + buffer.byteLength;
		const slice = buffer.buffer.slice(start, end);
		return slice instanceof ArrayBuffer ? slice : new Uint8Array(slice).slice().buffer;
	} catch (err) {
		throw new Error(`Unable to read ROM file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function loadRomPack(arrayBuffer: ArrayBuffer): Promise<RomPack> {
	const zipped = await getZippedRomAndRomLabelFromBlob(arrayBuffer);
	const zippedView = new Uint8Array(zipped.zipped_rom);
	const inflatedBytes = inflate(zippedView);
	const romBuffer = inflatedBytes.buffer.slice(inflatedBytes.byteOffset, inflatedBytes.byteOffset + inflatedBytes.byteLength);
	const rompack = await loadResources(romBuffer, {
		loadImageFromBuffer: async (buffer: ArrayBuffer): Promise<TextureSource> => {
			const image = await loadImage(Buffer.from(buffer));
			return image as TextureSource;
		},
	});
	rompack.caseInsensitiveLua = __BOOTROM_CASE_INSENSITIVE_LUA__;
	return rompack;
}

async function scheduleInputTimelineFromFile(filePath: string, frameIntervalMs: number, postInput: (evt: InputEvt) => void, logger: (msg: string) => void): Promise<void> {
	const resolved = path.resolve(filePath);
	const content = await fs.readFile(resolved, 'utf8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (err) {
		throw new Error(`Failed to parse input timeline '${filePath}': ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`Input timeline '${filePath}' must be a JSON array.`);
	}
	scheduleTimelineEntries(parsed as InputTimelineEntry[], frameIntervalMs, postInput, logger, `timeline:${path.basename(resolved)}`);
}

async function runInputModuleScheduler(modulePath: string, frameIntervalMs: number, postInput: (evt: InputEvt) => void, logger: (msg: string) => void): Promise<void> {
	const resolved = path.resolve(modulePath);
	const moduleUrl = pathToFileURL(resolved).href;
	const imported = await import(moduleUrl);
	const scheduler = typeof imported.default === 'function' ? imported.default : typeof imported.schedule === 'function' ? imported.schedule : null;
	if (typeof scheduler !== 'function') {
		throw new Error(`Input module '${modulePath}' must export a function (default or named 'schedule').`);
	}
	const context = {
		postInput: (evt: InputEvt) => postInput(evt),
		frameIntervalMs,
		logger: (message: string) => logger(`module:${path.basename(resolved)} ${message}`),
		schedule: (entries: InputTimelineEntry[]) => scheduleTimelineEntries(entries, frameIntervalMs, postInput, logger, `module:${path.basename(resolved)}`),
	};
	const result = await scheduler(context);
	if (Array.isArray(result)) {
		context.schedule(result as InputTimelineEntry[]);
	}
}

function scheduleTimelineEntries(entries: InputTimelineEntry[], frameIntervalMs: number, postInput: (evt: InputEvt) => void, logger: (msg: string) => void, source: string): void {
	let lastAbsoluteMs = 0;
	entries.forEach((entry, idx) => {
		if (!entry || typeof entry !== 'object') {
			throw new Error(`Timeline entry ${idx} is not an object.`);
		}
		if (!entry.event) {
			throw new Error(`Timeline entry ${idx} is missing an 'event'.`);
		}
		const baseMs = resolveBaseTime(entry, frameIntervalMs, lastAbsoluteMs, idx);
		lastAbsoluteMs = baseMs;
		const executionTimes = expandExecutionTimes(entry, baseMs, frameIntervalMs, idx);
		executionTimes.forEach((timeMs) => {
			const delay = Math.max(0, Math.round(timeMs));
			if (delay > maxScheduledMs) maxScheduledMs = delay;
			const description = entry.description ? `${entry.description}` : `entry#${idx}`;
			logger(`[${source}] schedule ${description} at ${delay}ms`);
			setTimeout(() => {
				const cloned = typeof structuredClone === 'function' ? structuredClone(entry.event) : JSON.parse(JSON.stringify(entry.event));
				postInput(cloned);
			}, delay);
		});
	});
}

function resolveBaseTime(entry: InputTimelineEntry, frameIntervalMs: number, lastAbsoluteMs: number, index: number): number {
	if (typeof entry.timeMs === 'number') return sanitizeTime(entry.timeMs, index);
	if (typeof entry.ms === 'number') return sanitizeTime(entry.ms, index);
	if (typeof entry.frame === 'number') {
		return sanitizeTime(entry.frame * frameIntervalMs, index);
	}
	if (typeof entry.delayMs === 'number') {
		return sanitizeTime(lastAbsoluteMs + entry.delayMs, index);
	}
	throw new Error(`Timeline entry ${index} must specify 'frame', 'ms'/'timeMs', or 'delayMs'.`);
}

function expandExecutionTimes(entry: InputTimelineEntry, baseMs: number, frameIntervalMs: number, index: number): number[] {
	const times = [baseMs];
	const repeatCount = entry.repeat ?? 0;
	if (repeatCount <= 0) {
		return times;
	}
	const intervalMs = entry.repeatEveryMs ?? (entry.repeatEveryFrames !== undefined ? entry.repeatEveryFrames * frameIntervalMs : undefined);
	if (intervalMs === undefined || intervalMs <= 0) {
		throw new Error(`Timeline entry ${index} specifies repeat without a valid repeat interval.`);
	}
	for (let i = 1; i <= repeatCount; i++) {
		times.push(baseMs + i * intervalMs);
	}
	return times;
}

function sanitizeTime(value: number, index: number): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Timeline entry ${index} has invalid time value '${value}'.`);
	}
	return value;
}

function executeRomCode(source: string, label: string): void {
	if (source.length === 0) {
		throw new Error('ROM pack does not contain executable code.');
	}
	const wrapped = new Function('globalScope', `${source}\n//# sourceURL=${label}`);
	wrapped(globalThis as Record<string, unknown>);
}

function ensureHostEnvironment(): void {
	const globals = globalThis as Record<string, unknown>;
	if (globals.window === undefined) {
		globals.window = globals;
	}
	if (globals.navigator === undefined) {
		globals.navigator = { userAgent: 'node' };
	}
}

function createPlatform(frameIntervalMs: number | undefined): Platform {
	if (__BOOTROM_TARGET__ === 'headless') {
		const options = frameIntervalMs ? { frameIntervalMs } : {};
		return new HeadlessPlatformServices(options);
	}
	if (__BOOTROM_TARGET__ === 'cli') {
		const options = frameIntervalMs ? { frameIntervalMs } : {};
		return new CLIPlatformServices(options);
	}
	throw new Error(`Unsupported boot platform: ${__BOOTROM_TARGET__}`);
}

async function main(): Promise<void> {
	const cliOptions = parseArgs(process.argv.slice(2));
	const romPath = resolveRomPath(cliOptions);
	let debugFlag = __BOOTROM_DEBUG__;
	if (typeof cliOptions.debugOverride === 'boolean') {
		debugFlag = cliOptions.debugOverride;
	}
	let frameInterval = 20;
	if (typeof cliOptions.frameIntervalMs === 'number') {
		frameInterval = cliOptions.frameIntervalMs;
	}

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Loading ROM: ${romPath}`);
	const buffer = await readRomFile(romPath);
	const rompack = await loadRomPack(buffer);
	if (typeof rompack.code !== 'string') {
		throw new Error('ROM pack code segment missing.');
	}

	ensureHostEnvironment();
	executeRomCode(rompack.code, `${__BOOTROM_ROM_NAME__}.${__BOOTROM_TARGET__}.js`);
	const globals = globalThis as BootGlobals;
	const entry = globals.h406A;
	if (typeof entry !== 'function') {
		throw new Error('Bootloader entry point h406A not registered by ROM code.');
	}

	const platform = createPlatform(frameInterval);
	const postInput = (event: InputEvt) => {
		platform.input.post(event);
	};
	if (__BOOTROM_TARGET__ === 'headless') {
		const globals = globalThis as Record<string, unknown>;
		globals.postHeadlessInput = postInput;
	}
	const inputLogger = (message: string) => console.log(`[bootrom:${__BOOTROM_TARGET__}:input] ${message}`);
	if (cliOptions.inputTimelinePath) {
		await scheduleInputTimelineFromFile(cliOptions.inputTimelinePath, frameInterval, postInput, inputLogger);
	}
	if (cliOptions.inputModulePath) {
		await runInputModuleScheduler(cliOptions.inputModulePath, frameInterval, postInput, inputLogger);
	}
	const defaultTtl = 1_000; // minimum 1 second default TTL to allow gameboot and graceful shutdown
	const minTtl = maxScheduledMs > 0 ? maxScheduledMs + 5_000 : defaultTtl;
	const requestedTtl = typeof cliOptions.ttlMs === 'number' && cliOptions.ttlMs > 0 ? Math.round(cliOptions.ttlMs) : defaultTtl;
	const ttlMs = Math.max(requestedTtl, minTtl);
	console.log(`[bootrom:${__BOOTROM_TARGET__}] TTL set to ${ttlMs}ms (min required ${minTtl}ms).`);
	setTimeout(() => {
		console.log(`[bootrom:${__BOOTROM_TARGET__}] TTL reached (${ttlMs}ms). Terminating.`);
		process.exit(0);
	}, ttlMs);

	const bootArgs: BootArgs = {
		rompack,
		platform,
		viewHost: platform.gameviewHost,
		caseInsensitiveLua: __BOOTROM_CASE_INSENSITIVE_LUA__,
	};
	if (debugFlag) {
		bootArgs.debug = true;
	}

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Starting game (debug=${debugFlag}, frameIntervalMs=${frameInterval}).`);
	await entry(bootArgs);
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Game loop running. Press Ctrl+C to exit.`);
}

main().catch(err => {
	console.error(`[bootrom:${__BOOTROM_TARGET__}] Fatal error:`, err);
	process.exitCode = 1;
});
