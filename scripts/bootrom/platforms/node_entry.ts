import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { createCanvas, Image, loadImage } from 'canvas';

import { machineManager, type MachineInitializationOptions } from '../../../machine/ts/core/machine_manager';
import { prepareMachineRuntime, startMachineHostFrames } from '../../../runtime/machine_runtime';
import { createHeadlessIdeHarness } from '../../../ide/testing/headless_harness';
import { CpuProfilerSession, formatCpuProfilerReport } from '../cpu_profiler';
import { HEADLESS_DEFAULT_FRAME_INTERVAL_MS, HeadlessPlatformServices } from '../../../hosts/node/headless/platform_headless';
import { CLIPlatformServices } from '../../../hosts/node/cli/platform_cli';
import type { Platform, InputEvt } from 'bmsx/platform';
import { HeadlessGameViewHost, type HeadlessPresentedFrame } from '../../../machine/ts/render/headless/view';
import { HeadlessCaptureCoordinator, deriveHeadlessCaptureOutputDir, type ScheduledHeadlessCapture, type ScheduledHeadlessFrameCapture } from './headless_capture';
import { runHostTest } from './hostrunner/host_test_runner';
import { buildHostTestCartridge, HOST_TEST_API_PATH } from './hostrunner/host_test_cartridge';
import { runIdeTest } from './hostrunner/ide_test_runner';

declare const __BOOTROM_TARGET__: 'cli' | 'headless';
declare const __BOOTROM_DEBUG__: boolean;

interface LaunchOptions {
	romPath?: string;
	slot1Path?: string;
	romFolder?: string;
	frameIntervalMs?: number;
	debugOverride?: boolean;
	inputTimelinePath?: string;
	testPath?: string;
	ideTestPath?: string;
	ttlMs?: number;
	systemRomPath?: string;
	cpuProfile?: boolean;
}

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

interface TimelineCaptureSink {
	schedule(capture: ScheduledHeadlessCapture): void;
	scheduleFrame(capture: ScheduledHeadlessFrameCapture, frameClock: TimelineFrameClock | null): void;
}

interface TimelineFrameClock {
	frameForTimeMs(timeMs: number): number;
	delayMsForFrame(frame: number): number;
	scheduleAtPresentationBoundary(frame: number, cb: () => void): void;
	scheduleFrameCapture(capture: ScheduledHeadlessFrameCapture, coordinator: HeadlessCaptureCoordinator): void;
}

interface PendingTimelineFrameCallback {
	frame: number;
	cb: () => void;
}

interface PendingTimelineFrameCapture {
	frame: number;
	outputFrame: number;
	coordinator: HeadlessCaptureCoordinator;
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

class HeadlessPresentationTimelineFrameClock implements TimelineFrameClock {
	private readonly pendingCallbacks: PendingTimelineFrameCallback[] = [];
	private readonly pendingCaptures: PendingTimelineFrameCapture[] = [];

	public constructor(
		private readonly host: HeadlessGameViewHost,
		private readonly frameIntervalMs: number,
	) {
		host.addPresentedFrameListener((presentedFrame) => {
			this.handlePresentedFrame(presentedFrame);
		});
	}

	public frameForTimeMs(timeMs: number): number {
		return Math.round(timeMs / this.frameIntervalMs);
	}

	public delayMsForFrame(frame: number): number {
		return Math.max(0, frame * this.frameIntervalMs);
	}

	public scheduleAtPresentationBoundary(frame: number, cb: () => void): void {
		if (frame < this.host.presentedFrameCount) {
			cb();
			return;
		}
		this.pendingCallbacks.push({ frame, cb });
	}

	public scheduleFrameCapture(capture: ScheduledHeadlessFrameCapture, coordinator: HeadlessCaptureCoordinator): void {
		this.pendingCaptures.push({
			frame: capture.frame,
			outputFrame: capture.outputFrame,
			coordinator,
		});
	}

	private handlePresentedFrame(presentedFrame: HeadlessPresentedFrame): void {
		// Presentation M fulfills capture marker M-1, then opens boundary M for the next frame's input.
		this.runDueCaptures(presentedFrame, presentedFrame.frameIndex);
		this.runDueCallbacks(presentedFrame.frameIndex);
	}

	private runDueCallbacks(timelineFrame: number): void {
		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.pendingCallbacks.length; readIndex += 1) {
			const pending = this.pendingCallbacks[readIndex]!;
			if (timelineFrame >= pending.frame) {
				pending.cb();
				continue;
			}
			this.pendingCallbacks[writeIndex] = pending;
			writeIndex += 1;
		}
		this.pendingCallbacks.length = writeIndex;
	}

