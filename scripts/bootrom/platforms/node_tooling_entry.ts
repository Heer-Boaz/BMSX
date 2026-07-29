import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
	prepareWorkbenchRuntime,
	startWorkbenchHostFrames,
} from '../../../ide/workbench/machine_runtime';
import { RESOURCE_PANEL_DEFAULT_RATIO } from '../../../ide/common/constants';
import { createHeadlessIdeHarness } from '../../../ide/testing/headless_harness';
import {
	HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	HeadlessPlatformServices,
} from '../../../hosts/node/headless/platform_headless';
import {
	prepareMachineHost,
	startMachineHostFrames,
	type MachineHost,
	type MachineHostInitializationOptions,
} from '../../../hosts/common/machine_runtime';
import { CpuProfilerSession, formatCpuProfilerReport } from '../cpu_profiler';
import {
	loadBlua32ToolingImage,
	type Blua32ToolingImage,
} from '../../../toolchain/ts/rompack/blua32_media';
import { loadRomToolingMedia } from '../../../toolchain/ts/rompack/media';
import {
	CART_ROM_BASE,
	SYSTEM_ROM_BASE,
} from '../../../machine/ts/spec/bmsx/memory_map';
import { startCpuProfileHostFrames } from './cpu_profile_frame';
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

	const platform = new HeadlessPlatformServices({
		frameIntervalMs: options.frameIntervalMs,
		unpaced: true,
	});
	const bootOptions: MachineHostInitializationOptions = {
		cartridgeSlots: [slot0Rom, slot1Rom],
		systemRom,
		startingGamepadIndex: -1,
		enableOnscreenGamepad: false,
		platform,
	};
	const inputLogger = (message: string): void => {
		console.log(`[bootrom:headless:input] ${message}`);
	};

	console.log(
		`[bootrom:headless] Starting game (debug=${options.debug}, frameIntervalMs=${options.frameIntervalMs}).`,
	);
	console.log(`[bootrom:headless] TTL set to ${options.ttlMs}ms.`);

	let profile: {
		host: MachineHost;
		session: CpuProfilerSession;
	} | null = null;
	if (options.cpuProfile) {
		const media = await loadRomToolingMedia(systemRom, [slot0Rom, slot1Rom]);
		const host = await prepareMachineHost(bootOptions);
		const systemLayer = media.system;
		const cartridgeImages: [Blua32ToolingImage | null, Blua32ToolingImage | null] = [null, null];
		for (let slot = 0; slot < media.cartridgeSlots.length; slot += 1) {
			const cartridgeLayer = media.cartridgeSlots[slot];
			if (!cartridgeLayer) {
				continue;
			}
			cartridgeImages[slot] = loadBlua32ToolingImage(
				cartridgeLayer,
				CART_ROM_BASE,
			);
		}
		const session = new CpuProfilerSession({
			system: loadBlua32ToolingImage(
				systemLayer,
				SYSTEM_ROM_BASE,
			),
			cartridgeSlots: cartridgeImages,
		});
		profile = { host, session };
		console.log('[bootrom:headless] Fantasy CPU profiler enabled.');
	}

	try {
		switch (options.mode.kind) {
			case 'ide-test': {
				installNodeWorkspaceBridge(path.resolve(path.dirname(options.romPath), '..'));
				const [ideHost, ide] = await prepareWorkbenchRuntime(
					bootOptions,
					RESOURCE_PANEL_DEFAULT_RATIO,
				);
				const runtime = ideHost.runtime;
				startWorkbenchHostFrames(ideHost, ide);
				await Promise.race([
					runIdeTest({
						testPath: options.mode.path,
						frameIntervalMs: options.frameIntervalMs,
						ide: createHeadlessIdeHarness(
							ide,
							runtime,
							ideHost.input,
							ideHost.audioOutput,
							ideHost.platform.microtasks,
							ideHost.platform.storage,
							ideHost.platform,
						),
						logger: inputLogger,
						clock: platform.clock,
					}),
					new Promise<never>((_resolve, reject) => {
						platform.clock.scheduleOnce(options.ttlMs, () => {
							reject(new Error('IDE test did not finish before TTL.'));
						});
					}),
				]);
				return;
			}
			case 'host-test': {
				const capture = new HeadlessCaptureCoordinator(
					platform.videoOutput,
					deriveHeadlessCaptureOutputDir(options.mode.path),
					() => platform.clock.now(),
				);
				console.log(
					`[bootrom:headless:input] [capture] screenshots -> ${capture.outputDir}`,
				);
				let passed = false;
				try {
					const host = await prepareMachineHost(bootOptions);
					const runtime = host.runtime;
					startMachineHostFrames(host);
					await new HostTestRunner({
						testPath: options.mode.path,
						frameIntervalMs: options.frameIntervalMs,
						ttlMs: options.ttlMs,
						logger: inputLogger,
						runtime,
						input: platform.input,
						clock: platform.clock,
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
					platform.videoOutput,
					deriveHeadlessCaptureOutputDir(options.mode.path),
					() => platform.clock.now(),
				);
				console.log(
					`[bootrom:headless:input] [capture] screenshots -> ${capture.outputDir}`,
				);
				let completed = false;
				try {
					const host = profile
						? profile.host
						: await prepareMachineHost(bootOptions);
					const timeline = await InputTimeline.load(
						options.mode.path,
						options.frameIntervalMs,
						platform.videoOutput,
						platform.input,
						host.runtime,
						capture,
						inputLogger,
					);
					if (profile) {
						startCpuProfileHostFrames(host, profile.session);
					} else {
						startMachineHostFrames(host);
					}
					await Promise.race([
						timeline.completion,
						new Promise<never>((_resolve, reject) => {
							platform.clock.scheduleOnce(options.ttlMs, () => {
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
				if (profile) {
					startCpuProfileHostFrames(profile.host, profile.session);
				} else {
					const host = await prepareMachineHost(bootOptions);
					startMachineHostFrames(host);
				}
				await new Promise<void>((resolve) => {
					platform.clock.scheduleOnce(options.ttlMs, () => resolve());
				});
			}
		}
	} finally {
		if (profile) {
			console.log('[bootrom:headless] Fantasy CPU profiler report:');
			console.log(formatCpuProfilerReport(profile.session.snapshot()));
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
