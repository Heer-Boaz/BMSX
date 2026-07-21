import { buildRomAssetSymbolModuleSource } from '../../../../machine/ts/rompack/asset_symbols';
import { ROM_ASSET_SYMBOL_MODULE_PATH, type RomAsset } from '../../../../machine/ts/rompack/format';
import { loadRomAssetList, parseCartridgeIndex } from '../../../../machine/ts/rompack/loader';
import {
	decodeProgramImage,
	decodeProgramSymbolsImage,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
} from '../../../../machine/ts/machine/program/loader';
import { CART_ROM_BASE } from '../../../../machine/ts/machine/memory/map';
import { buildProgramTail } from '../../../../machine/ts/rompack/tooling/program_tail';
import { buildProgramImage } from '../../../rompacker/program_image_builder';

export const HOST_TEST_MODULE_PATH = 'bmsx/headless_test';
export const HOST_TEST_API_PATH = 'scripts/bootrom/platforms/hostrunner/host_test_api.lua';

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

export async function buildHostTestProgram(
	systemRom: Uint8Array,
	cartridge: Uint8Array,
	testSource: string,
): Promise<Uint8Array> {
	const systemIndex = await loadRomAssetList(systemRom);
	const cartIndex = await parseCartridgeIndex(cartridge);
	const systemProgramEntry = systemIndex.entries.find(entry => entry.resid === PROGRAM_IMAGE_ID)!;
	const systemSymbolsEntry = systemIndex.entries.find(entry => entry.resid === PROGRAM_SYMBOLS_IMAGE_ID)!;
	const cartProgramEntry = cartIndex.entries.find(entry => entry.resid === PROGRAM_IMAGE_ID)!;
	const systemProgram = {
		image: decodeProgramImage(
			systemRom.subarray(systemProgramEntry.start, systemProgramEntry.end),
			systemRom.subarray(systemProgramEntry.compiled_start, systemProgramEntry.compiled_end),
		),
		metadata: decodeProgramSymbolsImage(systemRom.subarray(systemSymbolsEntry.start, systemSymbolsEntry.end)),
	};
	const linked = buildProgramImage({
		luaAssets: collectLuaAssets(cartridge, cartIndex.entries),
		externalLuaAssets: collectLuaAssets(systemRom, systemIndex.entries),
		generatedLuaModules: [
			{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: buildRomAssetSymbolModuleSource(cartIndex.entries) },
			{ path: HOST_TEST_MODULE_PATH, source: testSource },
		],
		entryPath: cartIndex.entry_path,
		loadAddress: CART_ROM_BASE + cartProgramEntry.start!,
		optLevel: 3,
		programDomain: 'cart',
		systemProgram,
	});
	return buildProgramTail({ id: 'cart', index: cartIndex, payload: cartridge }, linked.image, linked.metadata!).payload;
}