	private runDueCaptures(presentedFrame: HeadlessPresentedFrame, presentationOrdinal: number): void {
		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.pendingCaptures.length; readIndex += 1) {
			const pending = this.pendingCaptures[readIndex]!;
			if (presentationOrdinal > pending.frame) {
				pending.coordinator.capturePresentedFrame(presentedFrame, pending.outputFrame);
				continue;
			}
			this.pendingCaptures[writeIndex] = pending;
			writeIndex += 1;
		}
		this.pendingCaptures.length = writeIndex;
	}
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
	console.log('  --rom, --slot0, -r <path>  Cartridge slot 0 ROM.');
	console.log('  --slot1 <path>              Cartridge slot 1 ROM.');
	console.log('  --frame-interval <ms>    Override frame loop interval in milliseconds (default: PCRTC reset cadence).');
	console.log('  --debug                  Force debug mode.');
	console.log('  --no-debug               Force non-debug mode.');
	console.log('  --ttl <seconds>          Auto-terminate after the given number of seconds (default 10).');
	console.log('  --input-timeline <file>  JSON timeline of InputEvt entries to schedule; headless capture markers write screenshots next to the timeline.');
	console.log('  --test <file>            Host test file executed by the headless test runner.');
	console.log('  --ide-test <file>        Host-side IDE test (JS) driving editor and hot-resume.');
	console.log('  --system-rom <path>      System ROM (defaults to dist/bmsx-bios(.debug).rom).');
	console.log('  --cpu-profile            Enable fantasy CPU profiling and print a report on exit.');
	console.log('  --help, -h               Show this help message.');
	console.log('');
	console.log('romFolder:');
	console.log('  If --rom is omitted, a romFolder positional argument resolves to');
	console.log('  dist/<romFolder>(.debug).rom and auto-looks for timeline under');
	console.log('  tests/carts/<romFolder>/.');
}

