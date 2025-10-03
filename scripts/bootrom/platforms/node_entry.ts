import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { inflate } from 'pako';
import { loadImage } from 'canvas';

import type { BootArgs, RomPack, TextureSource } from '../../../src/bmsx/rompack/rompack';
import { getZippedRomAndRomLabelFromBlob, loadResources } from '../bootresources';
import { HeadlessPlatformServices } from '../../../src/hostplatform/headless/platform_headless';
import { CLIPlatformServices } from '../../../src/hostplatform/cli/platform_cli';
import type { Platform, InputEvt } from '../../../src/hostplatform/platform';

declare const __BOOTROM_TARGET__: 'cli' | 'headless';
declare const __BOOTROM_ROM_NAME__: string;
declare const __BOOTROM_DEBUG__: boolean;

interface LaunchOptions {
	romPath?: string;
	frameIntervalMs?: number;
	debugOverride?: boolean;
}

interface BootGlobals {
	h406A?: (args: BootArgs) => Promise<void>;
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
	return loadResources(romBuffer, {
		loadImageFromBuffer: async (buffer: ArrayBuffer): Promise<TextureSource> => {
			const image = await loadImage(Buffer.from(buffer));
			const texture = image as unknown as TextureSource & { close?: () => void };
			if (typeof texture.close !== 'function') {
				texture.close = () => { /* no-op for node-canvas Image */ };
			}
			return texture;
		},
	});
}

function executeRomCode(source: string, label: string): void {
	if (source.length === 0) {
		throw new Error('ROM pack does not contain executable code.');
	}
	const wrapped = new Function('globalScope', `${source}\n//# sourceURL=${label}`);
	wrapped(globalThis as unknown as Record<string, unknown>);
}

function ensureHostEnvironment(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
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
	const globals = globalThis as unknown as BootGlobals;
	const entry = globals.h406A;
	if (typeof entry !== 'function') {
		throw new Error('Bootloader entry point h406A not registered by ROM code.');
	}

	const platform = createPlatform(frameInterval);
	if (__BOOTROM_TARGET__ === 'headless') {
		const globals = globalThis as unknown as Record<string, unknown>;
		globals.postHeadlessInput = (event: InputEvt) => {
			platform.input.post(event);
		};
	}
	const bootArgs: BootArgs = {
		rompack,
		platform,
		viewHost: platform.gameviewHost,
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
