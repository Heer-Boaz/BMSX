import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { BIOS_FUNCTION_EXPORTS, SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { readBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	buildRomBlua32Tail,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';

const MANIFEST: CartManifest = { hardware: [{ type: 'rom' }] };

export const SCENARIO_FIXTURE_TEST_SOURCE_PATH = 'tests/carts/example/example_assert.lua';
export const SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE = 'return "source only"';
export const SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE = 'return "unselected source only"';
export const SCENARIO_FIXTURE_CART_ENTRY_SOURCE = [
	'module<entry>',
	'local trace_subject<const> = {}',
	"blua32.trace(trace_subject, 'fixture', true)",
	'return true',
].join('\n');

export type ScenarioMediaFixture = {
	readonly systemRom: Uint8Array;
	readonly cartRom: Uint8Array;
};

export type ScenarioMediaTestSource = {
	readonly path: string;
	readonly source: string;
};

function luaEntry(source: string): RomAsset {
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(source),
		program_module: true,
		source_path: 'entry.lua',
		normalized_source_path: 'carts/example/entry.lua',
	};
}

/** Writes a production-format BIOS/cart pair with retained scenario sources. */
export async function buildScenarioMediaFixture(
	outputDirectory: string,
	testSources: readonly ScenarioMediaTestSource[],
	options?: {
		systemOptLevel?: 0 | 1 | 2 | 3;
		cartOptLevel?: 0 | 1 | 2 | 3;
		systemSource: string;
		systemModules: readonly { path: string; source: string }[];
		cartSource: string;
		cartModules?: readonly { path: string; source: string }[];
		systemAssets?: readonly RomAsset[];
		cartAssets?: readonly RomAsset[];
	},
): Promise<ScenarioMediaFixture> {
	const systemAssets = [luaEntry(options === undefined ? 'module<entry>\nreturn true' : options.systemSource)];
	// These isolated firmware doubles still provide the public fixed-slot ABI.
	const systemModules = new Map(BIOS_FUNCTION_EXPORTS.map(exported => [exported.path, {
		path: exported.path,
		source: 'module<const>\nreturn function(value) return value end',
	}]));
	for (const module of options?.systemModules ?? []) systemModules.set(module.path, module);
	for (const module of systemModules.values()) {
		systemAssets.push({ resid: module.path, type: 'lua', buffer: Buffer.from(module.source), program_module: true, source_path: `${module.path}.lua`, normalized_source_path: `${module.path}.lua` });
	}
	if (options?.systemAssets !== undefined) systemAssets.push(...options.systemAssets);
	const systemLayout = layoutRomPrefix(
		systemAssets,
		true,
		MANIFEST,
		SYSTEM_ROM_ASSET_OFFSET,
	);
	const systemBlua32 = buildRomBlua32Tail(systemAssets, {
		generatedLuaModules: [],
		includeDiagnostics: true,
		includeSymbols: true,
		optLevel: options?.systemOptLevel ?? 0,
		ramByteCount: 0x00400000,
		domain: 'system',
		systemAssetEndOffset: systemLayout.nextOffset,
		biosExports: BIOS_FUNCTION_EXPORTS,
	});
	await finalizeRompack('system', {
		debug: true,
		layout: systemLayout,
		outputDirectory,
		blua32: systemBlua32,
	});
	const systemRom = new Uint8Array(await readFile(join(outputDirectory, 'system.debug.rom')));

	const sourceOnlyModule: RomAsset = {
		resid: 'source-only-module',
		type: 'lua',
		buffer: Buffer.from(SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE),
		source_path: 'testlib/fixture.lua',
		normalized_source_path: 'testlib/fixture.lua',
	};
	const unselectedSourceOnlyModule: RomAsset = {
		resid: 'unselected-source-only-module',
		type: 'lua',
		buffer: Buffer.from(SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE),
		source_path: 'testlib/unselected.lua',
		normalized_source_path: 'testlib/unselected.lua',
	};
	const frameworkAssets: RomAsset[] = [];
	for (const name of ['context', 'execution']) {
		frameworkAssets.push({ resid: `testlib/${name}`, type: 'lua', buffer: await readFile(`testlib/${name}.lua`), source_path: `testlib/${name}.lua`, normalized_source_path: `testlib/${name}.lua` });
	}
	const cartAssets = [
		...frameworkAssets,
		luaEntry(options === undefined ? SCENARIO_FIXTURE_CART_ENTRY_SOURCE : options.cartSource),
		sourceOnlyModule,
		unselectedSourceOnlyModule,
	];
	for (let index = 0; index < testSources.length; index += 1) {
		const testSource = testSources[index];
		cartAssets.push({
			resid: scenarioTestAssetId(testSource.path),
			type: 'lua',
			buffer: Buffer.from(testSource.source),
			source_path: testSource.path,
			normalized_source_path: testSource.path,
			update_timestamp: 1234 + index,
		});
	}
	if (options?.cartModules !== undefined) for (const module of options.cartModules) {
		cartAssets.push({ resid: module.path, type: 'lua', buffer: Buffer.from(module.source), program_module: true, source_path: `${module.path}.lua`, normalized_source_path: `${module.path}.lua` });
	}

	if (options?.cartAssets !== undefined) cartAssets.push(...options.cartAssets);
	const cartLayout = layoutRomPrefix(cartAssets, true, MANIFEST);
	const cartBlua32 = buildRomBlua32Tail(cartAssets, {
		generatedLuaModules: [],
		includeDiagnostics: true,
		includeSymbols: true,
		optLevel: options?.cartOptLevel ?? 0,
		ramByteCount: 0x00400000,
		domain: 'cart',
		imageOffset: cartLayout.nextOffset,
		biosImports: readBlua32BiosImports(systemRom),
	});
	await finalizeRompack('cart', {
		projectRootPath: 'carts/example',
		debug: true,
		layout: cartLayout,
		outputDirectory,
		blua32: cartBlua32,
	});

	return {
		systemRom,
		cartRom: new Uint8Array(await readFile(join(outputDirectory, 'cart.debug.rom'))),
	};
}
