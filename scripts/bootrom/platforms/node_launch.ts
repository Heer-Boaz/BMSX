import * as path from 'node:path';

import {
	positiveNodeOptionNumber,
	requiredNodeOptionValue,
} from './node_option_values';

export const enum NodeDebugMode {
	Artifact,
	Debug,
	Release,
}

export interface NodeLaunchOptions {
	romPath: string;
	slot1Path: string;
	romFolder: string;
	frameIntervalMs: number;
	debugMode: NodeDebugMode;
	ttlMs: number;
	systemRomPath: string;
	help: boolean;
}

export function parseNodeLaunchOptions(
	argv: readonly string[],
	defaultFrameIntervalMs: number,
): NodeLaunchOptions {
	const options: NodeLaunchOptions = {
		romPath: '',
		slot1Path: '',
		romFolder: '',
		frameIntervalMs: defaultFrameIntervalMs,
		debugMode: NodeDebugMode.Artifact,
		ttlMs: 0,
		systemRomPath: '',
		help: false,
	};
	let index = 0;
	while (index < argv.length) {
		const argument = argv[index];
		switch (argument) {
			case '--rom':
			case '--slot0':
			case '-r':
				options.romPath = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--slot1':
				options.slot1Path = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--frame-interval':
				options.frameIntervalMs = positiveNodeOptionNumber(
					requiredNodeOptionValue(argv, index, argument),
					'frame interval',
				);
				index += 2;
				continue;
			case '--debug':
				options.debugMode = NodeDebugMode.Debug;
				index += 1;
				continue;
			case '--no-debug':
				options.debugMode = NodeDebugMode.Release;
				index += 1;
				continue;
			case '--ttl':
				options.ttlMs = positiveNodeOptionNumber(
					requiredNodeOptionValue(argv, index, argument),
					'TTL',
				) * 1000;
				index += 2;
				continue;
			case '--system-rom':
				options.systemRomPath = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--help':
			case '-h':
				options.help = true;
				index += 1;
				continue;
		}
		if (!argument.startsWith('-') && !options.romFolder) {
			options.romFolder = argument;
			index += 1;
			continue;
		}
		throw new Error(`Unrecognized argument: ${argument}`);
	}
	return options;
}

export function printNodeLaunchOptionsHelp(): void {
	console.log('  --rom, --slot0, -r <path>  Cartridge slot 0 ROM.');
	console.log('  --slot1 <path>             Cartridge slot 1 ROM.');
	console.log('  --frame-interval <ms>      Override the host frame interval.');
	console.log('  --debug                    Require debug ROM artifacts.');
	console.log('  --no-debug                 Require release ROM artifacts.');
	console.log('  --ttl <seconds>            Stop after the given duration.');
	console.log('  --system-rom <path>        System ROM path.');
}

export function resolveNodeDebugMode(
	mode: NodeDebugMode,
	artifactDebug: boolean,
): boolean {
	return mode === NodeDebugMode.Artifact
		? artifactDebug
		: mode === NodeDebugMode.Debug;
}

export function resolveNodeRomPath(
	options: NodeLaunchOptions,
	debug: boolean,
): string {
	if (options.romPath) {
		return path.resolve(options.romPath);
	}
	if (options.romFolder) {
		const suffix = debug ? '.debug' : '';
		return path.resolve('dist', `${options.romFolder}${suffix}.rom`);
	}
	throw new Error('ROM path is required. Pass --rom <path> or supply a romFolder.');
}

export function resolveNodeSystemRomPath(
	options: NodeLaunchOptions,
	romPath: string,
	debug: boolean,
): string {
	if (options.systemRomPath) {
		return path.resolve(options.systemRomPath);
	}
	return path.join(
		path.dirname(romPath),
		debug ? 'bmsx-bios.debug.rom' : 'bmsx-bios.rom',
	);
}
