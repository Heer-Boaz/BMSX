import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { build, type BuildOptions } from 'esbuild';

import { assertPlayerBundleBoundary } from '../analysis/product_bundle_boundary';
import { productNeedsRebuild } from './rebuild';
import {
	javascriptProductFilename,
	type NodePlayerTarget,
} from './targets';

const NODE_PLAYER_ENTRY_PATH = 'scripts/bootrom/platforms/node_entry.ts';
const NODE_LAUNCH_PATH = 'scripts/bootrom/platforms/node_launch.ts';
const NODE_OPTION_VALUES_PATH = 'scripts/bootrom/platforms/node_option_values.ts';
const NODE_TOOLING_ENTRY_PATH = 'scripts/bootrom/platforms/node_tooling_entry.ts';
const NODE_PLAYER_SOURCE_ROOTS = [
	'hosts/node',
	'machine/ts',
	'runtime',
	NODE_PLAYER_ENTRY_PATH,
	NODE_LAUNCH_PATH,
	NODE_OPTION_VALUES_PATH,
	'scripts/products/node_build.ts',
] as const;
const NODE_TOOLING_SOURCE_ROOTS = [
	'hosts/node',
	'ide',
	'machine/ts',
	'runtime',
	'scripts/bootrom',
	'scripts/products/node_build.ts',
	'toolchain/ts',
] as const;

type NodeProductBuildOptions = {
	debug: boolean;
	force: boolean;
};

async function buildNodeBundle(
	entryPath: string,
	outPath: string,
	target: NodePlayerTarget,
	debug: boolean,
): Promise<Readonly<Record<string, unknown>>> {
	await access(entryPath);
	const options: BuildOptions = {
		entryPoints: [entryPath],
		bundle: true,
		metafile: true,
		platform: 'node',
		target: 'node22',
		format: 'cjs',
		minify: !debug,
		keepNames: true,
		define: {
			'BMSX_BOOTROM_TARGET': JSON.stringify(target),
			'BMSX_BOOTROM_DEBUG': debug ? 'true' : 'false',
		},
		sourcemap: debug ? 'inline' : false,
		sourcesContent: debug,
		outfile: outPath,
	};
	const result = await build(options);
	return result.metafile.inputs;
}

export async function buildNodePlayer(
	target: NodePlayerTarget,
	options: NodeProductBuildOptions,
): Promise<void> {
	const product = target === 'headless' ? 'node-headless-player' : 'node-cli-player';
	const outPath = join(process.cwd(), 'dist', javascriptProductFilename(product, options.debug));
	if (!options.force && !await productNeedsRebuild(outPath, NODE_PLAYER_SOURCE_ROOTS)) {
		return;
	}

	await mkdir(join(process.cwd(), 'dist'), { recursive: true });
	const inputs = await buildNodeBundle(
		NODE_PLAYER_ENTRY_PATH,
		outPath,
		target,
		options.debug,
	);
	assertPlayerBundleBoundary(`Node ${target} player`, inputs);
}

export async function buildNodeHeadlessTooling(options: NodeProductBuildOptions): Promise<void> {
	const outPath = join(
		process.cwd(),
		'dist',
		javascriptProductFilename('node-headless-tooling', options.debug),
	);
	if (!options.force && !await productNeedsRebuild(outPath, NODE_TOOLING_SOURCE_ROOTS)) {
		return;
	}

	await mkdir(join(process.cwd(), 'dist'), { recursive: true });
	await buildNodeBundle(
		NODE_TOOLING_ENTRY_PATH,
		outPath,
		'headless',
		options.debug,
	);
}
