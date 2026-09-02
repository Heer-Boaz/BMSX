import { buildRomAssetSymbolModuleSource } from '../../../../toolchain/ts/rompack/asset_symbols';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import {
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_REGISTER_MODULE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from '../../../../toolchain/ts/rompack/generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../../../toolchain/ts/rompack/gx_register_module';
import { loadRomAssetList, parseCartridgeIndex } from '../../../../toolchain/ts/rompack/loader';
import {
	decodeBinary,
	encodeBinary,
	utf8FatalDecoder,
} from '../../../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../../../../toolchain/ts/lua/analysis/parse';
import { resolveLuaEntryModuleIndex } from '../../../../toolchain/ts/lua/entry_module';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { composeLuaSource } from '../../../../toolchain/ts/lua/compiler/source_map';
import type { LuaChunk } from '../../../../toolchain/ts/lua/syntax/ast';
import {
	BLUA32_IMAGE_ID,
} from '../../../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	decodeBlua32BiosImports,
} from '../../../../toolchain/ts/rompack/blua32_bios_imports';
import { CART_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../../machine/ts/spec/bmsx/model';
import { buildBlua32Tail } from '../../../../toolchain/ts/rompack/blua32_tail';
import { buildBlua32Image } from '../../../rompacker/blua32_image_builder';

export const HOST_TEST_LOADER_MODULE_PATH = 'bmsx/host_test_loader';
export const HOST_TEST_API_PATH = 'scripts/bootrom/platforms/hostrunner/host_test_api.lua';
export const HOST_TEST_LOADER_GLOBAL = '__bmsx_host_test_loader';
const HOST_TEST_SOURCE_ASSET_PREFIX = '__bmsx_test_source__/';

export type GuestTestSource = {
	sourcePath: string;
	source: string;
	updateTimestamp: number;
};

function collectLuaProgramAssets(payload: Uint8Array, entries: ReadonlyArray<RomAsset>): RomAsset[] {
	const assets: RomAsset[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== 'lua' || entry.compiled_start === undefined) {
			continue;
		}
		assets.push({
			...entry,
			buffer: Buffer.from(payload.buffer, payload.byteOffset + entry.start!, entry.end! - entry.start!),
			compiled_buffer: Buffer.from(payload.buffer, payload.byteOffset + entry.compiled_start!, entry.compiled_end! - entry.compiled_start!),
		});
	}
	return assets;
}

export async function buildHostTestCartridge(
	systemRom: Uint8Array,
	cartridge: Uint8Array,
	test: GuestTestSource,
	hostTestApiSource: string,
): Promise<Uint8Array> {
	const systemIndex = await loadRomAssetList(systemRom, 'system');
	const cartIndex = await parseCartridgeIndex(cartridge);
	const systemImportsEntry = systemIndex.entries.find(entry => entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID)!;
	const cartImageEntry = cartIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const biosImports = decodeBlua32BiosImports(
		systemRom.subarray(systemImportsEntry.start, systemImportsEntry.end),
	);
	const cartridgeLuaAssets = collectLuaProgramAssets(cartridge, cartIndex.entries);
	const entryCandidates = new Array<{ asset: RomAsset; chunk: LuaChunk }>(cartridgeLuaAssets.length);
	for (let index = 0; index < cartridgeLuaAssets.length; index += 1) {
		entryCandidates[index] = {
			asset: cartridgeLuaAssets[index],
			chunk: decodeBinary(cartridgeLuaAssets[index].compiled_buffer!) as LuaChunk,
		};
	}
	const entryCandidate = entryCandidates[resolveLuaEntryModuleIndex(entryCandidates)];
	const entryAsset = entryCandidate.asset;
	const entrySource = utf8FatalDecoder.decode(entryAsset.buffer!);
	const firstLineEnd = entrySource.indexOf('\n') + 1;
	const source = `${entrySource.slice(0, firstLineEnd)}require('${HOST_TEST_LOADER_MODULE_PATH}')\n${entrySource.slice(firstLineEnd)}`;
	const parsed = parseLuaChunk(source, entryCandidate.chunk.range.path).chunk!;
	entryAsset.buffer = Buffer.from(source);
	entryAsset.compiled_buffer = Buffer.from(encodeBinary(parsed));
	const testModulePath = toLuaModulePath(test.sourcePath);
	const loader = composeLuaSource(HOST_TEST_LOADER_MODULE_PATH, [
		{
			kind: 'generated',
			source: `${HOST_TEST_LOADER_GLOBAL} = function()`,
		},
		{
			kind: 'generated',
			source: hostTestApiSource,
		},
		{
			kind: 'source',
			rangePath: testModulePath,
			displayPath: test.sourcePath,
			source: test.source,
		},
		{
			kind: 'generated',
			source: 'end',
		},
	]);
	const testAsset: RomAsset = {
		resid: `${HOST_TEST_SOURCE_ASSET_PREFIX}${test.sourcePath}`,
		type: 'lua',
		buffer: Buffer.from(test.source),
		source_path: test.sourcePath,
		normalized_source_path: test.sourcePath,
		update_timestamp: test.updateTimestamp,
	};
	const built = buildBlua32Image({
		luaAssets: cartridgeLuaAssets,
		generatedLuaModules: [
			{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: buildRomAssetSymbolModuleSource(cartIndex.entries) },
			{ path: GX_DISPLAY_PRESET_MODULE_PATH, source: GX_DISPLAY_PRESET_MODULE_SOURCE },
			{ path: GX_REGISTER_MODULE_PATH, source: GX_REGISTER_MODULE_SOURCE },
			{
				path: HOST_TEST_LOADER_MODULE_PATH,
				source: loader.source,
				sourceMap: loader.sourceMap,
			},
		],
		loadAddress: CART_ROM_BASE + cartImageEntry.start!,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel: 3,
		domain: 'cart',
		biosImports,
	});
	return buildBlua32Tail(
		{ id: 'cart', index: cartIndex, bytes: cartridge },
		built.linked,
		built.diagnosticSources,
		{ assetAdditions: [testAsset] },
	).bytes;
}
