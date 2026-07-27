import { statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import pc from 'picocolors';

import { ensureHostSystemAtlasArtifacts } from '../rompacker/host_system_atlas';
import { getRomManifest } from '../rompacker/rombuilder';
import {
	getOptionalParamOrEnv,
	normalizePathKey,
	parseArgsVector,
} from '../tooling/cli_arguments';
import { createCliUi } from '../tooling/cli_ui';
import {
	buildBrowserPlayer,
	buildBrowserPlayerPackage,
} from './browser_build';
import { javascriptProductFilename } from './targets';

const KNOWN_FLAGS = new Set([
	'-romname',
	'-title',
	'-respath',
	'--debug',
	'--force',
	'-h',
	'--help',
]);
const FLAGS_WITH_VALUES = new Set([
	'-romname',
	'-title',
	'-respath',
]);
const ui = createCliUi({ bannerTitle: 'BMSX DEPLOY BUILDER', labelWidth: 14 });

function parseOptions(args: string[]): {
	debug: boolean;
	force: boolean;
	romName: string;
	title: string | undefined;
	resourcePath: string;
} {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		ui.writeOut('Usage: <command> -romname <cart-folder> [options]\n', 'warning');
		ui.writeOut('Options:\n', 'warning');
		ui.writeOut('  -title <title>            Deploy title override\n', 'warning');
		ui.writeOut('  -respath <path>           Resource path override\n', 'warning');
		ui.writeOut('  --debug                   Build debug artifacts\n', 'warning');
		ui.writeOut('  --force                   Force rebuild\n', 'warning');
		process.exit(0);
	}

	const romArgument = getOptionalParamOrEnv(args, '-romname', 'ROM_NAME', KNOWN_FLAGS);
	if (!romArgument) {
		throw new Error('Deploy requires -romname <cart-folder>.');
	}
	const normalizedRomName = romArgument
		.replace(/^[./\\]+/, '')
		.replace(/\\/g, '/');
	const romName = normalizedRomName.startsWith('carts/')
		? normalizedRomName.slice('carts/'.length)
		: normalizedRomName;
	const resourcePath = normalizePathKey(
		getOptionalParamOrEnv(args, '-respath', 'RES_PATH', KNOWN_FLAGS)
		|| `./carts/${romName}/res`,
	);
	if (!statSync(resourcePath).isDirectory()) {
		throw new Error(`Resource path is not a directory: ${resourcePath}`);
	}

	return {
		debug: seenFlags.has('--debug'),
		force: seenFlags.has('--force'),
		romName,
		title: getOptionalParamOrEnv(args, '-title', 'TITLE', KNOWN_FLAGS),
		resourcePath,
	};
}

async function main(): Promise<void> {
	ui.printBanner();
	const options = parseOptions(process.argv.slice(2));
	const manifest = await getRomManifest(options.resourcePath);
	if (!manifest) {
		throw new Error(`ROM manifest not found at "${options.resourcePath}".`);
	}
	const romName = manifest.rom_name || options.romName;
	const title = manifest.title || options.title || 'BMSX';
	const shortName = manifest.short_name || 'BMSX';
	await access(
		join(
			process.cwd(),
			'dist',
			`${romName}${options.debug ? '.debug' : ''}.rom`,
		),
	);

	ui.divider('Browser deployment');
	ui.bullet('ROM', pc.bold(pc.white(romName)));
	ui.bullet('Title', pc.white(title));
	ui.bullet('Debug', options.debug ? pc.green('enabled') : pc.dim('disabled'));

	const atlasUpdated = await ensureHostSystemAtlasArtifacts();
	ui.ok(
		`Host system atlas → ${pc.white('machine/{ts,cpp}/rompack/host_system_atlas.generated')}`
		+ `${atlasUpdated ? '' : pc.dim(' (up-to-date)')}`,
	);
	await buildBrowserPlayer(options);
	ui.ok(
		`Browser player → ${pc.white(`dist/${javascriptProductFilename('browser-player', options.debug)}`)}`,
	);
	await buildBrowserPlayerPackage({
		debug: options.debug,
		romName,
		title,
		shortName,
	});
	ui.ok(`Browser loader → ${pc.white('dist/index.html')}`);
	ui.ok(`Browser manifest → ${pc.white('dist/manifest.webmanifest')}`);
	ui.ok('Browser deployment complete');
	ui.writeOut('\n');
}

main().catch(error => {
	const message = error instanceof Error ? error.message : String(error);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
