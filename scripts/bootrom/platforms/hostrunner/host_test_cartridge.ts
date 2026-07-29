import { buildRomAssetSymbolModuleSource } from '../../../../machine/ts/rompack/tooling/asset_symbols';
import type { RomAsset } from '../../../../machine/ts/rompack/tooling/assets';
import { ROM_ASSET_SYMBOL_MODULE_PATH } from '../../../../machine/ts/rompack/tooling/generated_modules';
import { loadRomAssetList, parseCartridgeIndex } from '../../../../machine/ts/rompack/tooling/loader';
import { encodeBinary } from '../../../../machine/ts/common/serializer/binencoder';
import { splitText } from '../../../../machine/ts/common/text_lines';
import { parseLuaChunk } from '../../../../machine/ts/lua/analysis/parse';
import {
	BLUA32_IMAGE_ID,
	decodeBlua32Image,
} from '../../../../machine/ts/rompack/tooling/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
} from '../../../../machine/ts/rompack/tooling/blua32_symbols';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../../machine/ts/machine/model_registry';
import { buildBlua32Tail } from '../../../../machine/ts/rompack/tooling/blua32_tail';
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
	for (let index = 0; index < cartridgeLuaAssets.length; index += 1) {
		const asset = cartridgeLuaAssets[index];
		if (asset.source_path !== cartIndex.entry_path) {
			continue;
		}
		const source = `require('${HOST_TEST_MODULE_PATH}')\n${asset.buffer!.toString('utf8')}`;
		const parsed = parseLuaChunk(source, asset.source_path, splitText(source)).chunk!;
		asset.buffer = Buffer.from(source);
		asset.compiled_buffer = Buffer.from(encodeBinary(parsed));
		break;
	}
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
		entryPath: cartIndex.entry_path,
		loadAddress: CART_ROM_BASE + cartImageEntry.start!,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel: 3,
		domain: 'cart',
		systemImage,
		systemSymbols,
	});
	return buildBlua32Tail({ id: 'cart', index: cartIndex, payload: cartridge }, linked).payload;
}
