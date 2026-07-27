import * as path from 'node:path';

import {
	positiveNodeOptionNumber,
	requiredNodeOptionValue,
} from './node_option_values';

export type NodeToolingMode =
	| { kind: 'plain' }
	| { kind: 'timeline'; path: string }
	| { kind: 'host-test'; path: string }
	| { kind: 'ide-test'; path: string };

export interface NodeToolingOptions {
	debug: boolean;
	romPath: string;
	slot1Path: string;
	frameIntervalMs: number;
	ttlMs: number;
	systemRomPath: string;
	mode: NodeToolingMode;
	cpuProfile: boolean;
}

export type NodeToolingCommand =
	| { kind: 'help' }
	| { kind: 'run'; options: NodeToolingOptions };

export const NODE_TOOLING_HELP = `Run BMSX validation tooling in a headless Node host.

Usage: node <bundle>.js [options] [romFolder]

Options:
  --rom, --slot0, -r <path>  Cartridge slot 0 ROM.
  --slot1 <path>             Cartridge slot 1 ROM.
  --frame-interval <ms>      Override the host frame interval.
  --debug                    Use debug ROM artifacts.
  --no-debug                 Use release ROM artifacts.
  --ttl <seconds>            Stop after the given duration.
  --system-rom <path>        System ROM path.
  --input-timeline <file>    Schedule a JSON input/capture timeline.
  --test <file>              Run a cartridge host-test module.
  --ide-test <file>          Run a host-side Studio test.
  --cpu-profile              Profile fantasy-CPU instructions.
  --help, -h                 Show this help.`;

export function parseNodeToolingOptions(
	argv: readonly string[],
	artifactDebug: boolean,
	defaultFrameIntervalMs: number,
): NodeToolingCommand {
	let romPath = '';
	let slot1Path = '';
	let romFolder = '';
	let systemRomPath = '';
	let debug = artifactDebug;
	let ttlMs = 0;
	let frameIntervalMs = defaultFrameIntervalMs;
	let mode: NodeToolingMode = { kind: 'plain' };
	let cpuProfile = false;
	let help = false;

	let index = 0;
	while (index < argv.length) {
		const argument = argv[index];
		switch (argument) {
			case '--rom':
			case '--slot0':
			case '-r':
				romPath = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--slot1':
				slot1Path = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--frame-interval':
				frameIntervalMs = positiveNodeOptionNumber(
					requiredNodeOptionValue(argv, index, argument),
					'frame interval',
				);
				index += 2;
				continue;
			case '--debug':
				debug = true;
				index += 1;
				continue;
			case '--no-debug':
				debug = false;
				index += 1;
				continue;
			case '--ttl':
				ttlMs = positiveNodeOptionNumber(
					requiredNodeOptionValue(argv, index, argument),
					'TTL',
				) * 1000;
				index += 2;
				continue;
			case '--system-rom':
				systemRomPath = requiredNodeOptionValue(argv, index, argument);
				index += 2;
				continue;
			case '--input-timeline':
				if (mode.kind !== 'plain') {
					throw new Error('Only one tooling mode may be selected.');
				}
				mode = {
					kind: 'timeline',
					path: path.resolve(requiredNodeOptionValue(argv, index, argument)),
				};
				index += 2;
				continue;
			case '--test':
				if (mode.kind !== 'plain') {
					throw new Error('Only one tooling mode may be selected.');
				}
				mode = {
					kind: 'host-test',
					path: path.resolve(requiredNodeOptionValue(argv, index, argument)),
				};
				index += 2;
				continue;
			case '--ide-test':
				if (mode.kind !== 'plain') {
					throw new Error('Only one tooling mode may be selected.');
				}
				mode = {
					kind: 'ide-test',
					path: path.resolve(requiredNodeOptionValue(argv, index, argument)),
				};
				index += 2;
				continue;
			case '--cpu-profile':
				cpuProfile = true;
				index += 1;
				continue;
			case '--help':
			case '-h':
				help = true;
				index += 1;
				continue;
		}
		if (!argument.startsWith('-') && !romFolder) {
			romFolder = argument;
			index += 1;
			continue;
		}
		throw new Error(`Unrecognized argument: ${argument}`);
	}

	if (help) {
		return { kind: 'help' };
	}
	if (cpuProfile && (mode.kind === 'host-test' || mode.kind === 'ide-test')) {
		throw new Error('--cpu-profile cannot be combined with --test or --ide-test.');
	}

	let resolvedRomPath: string;
	if (romPath) {
		resolvedRomPath = path.resolve(romPath);
	} else if (romFolder) {
		resolvedRomPath = path.resolve(
			'dist',
			`${romFolder}${debug ? '.debug' : ''}.rom`,
		);
	} else {
		throw new Error('ROM path is required. Pass --rom <path> or supply a romFolder.');
	}

	const resolvedSystemRomPath = systemRomPath
		? path.resolve(systemRomPath)
		: path.join(
			path.dirname(resolvedRomPath),
			debug ? 'bmsx-bios.debug.rom' : 'bmsx-bios.rom',
		);
	if (!ttlMs) {
		ttlMs = mode.kind === 'plain' ? 1_000 : 60_000;
	}

	return {
		kind: 'run',
		options: {
			debug,
			romPath: resolvedRomPath,
			slot1Path: slot1Path ? path.resolve(slot1Path) : '',
			frameIntervalMs,
			ttlMs,
			systemRomPath: resolvedSystemRomPath,
			mode,
			cpuProfile,
		},
	};
}
