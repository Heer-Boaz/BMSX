import { buildRomAssetSymbolModuleSource } from '../../../../toolchain/ts/rompack/asset_symbols';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { ROM_ASSET_SYMBOL_MODULE_PATH } from '../../../../toolchain/ts/rompack/generated_modules';
import { loadRomAssetList, parseCartridgeIndex } from '../../../../toolchain/ts/rompack/loader';
import { decodeBinary, encodeBinary } from '../../../../machine/ts/common/serializer/binencoder';
import { splitText } from '../../../../machine/ts/common/text_lines';
import { parseLuaChunk } from '../../../../toolchain/ts/lua/analysis/parse';
import { resolveLuaEntryModuleIndex } from '../../../../toolchain/ts/lua/entry_module';
import type { LuaChunk } from '../../../../toolchain/ts/lua/syntax/ast';
import {
	BLUA32_IMAGE_ID,
	decodeBlua32Image,
} from '../../../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
} from '../../../../toolchain/ts/rompack/blua32_symbols';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../../machine/ts/spec/bmsx/model';
import { buildBlua32Tail } from '../../../../toolchain/ts/rompack/blua32_tail';
import { buildBlua32Image } from '../../../rompacker/blua32_image_builder';

export const HOST_TEST_MODULE_PATH = 'bmsx/headless_test';
export const HOST_TEST_API_PATH = 'scripts/bootrom/platforms/hostrunner/host_test_api.lua';
export const HOST_TEST_LOADER_GLOBAL = '__bmsx_host_test_loader';

function collectLuaAssets(payload: Uint8Array, entries: ReadonlyArray<RomAsset>): RomAsset[] {
	const assets: RomAsset[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== 'lua') {
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
	testSource: string,
): Promise<Uint8Array> {
	const systemIndex = await loadRomAssetList(systemRom, 'system');
	const cartIndex = await parseCartridgeIndex(cartridge);
	const systemImageEntry = systemIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const systemSymbolsEntry = systemIndex.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
	const cartImageEntry = cartIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const systemImage = decodeBlua32Image(
		systemRom.subarray(systemImageEntry.start, systemImageEntry.end),
		SYSTEM_ROM_BASE + systemImageEntry.start!,
	);
	const systemSymbols = decodeBlua32SymbolsImage(
		systemRom.subarray(systemSymbolsEntry.start, systemSymbolsEntry.end),
	);
	const cartridgeLuaAssets = collectLuaAssets(cartridge, cartIndex.entries);
	const entryCandidates = new Array<{ asset: RomAsset; chunk: LuaChunk }>(cartridgeLuaAssets.length);
	for (let index = 0; index < cartridgeLuaAssets.length; index += 1) {
		entryCandidates[index] = {
			asset: cartridgeLuaAssets[index],
			chunk: decodeBinary(cartridgeLuaAssets[index].compiled_buffer!) as LuaChunk,
		};
	}
	const entryAsset = entryCandidates[resolveLuaEntryModuleIndex(entryCandidates)].asset;
	const entrySource = entryAsset.buffer!.toString('utf8');
	const firstLineEnd = entrySource.indexOf('\n') + 1;
	const source = `${entrySource.slice(0, firstLineEnd)}require('${HOST_TEST_MODULE_PATH}')\n${entrySource.slice(firstLineEnd)}`;
	const parsed = parseLuaChunk(source, entryAsset.source_path, splitText(source)).chunk!;
	entryAsset.buffer = Buffer.from(source);
	entryAsset.compiled_buffer = Buffer.from(encodeBinary(parsed));
	const linked = buildBlua32Image({
		luaAssets: cartridgeLuaAssets,
		externalLuaAssets: collectLuaAssets(systemRom, systemIndex.entries),
		generatedLuaModules: [
			{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: buildRomAssetSymbolModuleSource(cartIndex.entries) },
			{
				path: HOST_TEST_MODULE_PATH,
				source: `${HOST_TEST_LOADER_GLOBAL} = function()\n${testSource}\nend`,
			},
		],
		loadAddress: CART_ROM_BASE + cartImageEntry.start!,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel: 3,
		domain: 'cart',
		systemImage,
		systemSymbols,
	});
	return buildBlua32Tail({ id: 'cart', index: cartIndex, bytes: cartridge }, linked).bytes;
}
