import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { inflate } from 'pako';
import { createCanvas, Image, loadImage } from 'canvas';

import type { BootArgs, RomPack, TextureSource } from '../../../src/bmsx/rompack/rompack';
import { normalizeCartLua } from '../../../src/bmsx/rompack/cart_normalizer';
import { getZippedRomAndRomLabelFromBlob, loadResources } from '../bootresources';
import { HeadlessPlatformServices } from '../../../src/bmsx_hostplatform/headless/platform_headless';
import { CLIPlatformServices } from '../../../src/bmsx_hostplatform/cli/platform_cli';
import type { Platform, InputEvt } from '../../../src/bmsx_hostplatform/platform';

declare const __BOOTROM_TARGET__: 'cli' | 'headless';
declare const __BOOTROM_ROM_NAME__: string;
declare const __BOOTROM_DEBUG__: boolean;
declare const __BOOTROM_CANONICALIZATION__: BootArgs['canonicalization'];

interface LaunchOptions {
	romPath?: string;
	frameIntervalMs?: number;
	debugOverride?: boolean;
	inputTimelinePath?: string;
	inputModulePath?: string;
	ttlMs?: number;
	engineRomPath?: string;
	engineRuntimePath?: string;
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
const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
let workspaceFetchBridgeInstalled = false;

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
	const createStubElement = () => ({
		style: {},
		dataset: {} as Record<string, string>,
		children: [] as unknown[],
		appendChild: () => {},
		removeChild: () => {},
		remove: () => {},
		setAttribute: () => {},
	});
	const headlessDocument = {
		createElement: (tag: string) => {
			if (tag.toLowerCase() === 'canvas') {
				return createCanvas(1, 1);
			}
			return createStubElement();
		},
		getElementById: (_id: string) => null,
		body: {
			appendChild: () => {},
			removeChild: () => {},
		},
	};
	(globalThis as any).document = headlessDocument;
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
	console.log('  --engine <path>          Optional engine ROM to merge when cart lacks code.');
	console.log('  --engine-runtime <path>  JS runtime bundle for the engine (defaults to dist/engine.js).');
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
		if (arg === '--engine') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --engine.');
			options.engineRomPath = next;
			index += 2;
			continue;
		}
		if (arg === '--engine-runtime') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --engine-runtime.');
			options.engineRuntimePath = next;
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

type WorkspaceFetchDescriptor = {
	url: URL;
	method: string;
	bodyText: string | null;
};

