import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { decodeBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
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
	readonly testSource: string;
};

function luaEntry(source: string): RomAsset {
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(source),
		compiled_buffer: compileLuaChunkBuffer(source, 'entry'),
		source_path: 'entry.lua',
		normalized_source_path: 'carts/example/entry.lua',
	};
}

/** Writes a production-format BIOS/cart pair with one retained scenario source. */
export async function buildScenarioMediaFixture(
	outputDirectory: string,
	testSource: string,
): Promise<ScenarioMediaFixture> {
	const systemAssets = [luaEntry('module<entry>\nreturn true')];
	const systemLayout = layoutRomPrefix(
		systemAssets,
		true,
		MANIFEST,
		SYSTEM_ROM_ASSET_OFFSET,
	);
	const systemBlua32 = buildRomBlua32Tail(systemAssets, {
		generatedLuaModules: [],
		includeSymbols: true,
		optLevel: 0,
		ramByteCount: 0x00400000,
		domain: 'system',
		systemAssetEndOffset: systemLayout.nextOffset,
		biosExports: [],
	});
	await finalizeRompack('system', {
		debug: true,
		layout: systemLayout,
		outputDirectory,
		blua32: systemBlua32,
	});

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
	const packagedTest: RomAsset = {
		resid: scenarioTestAssetId(SCENARIO_FIXTURE_TEST_SOURCE_PATH),
		type: 'lua',
		buffer: Buffer.from(testSource),
		source_path: SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		normalized_source_path: SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		update_timestamp: 1234,
	};
	const cartAssets = [
		luaEntry(SCENARIO_FIXTURE_CART_ENTRY_SOURCE),
		sourceOnlyModule,
		unselectedSourceOnlyModule,
		packagedTest,
	];
	const cartLayout = layoutRomPrefix(cartAssets, true, MANIFEST);
	const cartBlua32 = buildRomBlua32Tail(cartAssets, {
		generatedLuaModules: [],
		includeSymbols: true,
		optLevel: 0,
		ramByteCount: 0x00400000,
		domain: 'cart',
		imageOffset: cartLayout.nextOffset,
		biosImports: decodeBlua32BiosImports(systemBlua32.biosImportsPayload),
	});
	await finalizeRompack('cart', {
		projectRootPath: 'carts/example',
		debug: true,
		layout: cartLayout,
		outputDirectory,
		blua32: cartBlua32,
	});

	return {
		systemRom: new Uint8Array(await readFile(join(outputDirectory, 'system.debug.rom'))),
		cartRom: new Uint8Array(await readFile(join(outputDirectory, 'cart.debug.rom'))),
		testSource,
	};
}
