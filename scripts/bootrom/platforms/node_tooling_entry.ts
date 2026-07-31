import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
	prepareWorkbenchRuntime,
} from '../../../ide/workbench/machine_runtime';
import { runWorkbenchHostFrame } from '../../../ide/workbench/host_frame';
import { RESOURCE_PANEL_DEFAULT_RATIO } from '../../../ide/common/constants';
import { IdeMicrotaskQueue } from '../../../ide/common/microtask_queue';
import { createHeadlessIdeHarness } from '../../../ide/testing/headless_harness';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { HeadlessVideoOutput } from '../../../hosts/node/headless/video_output';
import { Input } from '../../../hosts/common/input/manager';
import { ConsoleLogOutput } from '../../../hosts/common/log';
import { DiscardingAudioSink } from '../../../hosts/node/common/discarding_audio';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import {
	HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	UnpacedHeadlessFrameLoop,
} from '../../../hosts/node/headless/frame_loop';
import { HeadlessClipboard } from '../../../ide/testing/clipboard';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { MemoryStorage } from '../../../ide/testing/memory_storage';
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
import {
	buildHostTestCartridge,
	HOST_TEST_API_PATH,
} from './hostrunner/host_test_cartridge';
import { HostTestRunner } from './hostrunner/host_test_runner';
import { runIdeTest } from './hostrunner/ide_test_runner';
import { InputTimeline } from './input_timeline';
import {
	NODE_TOOLING_HELP,
	parseNodeToolingOptions,
} from './node_tooling_options';
import { installNodeWorkspaceBridge } from './node_workspace_bridge';

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

	let slot0Rom: Uint8Array = originalSlot0Rom;
	if (options.mode.kind === 'host-test') {
		const [apiSource, testSource] = await Promise.all([
			fs.readFile(path.resolve(HOST_TEST_API_PATH), 'utf8'),
			fs.readFile(options.mode.path, 'utf8'),
		]);
		slot0Rom = await buildHostTestCartridge(
			systemRom,
			slot0Rom,
			`${apiSource}\n${testSource}`,
		);
	}

	const clock = new VirtualHeadlessClock();
	const frames = new UnpacedHeadlessFrameLoop(clock, options.frameIntervalMs);
	const inputHub = new HeadlessInputHub();
	const input = new Input(
		clock,
		inputHub,
		-1,
	);
	const videoOutput = new HeadlessVideoOutput(256, 212);
	const videoBackend = new HeadlessGPUBackend(
		256,
		212,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	const logOutput = new ConsoleLogOutput();
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
	const frameSession = new HostFrameSession(
		runtime.timing.ufpsScaled,
		clock.now(),
	);
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(presenter, runtime, input);
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
	if (options.mode.kind !== 'ide-test') {
		runtime.resetForSystemBoot();
		runtime.boot();
		systemOutput.flush(runtime, logOutput);
		audioOutput.bootstrap();
	}

	try {
		switch (options.mode.kind) {
			case 'ide-test': {
				installNodeWorkspaceBridge(path.resolve(path.dirname(options.romPath), '..'));
				const microtasks = new IdeMicrotaskQueue();
				const storage = new MemoryStorage();
				const ide = await prepareWorkbenchRuntime(
					systemRom,
					[slot0Rom, slot1Rom],
					runtime,
					presenter,
					videoOutput,
					input,
					audioOutput,
					storage,
					clock,
					new HeadlessClipboard(),
					microtasks,
					logOutput,
					RESOURCE_PANEL_DEFAULT_RATIO,
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
								logOutput,
							),
							logger: inputLogger,
							clock,
						}),
						new Promise<never>((_resolve, reject) => {
							clock.scheduleOnce(options.ttlMs, () => {
								reject(new Error('IDE test did not finish before TTL.'));
							});
						}),
					]);
				} finally {
					process.removeListener('SIGINT', interrupt);
					process.removeListener('SIGTERM', terminate);
					await shutdownWorkspaceStorage();
				}
				return;
			}
			case 'host-test': {
				const capture = new HeadlessCaptureCoordinator(
					videoBackend,
					deriveHeadlessCaptureOutputDir(options.mode.path),
					() => clock.now(),
				);
				console.log(
					`[bootrom:headless:input] [capture] screenshots -> ${capture.outputDir}`,
				);
				let passed = false;
				try {
					runtime.frameScheduler.clearQueuedTime();
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
					await new HostTestRunner({
						testPath: options.mode.path,
						frameIntervalMs: options.frameIntervalMs,
						ttlMs: options.ttlMs,
						logger: inputLogger,
						runtime,
						input: inputHub,
						clock,
						capture,
					}).run();
					passed = true;
				} finally {
					await capture.flushWrites(passed);
					capture.dispose();
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
