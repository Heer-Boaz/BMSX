import pc from 'picocolors';

import { ensureHostSystemAtlasArtifacts } from '../rompacker/host_system_atlas';
import { getParamOrEnv, parseArgsVector } from '../tooling/cli_arguments';
import { createCliUi } from '../tooling/cli_ui';
import {
	buildBrowserPlayer,
	buildBrowserPlayerPackage,
	buildBrowserStudio,
	buildBrowserStudioPackage,
	buildMachineRuntime,
} from './browser_build';
import { buildLibretroProduct } from './libretro_build';
import { buildNodeHeadlessTooling, buildNodePlayer } from './node_build';
import {
	javascriptProductFilename,
	type ProductBuildTarget,
} from './targets';

const KNOWN_FLAGS = new Set([
	'--debug',
	'--force',
	'--target',
	'-h',
	'--help',
]);
const FLAGS_WITH_VALUES = new Set([
	'--target',
]);
const ui = createCliUi({ bannerTitle: 'BMSX PRODUCT BUILDER', labelWidth: 14 });

function productBuildTarget(value: string): ProductBuildTarget {
	const normalized = value.toLowerCase();
	switch (normalized) {
		case 'libretro-wsl':
		case 'libretro-win':
		case 'machine-runtime':
		case 'browser-player':
		case 'browser-studio':
		case 'node-cli-player':
		case 'node-headless-player':
		case 'node-headless-tooling':
			return normalized;
		default:
			throw new Error(`Unknown product build target "${value}".`);
	}
}

function parseOptions(args: string[]): {
	target: ProductBuildTarget;
	debug: boolean;
	force: boolean;
} {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		ui.writeOut('Usage: <command> --target <product> [options]\n', 'warning');
		ui.writeOut('Products:\n', 'warning');
		ui.writeOut('  machine-runtime, browser-player, browser-studio\n', 'warning');
		ui.writeOut('  node-cli-player, node-headless-player, node-headless-tooling\n', 'warning');
		ui.writeOut('  libretro-wsl, libretro-win\n', 'warning');
		ui.writeOut('Options:\n', 'warning');
		ui.writeOut('  --debug                   Build debug artifacts\n', 'warning');
		ui.writeOut('  --force                   Force rebuild\n', 'warning');
		process.exit(0);
	}

	return {
		target: productBuildTarget(
			getParamOrEnv(args, '--target', 'BMSX_PRODUCT_TARGET', 'browser-player', KNOWN_FLAGS),
		),
		debug: seenFlags.has('--debug'),
		force: seenFlags.has('--force'),
	};
}

async function main(): Promise<void> {
	ui.printBanner();
	const { target, debug, force } = parseOptions(process.argv.slice(2));
	ui.divider('Product');
	ui.bullet('Target', pc.cyan(target));
	ui.bullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	const atlasUpdated = await ensureHostSystemAtlasArtifacts();
	ui.ok(
		`Host system atlas → ${pc.white('machine/{ts,cpp}/rompack/host_system_atlas.generated')}`
		+ `${atlasUpdated ? '' : pc.dim(' (up-to-date)')}`,
	);

	switch (target) {
		case 'machine-runtime': {
			await buildMachineRuntime({ debug, force });
			ui.ok(
				`Machine runtime → ${pc.white(`dist/${javascriptProductFilename('machine-runtime', debug)}`)}`,
			);
			break;
		}
		case 'browser-player': {
			await buildBrowserPlayer({ debug, force });
			await buildBrowserPlayerPackage({
				debug,
				romName: '',
				title: 'BMSX',
				shortName: 'BMSX',
			});
			ui.ok(
				`Browser player → ${pc.white(`dist/${javascriptProductFilename('browser-player', debug)}`)}`,
			);
			ui.ok(`Browser player loader → ${pc.white('dist/index.html')}`);
			ui.ok(`Browser manifest → ${pc.white('dist/manifest.webmanifest')}`);
			break;
		}
		case 'browser-studio': {
			await buildBrowserStudio({ debug, force });
			await buildBrowserStudioPackage(debug);
			ui.ok(
				`Browser Studio → ${pc.white(`dist/${javascriptProductFilename('browser-studio', debug)}`)}`,
			);
			ui.ok(`Browser Studio loader → ${pc.white('dist/studio.html')}`);
			ui.ok(`Browser manifest → ${pc.white('dist/manifest.webmanifest')}`);
			break;
		}
		case 'node-cli-player': {
			await buildNodePlayer('cli', { debug, force });
			ui.ok(
				`Node CLI player → ${pc.white(`dist/${javascriptProductFilename('node-cli-player', debug)}`)}`,
			);
			break;
		}
		case 'node-headless-player': {
			await buildNodePlayer('headless', { debug, force });
			ui.ok(
				`Node headless player → ${pc.white(`dist/${javascriptProductFilename('node-headless-player', debug)}`)}`,
			);
			break;
		}
		case 'node-headless-tooling': {
			await buildNodeHeadlessTooling({ debug, force });
			ui.ok(
				`Node headless tooling → ${pc.white(`dist/${javascriptProductFilename('node-headless-tooling', debug)}`)}`,
			);
			break;
		}
		case 'libretro-wsl':
		case 'libretro-win': {
			const filename = await buildLibretroProduct(target, debug);
			ui.ok(`Libretro core → ${pc.white(`dist/${filename}`)}`);
			break;
		}
	}
	ui.ok(`Product build complete → ${pc.cyan(target)}`);
	ui.writeOut('\n');
}

main().catch(error => {
	const message = error instanceof Error ? error.message : String(error);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