function parseArgs(argv: string[]): LaunchOptions {
	const options: LaunchOptions = {};
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index];
		switch (arg) {
			case '--rom':
			case '--slot0':
			case '-r': {
				const next = argv[index + 1];
				if (!next) {
					throw new Error(`Expected ROM path after ${arg}.`);
				}
				options.romPath = next;
				index += 2;
				continue;
			}
		}
		if (arg === '--slot1') {
			const next = argv[index + 1];
			if (!next) {
				throw new Error('Expected ROM path after --slot1.');
			}
			options.slot1Path = next;
			index += 2;
			continue;
		}
		if (arg === '--frame-interval') {
			const next = argv[index + 1];
			if (!next) {
				throw new Error('Expected number after --frame-interval.');
			}
			const parsed = Number(next);
			if (!(parsed > 0 && parsed < Infinity)) {
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
		if (arg === '--ide-test') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --ide-test.');
			options.ideTestPath = next;
			index += 2;
			continue;
		}
		if (arg === '--cpu-profile') {
			options.cpuProfile = true;
			index += 1;
			continue;
		}
		if (arg === '--system-rom') {
			const next = argv[index + 1];
			if (!next) throw new Error('Expected path after --system-rom.');
			options.systemRomPath = next;
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

function installWorkspaceFetchBridge(workspaceRoot: string): void {
	if (workspaceFetchBridgeInstalled) {
		return;
	}
	const existingFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let url: URL = null;
		if (typeof input === 'string') {
			url = new URL(input, 'http://workspace.local');
		} else if (input instanceof URL) {
			url = input;
		}
		if (!url || url.pathname !== WORKSPACE_FILE_ENDPOINT) {
			return existingFetch(input, init);
		}
		return handleWorkspaceFetch(
			url,
			init!.method!,
			init!.body as string,
			workspaceRoot,
		);
	};
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Workspace fetch bridge mounted (${workspaceRoot}).`);
	workspaceFetchBridgeInstalled = true;
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

function jsonResponse(status: number, payload: unknown): Response {
	const body = payload === null ? null : JSON.stringify(payload);
	return new Response(body, {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function handleWorkspaceFetch(
	url: URL,
	method: string,
	bodyText: string,
	workspaceRoot: string,
): Promise<Response> {
	if (method === 'GET') {
		const targetPath = url.searchParams.get('path');
		if (!targetPath) {
			return jsonResponse(400, { error: 'Missing "path" query parameter.' });
		}
		try {
			const filePath = resolveWorkspaceFilePath(workspaceRoot, targetPath);
			const stats = await fs.stat(filePath);
			const contents = await fs.readFile(filePath, 'utf8');
			return jsonResponse(200, {
				path: targetPath,
				contents,
				updatedAt: Math.round(stats.mtimeMs),
			});
		} catch (error) {
			const message = toErrorMessage(error);
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return jsonResponse(404, { error: `File not found: ${targetPath}` });
			}
			return jsonResponse(500, { error: message });
		}
	}
	if (method === 'PUT') {
		const payload = JSON.parse(bodyText);
		const filePath = resolveWorkspaceFilePath(workspaceRoot, payload.path);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, payload.contents, 'utf8');
		const modifiedSeconds = payload.updatedAt / 1000;
		await fs.utimes(filePath, modifiedSeconds, modifiedSeconds);
		return jsonResponse(204, null);
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
	return new Response(null, { status: 405, headers: { Allow: 'GET,PUT,DELETE' } });
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

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveAutoTimelinePath(romFolder: string | undefined): Promise<string | null> {
	if (!romFolder) {
		return null;
	}
	const demoPath = path.resolve('tests', 'carts', romFolder, `${romFolder}_demo.json`);
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
		return await fs.readFile(filePath);
	} catch (err) {
		throw new Error(`Unable to read ROM file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function scheduleInputTimelineFromFile(
	filePath: string,
	frameIntervalMs: number,
	postInput: (evt: InputEvt) => void,
	scheduleCapture: TimelineCaptureSink | null,
	logger: (msg: string) => void,
	scheduler: TimelineScheduler,
	createFrameClock: (() => TimelineFrameClock | null) | null,
	onScheduled?: (frameClock: TimelineFrameClock | null, lastFrame: number) => void,
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
	const frameClock = createFrameClock ? createFrameClock() : null;
	if (frameClock) {
		logger(`[${source}] arming presentation-frame timeline`);
		const lastFrame = scheduleTimelineEntries(entries, frameIntervalMs, postInput, scheduleCapture, logger, source, scheduler, frameClock);
		onScheduled?.(frameClock, lastFrame);
		return;
	}
	logger(`[${source}] arming load-relative timeline`);
	const lastFrame = scheduleTimelineEntries(entries, frameIntervalMs, postInput, scheduleCapture, logger, source, scheduler, null);
	onScheduled?.(null, lastFrame);
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
	scheduleCapture: TimelineCaptureSink | null,
	logger: (msg: string) => void,
	source: string,
	scheduler: TimelineScheduler,
	frameClock: TimelineFrameClock | null,
): number {
	let lastAbsoluteMs = 0;
	let lastFrame = -1;
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
					if (frameClock) {
						const frame = resolveTimelinePointFrame(point, frameClock);
						if (frame > lastFrame) {
							lastFrame = frame;
						}
						trackScheduledDeadline(scheduler.nowMs(), frameClock.delayMsForFrame(frame));
						logger(`[${source}] capture ${description} at frame ${frame}`);
						scheduleCapture?.scheduleFrame({
							frame,
							outputFrame: frame,
							description,
							source,
						}, frameClock);
					} else {
						const delay = resolveTimelineScheduleDelay(point);
						trackScheduledDeadline(scheduler.nowMs(), delay);
						logger(`[${source}] capture ${description} at ${delay}ms`);
						scheduleCapture?.schedule({
							dueTimeMs: point.timeMs,
						description,
						source,
					});
				}
			});
		}
		if (!hasEvent) {
			return;
			}
			executionPoints.forEach((point) => {
				if (frameClock) {
					const frame = resolveTimelinePointFrame(point, frameClock);
					if (frame > lastFrame) {
						lastFrame = frame;
					}
					trackScheduledDeadline(scheduler.nowMs(), frameClock.delayMsForFrame(frame));
					logger(`[${source}] schedule ${description} at frame ${frame}`);
					frameClock.scheduleAtPresentationBoundary(frame, () => {
						const cloned = typeof structuredClone === 'function' ? structuredClone(entry.event) : JSON.parse(JSON.stringify(entry.event));
						postInput(cloned);
					});
					return;
				}
				const delay = resolveTimelineScheduleDelay(point);
				trackScheduledDeadline(scheduler.nowMs(), delay);
				logger(`[${source}] schedule ${description} at ${delay}ms`);
				scheduler.scheduleOnce(delay, () => {
					const cloned = typeof structuredClone === 'function' ? structuredClone(entry.event) : JSON.parse(JSON.stringify(entry.event));
					postInput(cloned);
			});
		});
	});
	return lastFrame;
}

