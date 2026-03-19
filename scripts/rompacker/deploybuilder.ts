import pc from 'picocolors';

import { runBrowserDeploy } from './platformbuild';
import type { CanonicalizationType } from '../../src/bmsx/rompack/rompack';
import { createCliUi, findExistingDirectory, getParamOrEnv, normalizePathKey, parseArgsVector } from './cli_shared';

const KNOWN_FLAGS = new Set<string>([
	'-romname',
	'-title',
	'-respath',
	'--debug',
	'--force',
	'--preserve-lua-case',
	'-h',
	'--help',
]);

const FLAGS_WITH_VALUES = new Set<string>([
	'-romname',
	'-title',
	'-respath',
]);

const ui = createCliUi({ bannerTitle: 'BMSX DEPLOY BUILDER', labelWidth: 14 });

type ParsedDeployOptions = {
	platform: 'browser';
	debug: boolean;
	force: boolean;
	rom_name: string;
	title: string;
	respath: string;
	canonicalization: CanonicalizationType;
};

function parseOptions(args: string[]): ParsedDeployOptions {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		ui.writeOut('Usage: <command> [options]\n', 'warning');
		ui.writeOut('Options:\n', 'warning');
		ui.writeOut('  -romname <name>           Cart folder name (required)\n', 'warning');
		ui.writeOut('  -title <title>            Deploy title override\n', 'warning');
		ui.writeOut('  -respath <path>           Resource path override\n', 'warning');
		ui.writeOut('  --debug                   Build debug artifacts\n', 'warning');
		ui.writeOut('  --force                   Force rebuild\n', 'warning');
		ui.writeOut('  --preserve-lua-case       Disable Lua case folding for bootrom canonicalization\n', 'warning');
		process.exit(0);
	}

	const debug = seenFlags.has('--debug');
	const force = seenFlags.has('--force');
	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', '', KNOWN_FLAGS);
	const title = getParamOrEnv(args, '-title', 'TITLE', '', KNOWN_FLAGS);
	const respathRaw = getParamOrEnv(args, '-respath', 'RES_PATH', '', KNOWN_FLAGS);

	if (!rom_name || rom_name.length === 0) {
		throw new Error('Deploy requires -romname <cart-folder>.');
	}

	const normalizedRomName = rom_name.replace(/^[./\\]+/, '').replace(/\\/g, '/');
	const cartFolder = normalizedRomName.startsWith('carts/') ? normalizedRomName.slice('carts/'.length) : normalizedRomName;
	const romSegments = cartFolder.split('/').filter(Boolean);
	const romLeaf = romSegments.length > 0 ? romSegments[romSegments.length - 1] : cartFolder;
	const resCandidates: Array<string> = [
		respathRaw,
		cartFolder ? `./src/carts/${cartFolder}/res` : undefined,
		romLeaf ? `./src/carts/${romLeaf}/res` : undefined,
	];
	const resolvedResPath = findExistingDirectory(resCandidates);
	if (!resolvedResPath) {
		const attempted = resCandidates.filter(Boolean).map(normalizePathKey).join(', ');
		throw new Error(`Resource path "${respathRaw}" does not exist. Tried: ${attempted || '<none>'}.`);
	}

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
		platform: 'browser',
		debug,
		force,
		rom_name: cartFolder,
		title,
		respath: normalizePathKey(resolvedResPath),
		canonicalization,
	};
}

async function main(): Promise<void> {
	ui.printBanner();
	const options = parseOptions(process.argv.slice(2));
	await runBrowserDeploy(options, {
		divider: ui.divider,
		bullet: ui.bullet,
		info: ui.info,
		ok: ui.ok,
	});
	ui.writeOut('\n');
}

main().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
