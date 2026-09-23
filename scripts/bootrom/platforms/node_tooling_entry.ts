import { runGuestTests } from './hostrunner/test_runner';
import { Worker } from 'node:worker_threads';
import { NodeGraphLayoutEngine } from '../../../ide/node/graph_layout';
import { HostExecutionControl } from '../../../hosts/common/execution_control';
import { HostRewind } from '../../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../../hosts/common/runtime_task_queue';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
	prepareWorkbenchRuntime,
} from '../../../ide/workbench/machine_runtime';
import { runWorkbenchHostFrame } from '../../../ide/workbench/host_frame';
import { RESOURCE_PANEL_DEFAULT_RATIO } from '../../../ide/common/constants';
import { IdeMicrotaskQueue } from '../../../ide/common/microtask_queue';
import { createHeadlessIdeHarness } from '../../../ide/testing/headless_harness';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { OffscreenVideoOutput } from '../../../hosts/common/offscreen_video_output';
import { Input } from '../../../hosts/common/input/manager';
import { ConsoleLogOutput } from '../../../hosts/common/log';
import type { LogOutput } from '../../../hosts/common/log';
import { DiscardingAudioSink } from '../../../hosts/node/common/discarding_audio';
import { RealtimeHeadlessClock, VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import {
	HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	UnpacedHeadlessFrameLoop,
	RealtimeHeadlessFrameLoop,
} from '../../../hosts/node/headless/frame_loop';
import { HeadlessClipboard } from '../../../hosts/node/headless/clipboard';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { MemoryStorage } from '../../../ide/workspace/memory_storage';
import {
	persistWorkspaceSessionLocally,
	shutdownWorkspaceStorage,
} from '../../../ide/workbench/workspace/storage';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../../../hosts/common/machine_runtime';
import { HostAudioOutput } from '../../../hosts/common/audio_output';
import {
	HostFrameRunResult,
	HostFrameSession,
	runHostFrame,
} from '../../../hosts/common/host_frame';
import { HostOverlayMenu } from '../../../hosts/common/host_overlay_menu';
import { RenderPresentationState } from '../../../hosts/common/presentation_state';
import { SystemOutputLog } from '../../../hosts/common/system_output_log';
import { CpuProfilerSession, formatCpuProfilerReport } from '../cpu_profiler';
import {
	loadBlua32ToolingImage,
	type Blua32ToolingImage,
} from '../../../toolchain/ts/rompack/blua32_media';
import { loadRomToolingMedia } from '../../../toolchain/ts/rompack/media';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { runCpuProfileHostFrame } from './cpu_profile_frame';
import {
	HeadlessCaptureCoordinator,
	deriveHeadlessCaptureOutputDir,
} from './headless_capture';
import { runIdeTest } from './hostrunner/ide_test_runner';
import { InputTimeline } from './input_timeline';
import {
	NODE_TOOLING_HELP,
	parseNodeToolingOptions,
} from './node_tooling_options';
import { DiskWorkspaceRecordProvider } from '../../../ide/node/workspace_records';
import { RecordingLogOutput } from '../../../ide/testing/recording_log_output';
import { createRuntimeSourceState } from '../../../ide/runtime/sources';
import { RemoteInput } from '../../../hosts/common/input/remote';
import { HostControlServer } from '../../../hosts/node/control/server';
import { HostControlSession } from '../../../hosts/node/control/session';
import type { HostClock } from '../../../hosts/common/clock';
import type { FrameLoop } from '../../../hosts/common/frame_loop';

declare const BMSX_BOOTROM_DEBUG: boolean;

async function main(): Promise<void> {
	const command = parseNodeToolingOptions(
		process.argv.slice(2),
		BMSX_BOOTROM_DEBUG,
		HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	);
	if (command.kind === 'help') {
		console.log(NODE_TOOLING_HELP);
		return;
	}
	const options = command.options;

	console.log(`[bootrom:headless] Loading ROM: ${options.romPath}`);
	console.log(`[bootrom:headless] Loading system ROM: ${options.systemRomPath}`);
	const [systemRom, originalSlot0Rom, slot1Rom] = await Promise.all([
		fs.readFile(options.systemRomPath),
		fs.readFile(options.romPath),
		options.slot1Path
			? fs.readFile(options.slot1Path)
			: Promise.resolve(null),
	]);

	const slot0Rom: Uint8Array = originalSlot0Rom;
	if (options.mode.kind === 'host-test') {
		await runGuestTests(systemRom, [slot0Rom, slot1Rom], options.mode.path, options.ttlMs, options.mode.caseName);
		return;
	}

	let clock: HostClock;
	let frames: FrameLoop;
	if (options.mode.kind === 'control') {
		clock = new RealtimeHeadlessClock();
		frames = new RealtimeHeadlessFrameLoop(clock, options.frameIntervalMs);
	} else {
		const virtualClock = new VirtualHeadlessClock();
		clock = virtualClock;
		frames = new UnpacedHeadlessFrameLoop(virtualClock, options.frameIntervalMs);
	}
	const inputHub = new HeadlessInputHub();
	const input = new Input(
		clock,
		inputHub,
		-1,
	);
	const videoOutput = new OffscreenVideoOutput(256, 212);
	const videoBackend = new HeadlessGPUBackend(
		256,
		212,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	const consoleLogOutput = new ConsoleLogOutput();
	let ideTestLogOutput: RecordingLogOutput;
	let logOutput: LogOutput;
	if (options.mode.kind === 'ide-test') {
		ideTestLogOutput = new RecordingLogOutput(consoleLogOutput);
		logOutput = ideTestLogOutput;
	} else {
		logOutput = consoleLogOutput;
	}
	const runtime = initializeMachineRuntime(
		systemRom,
		[slot0Rom, slot1Rom],
		PSX_MACHINE_SPEC,
		input,
	);
	const presenter = initializeMachineVideoPresenter(
		runtime,
		videoOutput,
		videoBackend,
	);
	const audioOutput = new HostAudioOutput(
		new DiscardingAudioSink(),
		runtime.machine.audioController,
		runtime.machine.audioOutput.outputRing,
		runtime.timing.ufpsScaled,
	);
	const systemOutput = new SystemOutputLog();
	const runtimeTasks = new RuntimeTaskQueue(audioOutput, presenter);
	const presentation = new RenderPresentationState();
	const execution = new HostExecutionControl(audioOutput);
	const rewind = new HostRewind(runtime, presenter, presentation, runtimeTasks, audioOutput, logOutput);
	const frameSession = new HostFrameSession(
		runtime.timing.ufpsScaled,
		clock.now(),
		rewind,
		execution,
	);
	const hostOverlayMenu = new HostOverlayMenu(presenter, runtime, input, rewind, execution);
	const inputLogger = (message: string): void => {
		console.log(`[bootrom:headless:input] ${message}`);
	};

	console.log(
		`[bootrom:headless] Starting game (debug=${options.debug}, frameIntervalMs=${options.frameIntervalMs}).`,
	);
	console.log(`[bootrom:headless] TTL set to ${options.ttlMs}ms.`);

	let profile: CpuProfilerSession | null = null;
	if (options.cpuProfile) {
		const media = await loadRomToolingMedia(systemRom, [slot0Rom, slot1Rom]);
		const systemLayer = media.system;
		const cartridgeImages: [Blua32ToolingImage | null, Blua32ToolingImage | null] = [null, null];
		for (let slot = 0; slot < media.cartridgeSlots.length; slot += 1) {
			const cartridgeLayer = media.cartridgeSlots[slot];
			if (!cartridgeLayer) {
				continue;
			}
			cartridgeImages[slot] = loadBlua32ToolingImage(cartridgeLayer, CART_ROM_BASE);
		}
		profile = new CpuProfilerSession({
			system: loadBlua32ToolingImage(systemLayer, SYSTEM_ROM_BASE),
			cartridgeSlots: cartridgeImages,
		});
		console.log('[bootrom:headless] Fantasy CPU profiler enabled.');
	}
	if (options.mode.kind !== 'ide-test' && !(options.mode.kind === 'control' && options.mode.workspaceRoot !== undefined)) {
		runtime.resetForSystemBoot();
		runtime.boot();
		systemOutput.flush(runtime, logOutput);
		audioOutput.bootstrap();
	}

	try {
		switch (options.mode.kind) {
		case 'control': {
			const clipboard = new HeadlessClipboard();
			const workspaceRoot = options.mode.workspaceRoot;
			const ide = workspaceRoot === undefined ? undefined : await prepareWorkbenchRuntime(
				systemRom, [slot0Rom, slot1Rom], runtime, presenter, videoOutput, input, audioOutput,
				runtimeTasks, execution, rewind, hostOverlayMenu,
				new MemoryStorage(), new DiskWorkspaceRecordProvider(workspaceRoot), clock,
				clipboard, new IdeMicrotaskQueue(), logOutput, RESOURCE_PANEL_DEFAULT_RATIO,
				() => new NodeGraphLayoutEngine(new Worker(path.join(__dirname, 'graph-layout.node-worker.cjs'))),
			);
			if (ide) {
				systemOutput.flush(runtime, logOutput);
				audioOutput.bootstrap();
			}
			const captureDirectory = path.resolve('.bmsx/control/screenshots', String(process.pid));
			await fs.mkdir(captureDirectory, { recursive: true });
			const control = new HostControlSession(new RemoteInput(inputHub, clock), videoBackend, captureDirectory, ide ? clipboard : undefined);
			const finished = Promise.withResolvers<void>();
			const server = new HostControlServer(request => control.execute(request), () => control.disconnect(), finished.resolve);
			const port = await server.listen(options.mode.port);
			console.log(JSON.stringify({ hostControl: { port, studio: !!ide, captureDirectory } }));
			process.once('SIGINT', finished.resolve);
			process.once('SIGTERM', finished.resolve);
			const timer = options.ttlMs > 0 ? clock.scheduleOnce(options.ttlMs, () => finished.resolve()) : undefined;
			runtime.frameScheduler.clearQueuedTime();
			const loop = frames.start(currentTime => {
				try {
					const result = ide
						? runWorkbenchHostFrame(frameSession, runtime, presenter, input, audioOutput, systemOutput, logOutput, ide, presentation, hostOverlayMenu, currentTime)
						: runHostFrame(frameSession, runtime, presenter, input, audioOutput, systemOutput, logOutput, presentation, hostOverlayMenu, currentTime);
					control.afterFrame();
					if (result === HostFrameRunResult.ExitRequested) finished.resolve();
				} catch (error) {
					finished.reject(error);
				}
			});
			try {
				await finished.promise;
			} finally {
				loop.stop();
				timer?.cancel();
				process.removeListener('SIGINT', finished.resolve);
				process.removeListener('SIGTERM', finished.resolve);
				control.dispose();
				await server.close();
				if (ide) await shutdownWorkspaceStorage();
			}
			return;
		}
		case 'ide-test': {
				const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-ide-test-'));
				try {
					const microtasks = new IdeMicrotaskQueue();
					const storage = new MemoryStorage();
					const capture = new HeadlessCaptureCoordinator(
						videoBackend,
						deriveHeadlessCaptureOutputDir(options.mode.path),
						() => clock.now(),
					);
					console.log(
						`[bootrom:headless:input] [capture] screenshots -> ${capture.outputDir}`,
					);
					const ide = await prepareWorkbenchRuntime(
						systemRom,
						[slot0Rom, slot1Rom],
						runtime,
						presenter,
						videoOutput,
						input,
						audioOutput,
						runtimeTasks,
						execution,
						rewind,
						hostOverlayMenu,
						storage,
						new DiskWorkspaceRecordProvider(workspaceRoot),
						clock,
						new HeadlessClipboard(),
						microtasks,
						logOutput,
						RESOURCE_PANEL_DEFAULT_RATIO,
						() => new NodeGraphLayoutEngine(new Worker(path.join(__dirname, 'graph-layout.node-worker.cjs'))),
					);
					systemOutput.flush(runtime, logOutput);
					audioOutput.bootstrap();
					const interrupt = (): never => {
						persistWorkspaceSessionLocally();
						process.exit(130);
					};
					const terminate = (): never => {
						persistWorkspaceSessionLocally();
						process.exit(143);
					};
					process.once('SIGINT', interrupt);
					process.once('SIGTERM', terminate);
					let passed = false;
					try {
						runtime.frameScheduler.clearQueuedTime();
						const frameLoop = frames.start((currentTime) => {
							const result = runWorkbenchHostFrame(
								frameSession,
								runtime,
								presenter,
								input,
								audioOutput,
								systemOutput,
								logOutput,
								ide,
								presentation,
								hostOverlayMenu,
								currentTime,
							);
							if (result === HostFrameRunResult.ExitRequested) {
								frameLoop.stop();
								persistWorkspaceSessionLocally();
								process.exit(0);
							}
						});
						await Promise.race([
							runIdeTest({
								testPath: options.mode.path,
								frameIntervalMs: options.frameIntervalMs,
								ide: createHeadlessIdeHarness(
									ide,
									runtime,
									audioOutput,
									storage,
									ideTestLogOutput,
								),
								logger: inputLogger,
								clock,
								input: inputHub,
								capture,
							}),
							new Promise<never>((_resolve, reject) => {
								clock.scheduleOnce(options.ttlMs, () => {
									reject(new Error('IDE test did not finish before TTL.'));
								});
							}),
						]);
						passed = true;
					} finally {
						process.removeListener('SIGINT', interrupt);
						process.removeListener('SIGTERM', terminate);
						await capture.flushWrites(passed);
						capture.dispose();
					}
				} finally {
					try {
						await shutdownWorkspaceStorage();
					} finally {
						await fs.rm(workspaceRoot, { recursive: true });
					}
				}
				return;
			}
			case 'timeline': {
				const capture = new HeadlessCaptureCoordinator(
					videoBackend,
					deriveHeadlessCaptureOutputDir(options.mode.path),
					() => clock.now(),
				);
				console.log(
					`[bootrom:headless:input] [capture] screenshots -> ${capture.outputDir}`,
				);
				let completed = false;
				try {
					const timeline = await InputTimeline.load(
						options.mode.path,
						options.frameIntervalMs,
						videoBackend,
						inputHub,
						runtime,
						capture,
						inputLogger,
					);
					runtime.frameScheduler.clearQueuedTime();
					if (profile) {
						const frameLoop = frames.start((currentTime) => {
							const result = runCpuProfileHostFrame(
								frameSession,
								runtime,
								presenter,
								input,
								audioOutput,
								systemOutput,
								logOutput,
								presentation,
								hostOverlayMenu,
								profile,
								currentTime,
							);
							if (result === HostFrameRunResult.ExitRequested) {
								frameLoop.stop();
								process.exit(0);
							}
						});
					} else {
						const frameLoop = frames.start((currentTime) => {
							const result = runHostFrame(
								frameSession,
								runtime,
								presenter,
								input,
								audioOutput,
								systemOutput,
								logOutput,
								presentation,
								hostOverlayMenu,
								currentTime,
							);
							if (result === HostFrameRunResult.ExitRequested) {
								frameLoop.stop();
								process.exit(0);
							}
						});
					}
					await Promise.race([
						timeline.completion,
						new Promise<never>((_resolve, reject) => {
							clock.scheduleOnce(options.ttlMs, () => {
								reject(new Error('Input timeline did not finish before TTL.'));
							});
						}),
					]);
					completed = true;
				} finally {
					await capture.flushWrites(completed);
					capture.dispose();
				}
				console.log('[bootrom:headless] Input timeline completed.');
				return;
			}
			case 'plain': {
				runtime.frameScheduler.clearQueuedTime();
				if (profile) {
					const frameLoop = frames.start((currentTime) => {
						const result = runCpuProfileHostFrame(
							frameSession,
							runtime,
							presenter,
							input,
							audioOutput,
							systemOutput,
							logOutput,
							presentation,
							hostOverlayMenu,
							profile,
							currentTime,
						);
						if (result === HostFrameRunResult.ExitRequested) {
							frameLoop.stop();
							process.exit(0);
						}
					});
				} else {
					const frameLoop = frames.start((currentTime) => {
						const result = runHostFrame(
							frameSession,
							runtime,
							presenter,
							input,
							audioOutput,
							systemOutput,
							logOutput,
							presentation,
							hostOverlayMenu,
							currentTime,
						);
						if (result === HostFrameRunResult.ExitRequested) {
							frameLoop.stop();
							process.exit(0);
						}
					});
				}
				await new Promise<void>((resolve) => {
					clock.scheduleOnce(options.ttlMs, () => resolve());
				});
			}
		}
	} finally {
		if (profile) {
			console.log('[bootrom:headless] Fantasy CPU profiler report:');
			console.log(formatCpuProfilerReport(profile.snapshot()));
		}
	}
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error('[bootrom:headless] Fatal error:', error);
		process.exit(1);
	},
);