function installWorkspaceFetchBridge(): void {
	if (workspaceFetchBridgeInstalled) {
		return;
	}
	const workspaceRoot = path.resolve(process.cwd());
	const existingFetch: ((input: any, init?: any) => Promise<Response>) | null =
		typeof (globalThis as any).fetch === 'function'
			? (globalThis as any).fetch.bind(globalThis)
			: null;
	const bridge = async (input: any, init?: any): Promise<Response> => {
		const descriptor = normalizeWorkspaceFetchRequest(input, init);
		if (!descriptor || descriptor.url.pathname !== WORKSPACE_FILE_ENDPOINT) {
			if (existingFetch) {
				return existingFetch(input, init);
			}
			throw new TypeError('Fetch is not supported in this environment.');
		}
		return await handleWorkspaceFetch(descriptor, workspaceRoot);
	};
	(globalThis as any).fetch = bridge;
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Workspace fetch bridge mounted (${workspaceRoot}).`);
	workspaceFetchBridgeInstalled = true;
}

function normalizeWorkspaceFetchRequest(input: any, init?: any): WorkspaceFetchDescriptor | null {
	if (typeof Request !== 'undefined' && input instanceof Request) {
		return null;
	}
	let urlString: string | null = null;
	if (typeof input === 'string') {
		urlString = input;
	} else if (typeof URL !== 'undefined' && input instanceof URL) {
		urlString = input.toString();
	} else if (input && typeof input.href === 'string') {
		urlString = input.href;
	}
	if (!urlString) {
		return null;
	}
	const url = urlString.includes('://')
		? new URL(urlString)
		: new URL(urlString, 'http://workspace.local');
	const method = typeof init?.method === 'string'
		? init.method.toUpperCase()
		: 'GET';
	let bodyText: string | null = null;
	const body = init?.body;
	if (typeof body === 'string') {
		bodyText = body;
	} else if (body instanceof URLSearchParams) {
		bodyText = body.toString();
	} else if (body instanceof ArrayBuffer) {
		bodyText = Buffer.from(body).toString('utf8');
	} else if (ArrayBuffer.isView(body)) {
		bodyText = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
	} else if (body !== undefined && body !== null && typeof body.toString === 'function') {
		bodyText = body.toString();
	}
	return { url, method, bodyText };
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && typeof error.message === 'string') {
		return error.message;
	}
	return String(error);
}

function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
	const trimmed = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
	const target = path.resolve(workspaceRoot, trimmed);
	if (target === workspaceRoot) {
		return target;
	}
	const boundary = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
	if (!target.startsWith(boundary)) {
		throw new Error(`Path "${relativePath}" is outside of the workspace.`);
	}
	return target;
}

function jsonResponse(status: number, payload: unknown, extraHeaders?: Record<string, string>): Response {
	const headers = {
		'Content-Type': 'application/json',
		...(extraHeaders ?? {}),
	};
	const body = payload === null ? null : JSON.stringify(payload);
	return new Response(body, { status, headers });
}

async function handleWorkspaceFetch(descriptor: WorkspaceFetchDescriptor, workspaceRoot: string): Promise<Response> {
	const { method, url, bodyText } = descriptor;
	if (method === 'GET') {
		const targetPath = url.searchParams.get('path');
		if (!targetPath) {
			return jsonResponse(400, { error: 'Missing "path" query parameter.' });
		}
		try {
			const filePath = resolveWorkspaceFilePath(workspaceRoot, targetPath);
			const stats = await fs.stat(filePath);
			const contents = await fs.readFile(filePath, 'utf8');
			return jsonResponse(200, { path: targetPath, contents, updatedAt: stats.mtimeMs });
		} catch (error) {
			const message = toErrorMessage(error);
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return jsonResponse(404, { error: `File not found: ${targetPath}` });
			}
			return jsonResponse(500, { error: message });
		}
	}
	if (method === 'POST') {
		if (!bodyText) {
			return jsonResponse(400, { error: 'Request body is required.' });
		}
		let payload: { path?: string; contents?: string } | null = null;
		try {
			payload = JSON.parse(bodyText) as { path?: string; contents?: string };
		} catch {
			return jsonResponse(400, { error: 'Request body must be valid JSON.' });
		}
		const targetPath = typeof payload?.path === 'string' ? payload.path : '';
		const contents = typeof payload?.contents === 'string' ? payload.contents : null;
		if (!targetPath || contents === null) {
			return jsonResponse(400, { error: 'Both "path" and "contents" must be provided.' });
		}
		try {
			const filePath = resolveWorkspaceFilePath(workspaceRoot, targetPath);
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, contents, 'utf8');
			return jsonResponse(204, null);
		} catch (error) {
			return jsonResponse(500, { error: toErrorMessage(error) });
		}
	}
	if (method === 'DELETE') {
		const targetPath = url.searchParams.get('path');
		if (!targetPath) {
			return jsonResponse(400, { error: 'Missing "path" query parameter.' });
		}
		try {
			const filePath = resolveWorkspaceFilePath(workspaceRoot, targetPath);
			await fs.unlink(filePath);
			return jsonResponse(204, null);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return jsonResponse(204, null);
			}
			return jsonResponse(500, { error: toErrorMessage(error) });
		}
	}
	return new Response(null, { status: 405, headers: { Allow: 'GET,POST,DELETE' } });
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
	rompack.canonicalization = __BOOTROM_CANONICALIZATION__;
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

function mergeRecords<T>(primary: Record<string, T> | undefined, fallback?: Record<string, T>): Record<string, T> {
	return {
		...(fallback ?? {}),
		...(primary ?? {}),
	};
}

function combineRompacks(engineRom: RomPack | null, cartRom: RomPack): RomPack {
	if (!engineRom) {
		normalizeCartLua(cartRom.cart);
		return cartRom;
	}

	const combined: RomPack = {
		...engineRom,
		...cartRom,
		rom: cartRom.rom,
		img: mergeRecords(cartRom.img, engineRom.img),
		audio: mergeRecords(cartRom.audio, engineRom.audio),
		model: mergeRecords(cartRom.model, engineRom.model),
		data: mergeRecords(cartRom.data, engineRom.data),
		audioevents: mergeRecords(cartRom.audioevents, engineRom.audioevents),
		lua: mergeRecords(cartRom.lua, engineRom.lua),
		project_root_path: cartRom.project_root_path ?? engineRom.project_root_path ?? null,
		code: cartRom.code ?? engineRom.code ?? null,
		canonicalization: cartRom.canonicalization ?? engineRom.canonicalization,
		manifest: cartRom.manifest ?? engineRom.manifest,
	};
	normalizeCartLua(combined.cart);
	if ((!combined.cart.entry || combined.cart.entry.length === 0) && Object.keys(combined.cart.lua).length > 0) {
		const manifest = combined.manifest as { lua?: { entryAssetId?: string } } | null;
		const manifestEntryId = manifest && manifest.lua ? manifest.lua.entryAssetId : undefined;
		if (manifestEntryId && combined.cart.lua[manifestEntryId]) {
			combined.cart.entry = manifestEntryId;
		} else {
			const firstAsset = Object.values(combined.cart.lua)[0];
			combined.cart.entry = firstAsset.resid;
		}
	}
	return combined;
}

async function loadEngineRuntimeFromFile(filePath: string): Promise<void> {
	try {
		const script = await fs.readFile(filePath, 'utf8');
		const wrapped = new Function('globalScope', `${script}\n//# sourceURL=${filePath}`);
		wrapped(globalThis as Record<string, unknown>);
	} catch (err: any) {
		throw new Error(`Failed to load engine runtime from "${filePath}": ${err?.message ?? err}`);
	}
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

