import pc from 'picocolors';

import { runPlatformBuild } from './platformbuild';
import type { RomPackerTarget } from './rompacker.rompack';
import type { CanonicalizationType } from '../../src/bmsx/rompack/rompack';

import { createCliUi, getParamOrEnv, parseArgsVector } from './cli_shared';

const KNOWN_FLAGS = new Set<string>([
	'--debug',
	'--force',
	'--platform',
	'--preserve-lua-case',
	'-h',
	'--help',
]);

const FLAGS_WITH_VALUES = new Set<string>([
	'--platform',
]);

const ui = createCliUi({ bannerTitle: 'BMSX PLATFORM BUILDER', labelWidth: 14 });

type ParsedPlatformOptions = {
	platform: RomPackerTarget;
	debug: boolean;
	force: boolean;
	canonicalization: CanonicalizationType;
};

function parseOptions(args: string[]): ParsedPlatformOptions {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		ui.writeOut('Usage: <command> [options]\n', 'warning');
		ui.writeOut('Options:\n', 'warning');
		ui.writeOut('  --platform <target>       Target platform: browser (default), cli, headless, libretro-wsl, libretro-win\n', 'warning');
		ui.writeOut('  --debug                   Build debug artifacts\n', 'warning');
		ui.writeOut('  --force                   Force rebuild\n', 'warning');
		ui.writeOut('  --preserve-lua-case       Disable Lua case folding for bootrom canonicalization\n', 'warning');
		process.exit(0);
	}

	const debug = seenFlags.has('--debug');
	const force = seenFlags.has('--force');
	const platformRaw = getParamOrEnv(args, '--platform', 'ROM_PLATFORM', 'browser', KNOWN_FLAGS);
	const platform = platformRaw.toLowerCase() as RomPackerTarget;

	const preserveLuaCase = seenFlags.has('--preserve-lua-case');
	const canonicalizationEnv = process.env.ROM_LUA_CANONICALIZATION;
	let canonicalization: CanonicalizationType = 'lower';
	if (canonicalizationEnv && canonicalizationEnv.length > 0) {
		if (canonicalizationEnv === 'none' || canonicalizationEnv === 'lower' || canonicalizationEnv === 'upper') {
			canonicalization = canonicalizationEnv;
		} else {
			throw new Error(`Unsupported value "${canonicalizationEnv}" for ROM_LUA_CANONICALIZATION. Expected one of: 'none', 'lower', 'upper'.`);
		}
	} else if (preserveLuaCase) {
		canonicalization = 'none';
	}

	return {
		platform,
		debug,
		force,
		canonicalization,
	};
}

async function main(): Promise<void> {
	ui.printBanner();
	const options = parseOptions(process.argv.slice(2));
	const logger = {
		divider: ui.divider,
		bullet: ui.bullet,
		info: ui.info,
		ok: ui.ok,
	};
	await runPlatformBuild(options, logger);
	ui.writeOut('\n');
}

main().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
