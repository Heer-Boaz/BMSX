import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import type { Platform } from 'bmsx/platform';
import { prepareMachineHost, startMachineHostFrames } from '../../../hosts/common/machine_runtime';
import {
	HEADLESS_DEFAULT_FRAME_INTERVAL_MS,
	HeadlessPlatformServices,
} from '../../../hosts/node/headless/platform_headless';
import { CLIPlatformServices } from '../../../hosts/node/cli/platform_cli';
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

function createPlatform(frameIntervalMs: number): Platform {
	switch (BMSX_BOOTROM_TARGET) {
		case 'headless':
			return new HeadlessPlatformServices({ frameIntervalMs, unpaced: true });
		case 'cli':
			return new CLIPlatformServices({ frameIntervalMs });
	}
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
	const platform = createPlatform(options.frameIntervalMs);
	const host = await prepareMachineHost({
		systemRom,
		cartridgeSlots: [slot0Rom, slot1Rom],
		startingGamepadIndex: -1,
		enableOnscreenGamepad: false,
		platform,
	});
	startMachineHostFrames(host);
	console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] Game loop running.`);
	const ttlMs = options.ttlMs > 0 ? options.ttlMs : 1000;
	platform.clock.scheduleOnce(ttlMs, () => {
		console.log(`[bootrom:${BMSX_BOOTROM_TARGET}] TTL reached (${ttlMs}ms). Terminating.`);
		process.exit(0);
	});
}

main().catch((error) => {
	console.error(`[bootrom:${BMSX_BOOTROM_TARGET}] Fatal error:`, error);
	process.exitCode = 1;
});