function resolveTimelinePointFrame(point: TimelineExecutionPoint, frameClock: TimelineFrameClock): number {
	return point.frame !== undefined ? point.frame : frameClock.frameForTimeMs(point.timeMs);
}

function resolveTimelineScheduleDelay(point: TimelineExecutionPoint): number {
	return Math.max(0, Math.round(point.timeMs));
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
): TimelineCaptureSink | null {
	if (!host) {
		return null;
	}
	return {
		schedule: (capture: ScheduledHeadlessCapture): void => {
			const coordinator = ensureHeadlessCaptureCoordinator(host, sourcePath, logger, getCoordinator, setCoordinator, scheduler);
			if (!coordinator) {
				return;
			}
			coordinator.schedule(capture);
		},
		scheduleFrame: (capture: ScheduledHeadlessFrameCapture, frameClock: TimelineFrameClock | null): void => {
			const coordinator = ensureHeadlessCaptureCoordinator(host, sourcePath, logger, getCoordinator, setCoordinator, scheduler);
			if (!coordinator) {
				return;
			}
			if (frameClock) {
				frameClock.scheduleFrameCapture(capture, coordinator);
				return;
			}
			coordinator.scheduleFrame(capture);
		},
	};
}

function createPlatform(frameIntervalMs: number): Platform {
	if (__BOOTROM_TARGET__ === 'headless') {
		return new HeadlessPlatformServices({ frameIntervalMs, unpaced: true });
	}
	if (__BOOTROM_TARGET__ === 'cli') {
		return new CLIPlatformServices({ frameIntervalMs });
	}
	throw new Error(`Unsupported boot platform: ${__BOOTROM_TARGET__}`);
}

