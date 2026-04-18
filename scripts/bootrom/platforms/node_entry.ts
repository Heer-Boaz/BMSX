import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { createCanvas, Image, loadImage } from 'canvas';

import { type BootArgs } from '../../../src/bmsx/rompack/format';
import { HeadlessPlatformServices } from '../../../src/bmsx_hostplatform/headless/platform_headless';
import { CLIPlatformServices } from '../../../src/bmsx_hostplatform/cli/platform_cli';
import type { Platform, InputEvt } from '../../../src/bmsx_hostplatform/platform';
import { HeadlessGameViewHost } from '../../../src/bmsx/render/headless/view';
import { HeadlessCaptureCoordinator, deriveHeadlessCaptureOutputDir, type ScheduledHeadlessCapture } from './headless_capture';
import { printHeadlessCpuProfile } from './cpu_profile_report';
import { runHostTest } from './hostrunner/host_test_runner';

declare const __BOOTROM_TARGET__: 'cli' | 'headless';
declare const __BOOTROM_DEBUG__: boolean;

interface LaunchOptions {
	romPath?: string;
	romFolder?: string;
	frameIntervalMs?: number;
	debugOverride?: boolean;
	inputTimelinePath?: string;
	testPath?: string;
	ttlMs?: number;
	engineRuntimePath?: string;
	engineAssetsPath?: string;
	cpuProfile?: boolean;
}

interface BootGlobals {
	bmsx?: EngineNamespace;
}

type EngineNamespace = {
	startCart: typeof import('../../../src/bmsx/machine/program/start_cart').startCart;
	setCpuProfilerEnabled(enabled: boolean): void;
	formatCpuProfilerReport(): string;
};

interface InputTimelineEntry {
	frame?: number;
	timeMs?: number;
	ms?: number;
	delayMs?: number;
	event?: InputEvt;
	capture?: boolean;
	repeat?: number;
	repeatEveryFrames?: number;
	repeatEveryMs?: number;
	description?: string;
}

type HostTestRunState = {
	moduleLabel: string;
	requireExplicitFinish: boolean;
	assertCount: number;
	finished: boolean;
};

interface TimelineScheduler {
	nowMs(): number;
	scheduleOnce(delayMs: number, cb: (timestampMs: number) => void): void;
}

type TimelineExecutionPoint = {
	timeMs: number;
	frame?: number;
};

let processExitController: ((code: number) => void) | null = null;

let maxScheduledDeadlineMs = 0;
const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
let workspaceFetchBridgeInstalled = false;

function trackScheduledDeadline(nowMs: number, delayMs: number): void {
	const deadlineMs = nowMs + delayMs;
	if (deadlineMs > maxScheduledDeadlineMs) {
		maxScheduledDeadlineMs = deadlineMs;
	}
}

function getPendingScheduledDelayMs(nowMs: number, settleMs = 0): number {
	if (maxScheduledDeadlineMs <= 0) {
		return 0;
	}
	return Math.max(0, maxScheduledDeadlineMs + settleMs - nowMs);
}

function createTimelineScheduler(platform: Platform): TimelineScheduler {
	return {
		nowMs: () => platform.clock.now(),
		scheduleOnce: (delayMs: number, cb: (timestampMs: number) => void): void => {
			platform.clock.scheduleOnce(delayMs, cb);
		},
	};
}

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
		let sw: number;
		let sh: number;
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
	console.log('Usage: node <bundle>.js [options] [romFolder]');
	console.log('');
	console.log('Options:');
	console.log('  --rom, -r <path>         Override ROM file location.');
	console.log('  --frame-interval <ms>    Override frame loop interval in milliseconds (default 20).');
	console.log('  --debug                  Force debug mode.');
	console.log('  --no-debug               Force non-debug mode.');
	console.log('  --ttl <seconds>          Auto-terminate after the given number of seconds (default 10).');
	console.log('  --input-timeline <file>  JSON timeline of InputEvt entries to schedule; headless capture markers write screenshots next to the timeline.');
	console.log('  --test <file>            Host test file executed by the headless test runner.');
	console.log('  --engine-runtime <path>  JS runtime bundle for the engine (defaults to dist/engine(.debug).js).');
	console.log('  --engine-assets <path>   Engine asset pack ROM (defaults to dist/bmsx-bios(.debug).rom).');
	console.log('  --cpu-profile            Enable fantasy CPU profiling and print a report on exit.');
	console.log('  --help, -h               Show this help message.');
	console.log('');
	console.log('romFolder:');
	console.log('  If --rom is omitted, a romFolder positional argument resolves to');
	console.log('  dist/<romFolder>(.debug).rom and auto-looks for timeline under');
	console.log('  src/carts/<romFolder>/test/.');
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
		if (arg === '--test') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --test.');
			options.testPath = next;
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
		if (arg === '--cpu-profile') {
			options.cpuProfile = true;
			index += 1;
			continue;
		}
		if (arg === '--engine-assets') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --engine-assets.');
			options.engineAssetsPath = next;
			index += 2;
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}
		if (!arg.startsWith('-')) {
			if (!options.romFolder) {
				options.romFolder = arg;
				index += 1;
				continue;
			}
			throw new Error(`Unexpected argument: ${arg}`);
		}
		throw new Error(`Unrecognized argument: ${arg}`);
	}
	return options;
}