async function prepareRuntime(rompack: RomPack, cliOptions: LaunchOptions, romPath: string): Promise<{ rompack: RomPack; entry: (args: BootArgs) => Promise<void> }> {
	ensureHostEnvironment();
	const globals = globalThis as BootGlobals;
	if (typeof rompack.code === 'string' && rompack.code.length > 0) {
		executeRomCode(rompack.code, `${__BOOTROM_ROM_NAME__}.${__BOOTROM_TARGET__}.js`);
		const entry = globals.h406A;
		if (typeof entry !== 'function') {
			throw new Error('Bootloader entry point h406A not registered by ROM code.');
		}
		return { rompack, entry };
	}

	const romDirectory = path.resolve(path.dirname(romPath));
	const engineRomPath = cliOptions.engineRomPath
		? path.resolve(cliOptions.engineRomPath)
		: path.join(romDirectory, __BOOTROM_DEBUG__ ? 'engine.debug.rom' : 'engine.rom');
	const engineRuntimePath = cliOptions.engineRuntimePath
		? path.resolve(cliOptions.engineRuntimePath)
		: path.join(romDirectory, 'engine.js');

	let engineRom: RomPack | null = null;
	try {
		const engineBuffer = await readRomFile(engineRomPath);
		engineRom = await loadRomPack(engineBuffer);
		console.log(`[bootrom:${__BOOTROM_TARGET__}] Loaded engine ROM from ${engineRomPath}`);
	} catch (err: any) {
		console.warn(`[bootrom:${__BOOTROM_TARGET__}] Engine ROM not loaded (${err?.message ?? err}). Continuing without engine assets.`);
	}

	await loadEngineRuntimeFromFile(engineRuntimePath);
	const entry = globals.h406A;
	if (typeof entry !== 'function') {
		throw new Error('Engine runtime did not register h406A entry point.');
	}

	const combined = combineRompacks(engineRom, rompack);
	return { rompack: combined, entry };
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
	const { rompack: activeRompack, entry } = await prepareRuntime(rompack, cliOptions, romPath);
	installWorkspaceFetchBridge();

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
		rompack: activeRompack,
		platform,
		viewHost: platform.gameviewHost,
		canonicalization: __BOOTROM_CANONICALIZATION__,
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