async function main(): Promise<void> {
	const cliOptions = parseArgs(process.argv.slice(2));
	const debugFlag = cliOptions.debugOverride ?? __BOOTROM_DEBUG__;
	const romPath = resolveRomPath(cliOptions, debugFlag);
	const frameInterval = cliOptions.frameIntervalMs ?? HEADLESS_DEFAULT_FRAME_INTERVAL_MS;

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Loading ROM: ${romPath}`);
	const romDirectory = path.resolve(path.dirname(romPath));
	const systemRomPath = cliOptions.systemRomPath
		? path.resolve(cliOptions.systemRomPath)
		: path.join(romDirectory, debugFlag ? 'bmsx-bios.debug.rom' : 'bmsx-bios.rom');
	assertDebugArtifacts('System ROM', debugFlag, systemRomPath);
	const workspaceRoot = path.resolve(romDirectory, '..');
	console.log(`[bootrom:${__BOOTROM_TARGET__}] Loading system ROM: ${systemRomPath}`);
	const systemRomBuffer = await readRomFile(systemRomPath);

	let buffer = await readRomFile(romPath);
	const slot1Buffer = cliOptions.slot1Path
		? await readRomFile(path.resolve(cliOptions.slot1Path))
		: null;
	if (cliOptions.testPath) {
		const apiSource = await fs.readFile(path.resolve(HOST_TEST_API_PATH), 'utf8');
		const testSource = await fs.readFile(path.resolve(cliOptions.testPath), 'utf8');
		buffer = await buildHostTestCartridge(systemRomBuffer, buffer, `${apiSource}\n${testSource}`);
	}
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
	let cpuProfilerSession: CpuProfilerSession | null = null;
	const baseRequestExit = createProcessExitController(() => captureCoordinator);
	const postInput = (event: InputEvt) => {
		platform.input.post(event);
	};
	const inputLogger = (message: string) => console.log(`[bootrom:${__BOOTROM_TARGET__}:input] ${message}`);
	const romFolder = cliOptions.romFolder;
	const autoTimelinePath = await resolveAutoTimelinePath(romFolder);
	const selectedTimelinePath = cliOptions.inputTimelinePath || autoTimelinePath;
	const inputTimelineSelected = !cliOptions.ideTestPath && !cliOptions.testPath && !!selectedTimelinePath;
	const deferStartForTimeline = __BOOTROM_TARGET__ === 'headless' && inputTimelineSelected;
	let hostTestRunState: HostTestRunState | null = null;
	let captureScheduler: TimelineCaptureSink | null = null;
	let timelineAutoExitArmed = false;
	const armTimelineAutoExit = (frameClock: TimelineFrameClock | null, lastFrame: number): void => {
		if (timelineAutoExitArmed || hostTestRunState) {
			return;
		}
		timelineAutoExitArmed = true;
		if (frameClock && lastFrame >= 0) {
			frameClock.scheduleAtPresentationBoundary(lastFrame + 1, () => {
				console.log(`[bootrom:${__BOOTROM_TARGET__}] Input timeline completed. Terminating.`);
				requestExit(0);
			});
			return;
		}
		const timelineExitDelayMs = getPendingScheduledDelayMs(scheduler.nowMs(), frameInterval);
		if (timelineExitDelayMs > 0) {
			scheduler.scheduleOnce(timelineExitDelayMs, () => {
				console.log(`[bootrom:${__BOOTROM_TARGET__}] Input timeline completed. Terminating.`);
				requestExit(0);
			});
		}
	};
	const ensureCaptureScheduler = (sourcePath: string): TimelineCaptureSink | null => {
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
	const bootArgs: MachineInitializationOptions = {
		cartridgeSlots: [buffer, slot1Buffer],
		systemRom: systemRomBuffer,
		debug: debugFlag,
		platform,
		viewHost: platform.gameviewHost,
	};

	console.log(`[bootrom:${__BOOTROM_TARGET__}] Starting game (debug=${debugFlag}, frameIntervalMs=${frameInterval}).`);
	const runtimeIde = await prepareMachineRuntime(bootArgs);
	const runtime = machineManager.runtime;
	if (!deferStartForTimeline) {
		startMachineHostFrames(runtimeIde);
	}
	const requestExit = (code: number): void => {
		if (!cpuProfileDumped && cpuProfilerSession) {
			cpuProfileDumped = true;
			console.log(`[bootrom:${__BOOTROM_TARGET__}] Fantasy CPU profiler report:`);
			console.log(formatCpuProfilerReport(cpuProfilerSession.snapshot()));
		}
		baseRequestExit(code);
	};
	processExitController = requestExit;
	if (cliOptions.cpuProfile) {
		cpuProfilerSession = new CpuProfilerSession(runtime.machine.cpu, runtimeIde.sources);
		cpuProfilerSession.enable();
		console.log(`[bootrom:${__BOOTROM_TARGET__}] Fantasy CPU profiler enabled.`);
	}
	const createTimelineFrameClock = (): TimelineFrameClock | null => {
		return headlessHost ? new HeadlessPresentationTimelineFrameClock(headlessHost, frameInterval) : null;
	};
	let scheduledTimeline = false;
	if (cliOptions.ideTestPath) {
		const ide = createHeadlessIdeHarness(runtimeIde, runtime);
		await runIdeTest({
			testPath: cliOptions.ideTestPath,
			frameIntervalMs: frameInterval,
			ide,
			logger: inputLogger,
			scheduleOnce: (delayMs, cb) => scheduler.scheduleOnce(delayMs, () => cb()),
			requestExit,
		});
	} else if (cliOptions.testPath) {
		hostTestRunState = {
			moduleLabel: path.basename(cliOptions.testPath),
			requireExplicitFinish: true,
			assertCount: 0,
			finished: false,
		};
		runHostTest({
			testPath: cliOptions.testPath,
			frameIntervalMs: frameInterval,
			logger: inputLogger,
			runtime,
			postInput,
			requestExit,
			scheduler,
			runState: hostTestRunState,
			captureNow: ensureImmediateCapture(cliOptions.testPath),
			canCaptureNow: canCaptureImmediately,
		});
	} else if (cliOptions.inputTimelinePath) {
		captureScheduler = ensureCaptureScheduler(cliOptions.inputTimelinePath);
		await scheduleInputTimelineFromFile(cliOptions.inputTimelinePath, frameInterval, postInput, captureScheduler, inputLogger, scheduler, createTimelineFrameClock, armTimelineAutoExit);
		scheduledTimeline = true;
	} else if (autoTimelinePath) {
		captureScheduler = ensureCaptureScheduler(autoTimelinePath);
		await scheduleInputTimelineFromFile(autoTimelinePath, frameInterval, postInput, captureScheduler, inputLogger, scheduler, createTimelineFrameClock, armTimelineAutoExit);
		scheduledTimeline = true;
	}
	if (deferStartForTimeline) {
		startMachineHostFrames(runtimeIde);
	}
	const hasTimelineRun = scheduledTimeline;
	const defaultTtl = hostTestRunState || hasTimelineRun || cliOptions.ideTestPath ? 60_000 : 1_000;
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
