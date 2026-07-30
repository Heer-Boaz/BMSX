import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { HeadlessVideoOutput } from '../../../hosts/node/headless/video_output';
import { Input } from '../../../hosts/common/input/manager';
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
import { runGate } from '../../../machine/ts/common/taskgate';
import type { HostClock } from '../../../hosts/common/clock';
import type { FrameLoop } from '../../../hosts/common/frame_loop';
import { ConsoleLogOutput } from '../../../hosts/common/log';
import { DiscardingAudioSink } from '../../../hosts/node/common/discarding_audio';
import {
	RealtimeHeadlessClock,
	VirtualHeadlessClock,
} from '../../../hosts/node/headless/clock';
import {
	HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	RealtimeHeadlessFrameLoop,
	UnpacedHeadlessFrameLoop,
} from '../../../hosts/node/headless/frame_loop';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import {
	parseNodeLaunchOptions,
	printNodeLaunchOptionsHelp,
	resolveNodeDebugMode,
	resolveNodeRomPath,
	resolveNodeSystemRomPath,
} from './node_launch';

declare const BMSX_BOOTROM_TARGET: 'cli' | 'headless';
declare const BMSX_BOOTROM_DEBUG: boolean;

function printHelp(): void {
	console.log('Run a packaged BMSX ROM in a Node host.');
	console.log('');
	console.log('Usage: node <bundle>.js [options] [romFolder]');
	console.log('');
	console.log('Options:');
	printNodeLaunchOptionsHelp();
	console.log('  --help, -h                 Show this help.');
}

async function main(): Promise<void> {
	const options = parseNodeLaunchOptions(
		process.argv.slice(2),
		HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	);
	if (options.help) {
		printHelp();
		process.exit(0);
	}
	const debug = resolveNodeDebugMode(options.debugMode, BMSX_BOOTROM_DEBUG);
	const romPath = resolveNodeRomPath(options, debug);
	const systemRomPath = resolveNodeSystemRomPath(options, romPath, debug);

	console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] Loading ROM: ${romPath}`);
	console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] Loading system ROM: ${systemRomPath}`);
	const [systemRom, slot0Rom, slot1Rom] = await Promise.all([
		fs.readFile(systemRomPath),
		fs.readFile(romPath),
		options.slot1Path ? fs.readFile(path.resolve(options.slot1Path)) : Promise.resolve(null),
	]);
	let clock: HostClock;
	let frames: FrameLoop;
	switch (BMSX_BOOTROM_TARGET) {
		case 'headless': {
			const virtualClock = new VirtualHeadlessClock();
			clock = virtualClock;
			frames = new UnpacedHeadlessFrameLoop(
				virtualClock,
				options.frameIntervalMs,
			);
			break;
		}
		case 'cli':
			clock = new RealtimeHeadlessClock();
			frames = new RealtimeHeadlessFrameLoop(
				clock,
				options.frameIntervalMs,
			);
			break;
	}
	const input = new Input(
		clock,
		new HeadlessInputHub(),
		-1,
	);
	const videoOutput = new HeadlessVideoOutput(256, 212);
	const runtime = initializeMachineRuntime(
		systemRom,
		[slot0Rom, slot1Rom],
		PSX_MACHINE_SPEC,
		input,
	);
	const presenter = initializeMachineVideoPresenter(
		runtime,
		videoOutput,
		new HeadlessGPUBackend(
			256,
			212,
			PSX_MACHINE_SPEC.gxGpuVramBytes,
		),
	);
	const audioOutput = new HostAudioOutput(
		new DiscardingAudioSink(),
		runtime.machine.audioController,
		runtime.machine.audioOutput.outputRing,
		runtime.timing.ufpsScaled,
	);
	const logOutput = new ConsoleLogOutput();
	const systemOutput = new SystemOutputLog();
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now());
	runtime.resetForSystemBoot();
	runtime.boot();
	systemOutput.flush(runtime, logOutput);
	audioOutput.bootstrap();
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(presenter, runtime, input);
	runtime.frameScheduler.clearQueuedTime();
	const frameLoop = frames.start((currentTime) => {
		const result = runHostFrame(
			session,
			runtime,
			presenter,
			input,
			audioOutput,
			systemOutput,
			logOutput,
			presentation,
			hostOverlayMenu,
			currentTime,
			runGate.ready,
		);
		if (result === HostFrameRunResult.ExitRequested) {
			frameLoop.stop();
			process.exit(0);
		}
	});
	console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] Game loop running.`);
	const ttlMs = options.ttlMs > 0 ? options.ttlMs : 1000;
	clock.scheduleOnce(ttlMs, () => {
		console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] TTL reached (${ttlMs}ms). Terminating.`);
		process.exit(0);
	});
}

main().catch((error) => {
	console.error(`[bootrom:${BMSX_BOOTROM_TARGET}] Fatal error:`, error);
	process.exitCode = 1;
});