type WorkspaceFetchDescriptor = {
	url: URL;
	method: string;
	bodyText: string;
};

function installWorkspaceFetchBridge(workspaceRoot: string): void {
	if (workspaceFetchBridgeInstalled) {
		return;
	}
	const existingFetch: ((input: any, init?: any) => Promise<Response>) =
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

function normalizeWorkspaceFetchRequest(input: any, init?: any): WorkspaceFetchDescriptor {
	if (typeof Request !== 'undefined' && input instanceof Request) {
		return null;
	}
	let urlString: string = null;
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
	let bodyText: string = null;
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
		let payload: { path?: string; contents?: string } = null;
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

function resolveRomPath(options: LaunchOptions, debugFlag: boolean): string {
	if (options.romPath) {
		return path.resolve(options.romPath);
	}
	if (options.romFolder) {
		const suffix = debugFlag ? '.debug' : '';
		return path.resolve('dist', `${options.romFolder}${suffix}.rom`);
	}
	throw new Error('ROM path is required. Pass --rom <path> or supply a romFolder.');
}

async function resolveCartRoot(romFolder: string): Promise<string> {
	const candidate = path.resolve('src', 'carts', romFolder);
	try {
		await fs.access(candidate);
		return candidate;
	} catch {
		throw new Error(`Cart folder "${romFolder}" not found under src/carts.`);
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveAutoTimelinePath(cartRoot: string | null, romFolder: string | undefined): Promise<string | null> {
	if (!cartRoot || !romFolder) {
		return null;
	}
	const demoPath = path.join(cartRoot, 'test', `${romFolder}_demo.json`);
	if (await fileExists(demoPath)) {
		return demoPath;
	}
	return null;
}

function assertDebugArtifacts(label: string, debugFlag: boolean, filePath: string): void {
	const hasDebug = filePath.includes('.debug.');
	if (debugFlag && !hasDebug) {
		throw new Error(`[bootrom:${__BOOTROM_TARGET__}] ${label} must be a debug artifact (${filePath}).`);
	}
	if (!debugFlag && hasDebug) {
		throw new Error(`[bootrom:${__BOOTROM_TARGET__}] ${label} must be a non-debug artifact (${filePath}).`);
	}
}

async function readRomFile(filePath: string): Promise<Uint8Array> {
	try {
		const buffer = await fs.readFile(filePath);
		const start = buffer.byteOffset;
		const end = buffer.byteOffset + buffer.byteLength;
		const slice = buffer.buffer.slice(start, end);
		return slice instanceof ArrayBuffer ? new Uint8Array(slice) : new Uint8Array(slice).slice();
	} catch (err) {
		throw new Error(`Unable to read ROM file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function scheduleInputTimelineFromFile(
	filePath: string,
	frameIntervalMs: number,
	postInput: (evt: InputEvt) => void,
	scheduleCapture: ((capture: ScheduledHeadlessCapture) => void) | null,
	logger: (msg: string) => void,
	scheduler: TimelineScheduler,
	onScheduled?: () => void,
): Promise<void> {
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
	const source = `timeline:${path.basename(resolved)}`;
	const entries = parsed as InputTimelineEntry[];
	const pollCartActive = (): void => {
		const engine = (globalThis as Record<string, any>).$;
		if (!engine || !engine.initialized || !engine.is_cart_program_active()) {
			scheduler.scheduleOnce(frameIntervalMs, pollCartActive);
			return;
		}
		logger(`[${source}] cart active, scheduling timeline`);
		scheduleTimelineEntries(entries, frameIntervalMs, postInput, scheduleCapture, logger, source, scheduler);
		onScheduled?.();
	};
	scheduler.scheduleOnce(0, pollCartActive);
}

function assertHostTestRunState(runState: HostTestRunState): void {
	if (runState.assertCount <= 0) {
		throw new Error(`[bootrom:${__BOOTROM_TARGET__}] Host test '${runState.moduleLabel}' completed without assertions.`);
	}
	if (runState.requireExplicitFinish && !runState.finished) {
		throw new Error(`[bootrom:${__BOOTROM_TARGET__}] Host test '${runState.moduleLabel}' did not finish before TTL.`);
	}
}

function scheduleTimelineEntries(
	entries: InputTimelineEntry[],
	frameIntervalMs: number,
	postInput: (evt: InputEvt) => void,
	scheduleCapture: ((capture: ScheduledHeadlessCapture) => void) | null,
	logger: (msg: string) => void,
	source: string,
	scheduler: TimelineScheduler,
): void {
	let lastAbsoluteMs = 0;
	entries.forEach((entry, idx) => {
		if (!entry || typeof entry !== 'object') {
			throw new Error(`Timeline entry ${idx} is not an object.`);
		}
		const hasEvent = entry.event !== undefined && entry.event !== null;
		const hasCapture = entry.capture === true;
		if (!hasEvent && !hasCapture) {
			throw new Error(`Timeline entry ${idx} is missing an 'event' or 'capture'.`);
		}
		const basePoint = resolveBaseSchedule(entry, frameIntervalMs, lastAbsoluteMs, idx);
		lastAbsoluteMs = basePoint.timeMs;
		const executionPoints = expandExecutionPoints(entry, basePoint, frameIntervalMs, idx);
		const description = entry.description ? `${entry.description}` : `entry#${idx}`;
		if (hasCapture) {
			executionPoints.forEach((point) => {
				const delay = Math.max(0, Math.round(point.timeMs));
				trackScheduledDeadline(scheduler.nowMs(), delay);
				logger(`[${source}] capture ${description} at ${delay}ms`);
				scheduleCapture?.({
					dueTimeMs: point.timeMs,
					description,
					source,
				});
			});
		}
		if (!hasEvent) {
			return;
		}
		executionPoints.forEach((point) => {
			const delay = Math.max(0, Math.round(point.timeMs));
			trackScheduledDeadline(scheduler.nowMs(), delay);
			logger(`[${source}] schedule ${description} at ${delay}ms`);
			scheduler.scheduleOnce(delay, () => {
				const cloned = typeof structuredClone === 'function' ? structuredClone(entry.event) : JSON.parse(JSON.stringify(entry.event));
				postInput(cloned);
			});
		});
	});
}

function resolveBaseSchedule(entry: InputTimelineEntry, frameIntervalMs: number, lastAbsoluteMs: number, index: number): TimelineExecutionPoint {
	if (typeof entry.timeMs === 'number') return { timeMs: sanitizeTime(entry.timeMs, index) };
	if (typeof entry.ms === 'number') return { timeMs: sanitizeTime(entry.ms, index) };
	if (typeof entry.frame === 'number') {
		return {
			timeMs: sanitizeTime(entry.frame * frameIntervalMs, index),
			frame: entry.frame,
		};
	}
	if (typeof entry.delayMs === 'number') {
		return { timeMs: sanitizeTime(lastAbsoluteMs + entry.delayMs, index) };
	}
	throw new Error(`Timeline entry ${index} must specify 'frame', 'ms'/'timeMs', or 'delayMs'.`);
}

function expandExecutionPoints(entry: InputTimelineEntry, basePoint: TimelineExecutionPoint, frameIntervalMs: number, index: number): TimelineExecutionPoint[] {
	const points = [basePoint];
	const repeatCount = entry.repeat ?? 0;
	if (repeatCount <= 0) {
		return points;
	}
	const intervalMs = entry.repeatEveryMs ?? (entry.repeatEveryFrames !== undefined ? entry.repeatEveryFrames * frameIntervalMs : undefined);
	if (intervalMs === undefined || intervalMs <= 0) {
		throw new Error(`Timeline entry ${index} specifies repeat without a valid repeat interval.`);
	}
	for (let i = 1; i <= repeatCount; i++) {
		points.push({
			timeMs: basePoint.timeMs + i * intervalMs,
			frame: basePoint.frame !== undefined && entry.repeatEveryFrames !== undefined
				? basePoint.frame + i * entry.repeatEveryFrames
				: undefined,
		});
	}
	return points;
}

function sanitizeTime(value: number, index: number): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Timeline entry ${index} has invalid time value '${value}'.`);
	}
	return value;
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

function createProcessExitController(getCaptureCoordinator: () => HeadlessCaptureCoordinator | null): (code: number) => void {
	let exitRequested = false;
	let exitCode = 0;
	return (code: number): void => {
		if (code !== 0) {
			exitCode = code;
		}
		if (exitRequested) {
			return;
		}
		exitRequested = true;
		void (async () => {
			const coordinator = getCaptureCoordinator();
			try {
				if (coordinator) {
					await coordinator.flushWrites(exitCode === 0);
				}
			} catch (error) {
				console.error(`[bootrom:${__BOOTROM_TARGET__}] Failed to flush screenshots:`, error);
				exitCode = 1;
			} finally {
				coordinator?.dispose();
			}
			process.exit(exitCode);
		})();
	};
}

function ensureHeadlessCaptureCoordinator(
	host: HeadlessGameViewHost | null,
	sourcePath: string,
	logger: (msg: string) => void,
	getCoordinator: () => HeadlessCaptureCoordinator | null,
	setCoordinator: (coordinator: HeadlessCaptureCoordinator) => void,
	scheduler: TimelineScheduler,
): HeadlessCaptureCoordinator | null {
	if (!host) {
		return null;
	}
	let coordinator = getCoordinator();
	if (coordinator) {
		return coordinator;
	}
	const outputDir = deriveHeadlessCaptureOutputDir(path.resolve(sourcePath));
	logger(`[capture] screenshots -> ${outputDir}`);
	coordinator = new HeadlessCaptureCoordinator(host, outputDir, () => scheduler.nowMs());
	setCoordinator(coordinator);
	return coordinator;
}

function createHeadlessCaptureScheduler(
	host: HeadlessGameViewHost | null,
	sourcePath: string,
	logger: (msg: string) => void,
	getCoordinator: () => HeadlessCaptureCoordinator | null,
	setCoordinator: (coordinator: HeadlessCaptureCoordinator) => void,
	scheduler: TimelineScheduler,
): ((capture: ScheduledHeadlessCapture) => void) | null {
	if (!host) {
		return null;
	}
	return (capture: ScheduledHeadlessCapture): void => {
		const coordinator = ensureHeadlessCaptureCoordinator(host, sourcePath, logger, getCoordinator, setCoordinator, scheduler);
		if (!coordinator) {
			return;
		}
		coordinator.schedule(capture);
	};
}

function createPlatform(frameIntervalMs: number): Platform {
	if (__BOOTROM_TARGET__ === 'headless') {
		const options = frameIntervalMs ? { frameIntervalMs, unpaced: true } : { unpaced: true };
		return new HeadlessPlatformServices(options);
	}
	if (__BOOTROM_TARGET__ === 'cli') {
		const options = frameIntervalMs ? { frameIntervalMs } : {};
		return new CLIPlatformServices(options);
	}
	throw new Error(`Unsupported boot platform: ${__BOOTROM_TARGET__}`);
}

async function prepareRuntime(cliOptions: LaunchOptions, romPath: string, debugFlag: boolean): Promise<EngineNamespace> {
	ensureHostEnvironment();
	const globals = globalThis as unknown as BootGlobals;
	const romDirectory = path.resolve(path.dirname(romPath));
	const engineRuntimePath = cliOptions.engineRuntimePath
		? path.resolve(cliOptions.engineRuntimePath)
		: path.join(romDirectory, debugFlag ? 'engine.debug.js' : 'engine.js');

	await loadEngineRuntimeFromFile(engineRuntimePath);
	const runtime = globals.bmsx;
	if (!runtime) {
		throw new Error('Engine runtime did not register the bmsx namespace.');
	}
	return runtime;
}

async function main(): Promise<void> {
	const cliOptions = parseArgs(process.argv.slice(2));
	let debugFlag = __BOOTROM_DEBUG__;
	if (typeof cliOptions.debugOverride === 'boolean') {
		debugFlag = cliOptions.debugOverride;
	}
	const romPath = resolveRomPath(cliOptions, debugFlag);
	let frameInterval = 20;
	if (typeof cliOptions.frameIntervalMs === 'number') {
		frameInterval = cliOptions.frameIntervalMs;
	}

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Loading ROM: ${romPath}`);
	const runtime = await prepareRuntime(cliOptions, romPath, debugFlag);
	const romDirectory = path.resolve(path.dirname(romPath));
	const engineAssetsPath = cliOptions.engineAssetsPath
		? path.resolve(cliOptions.engineAssetsPath)
		: path.join(romDirectory, debugFlag ? 'bmsx-bios.debug.rom' : 'bmsx-bios.rom');
	assertDebugArtifacts('Engine runtime', debugFlag, cliOptions.engineRuntimePath ?? path.join(romDirectory, debugFlag ? 'engine.debug.js' : 'engine.js'));
	assertDebugArtifacts('Engine assets', debugFlag, engineAssetsPath);
	const workspaceRoot = path.resolve(romDirectory, '..');
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Loading engine assets: ${engineAssetsPath}`);
	const engineAssetsBuffer = await readRomFile(engineAssetsPath);

	const buffer = await readRomFile(romPath);
	installWorkspaceFetchBridge(workspaceRoot);

	const platform = createPlatform(frameInterval);
	const scheduler = createTimelineScheduler(platform);
	let headlessHost: HeadlessGameViewHost | null = null;
	if (__BOOTROM_TARGET__ === 'headless') {
		if (!(platform.gameviewHost instanceof HeadlessGameViewHost)) {
			throw new Error('[bootrom:headless] Expected HeadlessGameViewHost for headless target.');
		}
		headlessHost = platform.gameviewHost;
	}
	let captureCoordinator: HeadlessCaptureCoordinator | null = null;
	let cpuProfileDumped = false;
	let cpuProfileActive = false;
	const baseRequestExit = createProcessExitController(() => captureCoordinator);
	const requestExit = (code: number): void => {
		if (!cpuProfileDumped && cpuProfileActive) {
			cpuProfileDumped = true;
			printHeadlessCpuProfile(runtime, __BOOTROM_TARGET__);
		}
		baseRequestExit(code);
	};
	processExitController = requestExit;
	const postInput = (event: InputEvt) => {
		platform.input.post(event);
	};
	if (__BOOTROM_TARGET__ === 'headless') {
		const globals = globalThis as Record<string, unknown>;
		globals.postHeadlessInput = postInput;
	}
	const inputLogger = (message: string) => console.log(`[bootrom:${__BOOTROM_TARGET__}:input] ${message}`);
	const romFolder = cliOptions.romFolder;
	let cartRoot: string | null = null;
	let hostTestRunState: HostTestRunState | null = null;
	let captureScheduler: ((capture: ScheduledHeadlessCapture) => void) | null = null;
	let timelineAutoExitArmed = false;
	const armTimelineAutoExit = (): void => {
		if (timelineAutoExitArmed || hostTestRunState) {
			return;
		}
		timelineAutoExitArmed = true;
		const timelineExitDelayMs = getPendingScheduledDelayMs(scheduler.nowMs(), frameInterval);
		if (timelineExitDelayMs > 0) {
			scheduler.scheduleOnce(timelineExitDelayMs, () => {
				console.log(`[bootrom:${__BOOTROM_TARGET__}] Input timeline completed. Terminating.`);
				requestExit(0);
			});
		}
	};
	const ensureCaptureScheduler = (sourcePath: string): ((capture: ScheduledHeadlessCapture) => void) | null => {
		return createHeadlessCaptureScheduler(
			headlessHost,
			sourcePath,
			inputLogger,
			() => captureCoordinator,
			(coordinator: HeadlessCaptureCoordinator) => {
				captureCoordinator = coordinator;
			},
			scheduler,
		);
	};
	const ensureImmediateCapture = (sourcePath: string): ((description: string) => void) | null => {
		if (!headlessHost) {
			return null;
		}
		return (description: string): void => {
			const coordinator = ensureHeadlessCaptureCoordinator(
				headlessHost,
				sourcePath,
				inputLogger,
				() => captureCoordinator,
				(coordinator: HeadlessCaptureCoordinator) => {
					captureCoordinator = coordinator;
				},
				scheduler,
			);
			if (!coordinator) {
				return;
			}
			coordinator.captureNow(description, `host:${path.basename(sourcePath)}`);
		};
	};
	const canCaptureImmediately = (): boolean => {
		return captureCoordinator ? captureCoordinator.canCaptureNow() : !!headlessHost?.getPresentedFrameSnapshot();
	};
	if (romFolder) {
		cartRoot = await resolveCartRoot(romFolder);
	}
	const autoTimelinePath = await resolveAutoTimelinePath(cartRoot, romFolder);
	let scheduledTimeline = false;
	if (cliOptions.testPath) {
		hostTestRunState = {
			moduleLabel: path.basename(cliOptions.testPath),
			requireExplicitFinish: true,
			assertCount: 0,
			finished: false,
		};
		await runHostTest({
			testPath: cliOptions.testPath,
			frameIntervalMs: frameInterval,
			logger: inputLogger,
			getEngine: () => (globalThis as Record<string, any>).$,
			postInput,
			requestExit,
			scheduler,
			runState: hostTestRunState,
			captureNow: ensureImmediateCapture(cliOptions.testPath),
			canCaptureNow: canCaptureImmediately,
		});
	} else if (cliOptions.inputTimelinePath) {
		captureScheduler = ensureCaptureScheduler(cliOptions.inputTimelinePath);
		await scheduleInputTimelineFromFile(cliOptions.inputTimelinePath, frameInterval, postInput, captureScheduler, inputLogger, scheduler, armTimelineAutoExit);
		scheduledTimeline = true;
	} else if (autoTimelinePath) {
		captureScheduler = ensureCaptureScheduler(autoTimelinePath);
		await scheduleInputTimelineFromFile(autoTimelinePath, frameInterval, postInput, captureScheduler, inputLogger, scheduler, armTimelineAutoExit);
		scheduledTimeline = true;
	}
	const hasTimelineRun = scheduledTimeline;
	const defaultTtl = hostTestRunState || hasTimelineRun ? 60_000 : 1_000;
	const pendingExitSettleMs = hostTestRunState ? 15_000 : 5_000;
	const minTtl = Math.max(defaultTtl, getPendingScheduledDelayMs(scheduler.nowMs(), pendingExitSettleMs));
	const requestedTtl = typeof cliOptions.ttlMs === 'number' && cliOptions.ttlMs > 0 ? Math.round(cliOptions.ttlMs) : defaultTtl;
	const ttlMs = Math.max(requestedTtl, minTtl);
	console.log(`[bootrom:${__BOOTROM_TARGET__}] TTL set to ${ttlMs}ms (min required ${minTtl}ms).`);
	scheduler.scheduleOnce(ttlMs, () => {
		try {
			if (hostTestRunState) {
				assertHostTestRunState(hostTestRunState);
			}
		} catch (error) {
			console.error(`[bootrom:${__BOOTROM_TARGET__}] Fatal error:`, error);
			requestExit(1);
			return;
		}
		console.log(`[bootrom:${__BOOTROM_TARGET__}] TTL reached (${ttlMs}ms). Terminating.`);
		requestExit(0);
	});

	const bootArgs: BootArgs = {
		cartridge: buffer,
		engineAssets: engineAssetsBuffer,
		platform,
		viewHost: platform.gameviewHost,
	};
	if (debugFlag) {
		bootArgs.debug = true;
	}

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Starting game (debug=${debugFlag}, frameIntervalMs=${frameInterval}).`);
	await runtime.startCart(bootArgs);
	if (cliOptions.cpuProfile) {
		runtime.setCpuProfilerEnabled(true);
		cpuProfileActive = true;
		console.log(`[bootrom:${__BOOTROM_TARGET__}] Fantasy CPU profiler enabled.`);
	}
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Game loop running. Press Ctrl+C to exit.`);
}

main().catch(err => {
	console.error(`[bootrom:${__BOOTROM_TARGET__}] Fatal error:`, err);
	if (processExitController) {
		processExitController(1);
		return;
	}
	process.exitCode = 1;
});
