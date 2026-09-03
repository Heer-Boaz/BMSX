import {
	decodeBinary,
	utf8FatalDecoder,
} from '../../../machine/ts/common/serializer/binencoder';
import { CART_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { LuaChunk } from '../lua/syntax/ast';
import { composeLuaSource } from '../lua/compiler/source_map';
import { resolveLuaEntryModuleIndex } from '../lua/entry_module';
import { toLuaModulePath } from '../lua/module_path';
import {
	buildRelocatableRomAssetSymbolModule,
} from './asset_symbols';
import type { RomAsset } from './assets';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	decodeBlua32BiosImports,
} from './blua32_bios_imports';
import { BLUA32_IMAGE_ID } from './blua32_image';
import { buildBlua32Image } from './blua32_image_builder';
import {
	buildBlua32Tail,
	layoutBlua32PublicAssets,
	type Blua32PublicAssetChanges,
} from './blua32_tail';
import type { Blua32DiagnosticSourceMap } from './blua32_diagnostics';
import {
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_REGISTER_MODULE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from './generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from './gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from './gx_register_module';
import { loadRomAssetList, parseCartridgeIndex } from './loader';
import { applyBlua32LinkValues, type LinkedCartBlua32Image } from './blua32_linker';
import { SCENARIO_GUEST_API_SOURCE, SCENARIO_TEST_LOADER_GLOBAL } from './scenario_guest_api';
import { scenarioTestAssetId, type ScenarioTestSource } from './scenario_test';
import type { RomSourceLayer } from './source';

export const SCENARIO_ENTRY_MODULE_PATH = 'bmsx/scenario_entry';

export type ScenarioCartridgeBuildOptions = {
	systemRom: Uint8Array;
	cartridge: Uint8Array;
	test: ScenarioTestSource;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
};

export type BuiltScenarioCartridge = {
	layer: RomSourceLayer<'cart'>;
	linked: LinkedCartBlua32Image;
	diagnosticSources: Blua32DiagnosticSourceMap;
};

const utf8Encoder = new TextEncoder();

function collectLuaProgramAssets(payload: Uint8Array, entries: ReadonlyArray<RomAsset>): RomAsset[] {
	const assets: RomAsset[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== 'lua' || entry.compiled_start === undefined) {
			continue;
		}
		assets.push({
			...entry,
			buffer: payload.subarray(entry.start!, entry.end!),
			compiled_buffer: payload.subarray(entry.compiled_start, entry.compiled_end!),
		});
	}
	return assets;
}

export async function buildScenarioCartridge(
	options: ScenarioCartridgeBuildOptions,
): Promise<BuiltScenarioCartridge> {
	const [systemIndex, cartridgeIndex] = await Promise.all([
		loadRomAssetList(options.systemRom, 'system'),
		parseCartridgeIndex(options.cartridge),
	]);
	const systemImportsEntry = systemIndex.entries.find(
		entry => entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID,
	)!;
	const imageEntry = cartridgeIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const biosImports = decodeBlua32BiosImports(
		options.systemRom.subarray(systemImportsEntry.start, systemImportsEntry.end),
	);
	const layer: RomSourceLayer<'cart'> = {
		id: 'cart',
		index: cartridgeIndex,
		bytes: options.cartridge,
	};
	const luaAssets = collectLuaProgramAssets(options.cartridge, cartridgeIndex.entries);
	const entryCandidates = new Array<{ asset: RomAsset; chunk: LuaChunk }>(luaAssets.length);
	for (let index = 0; index < luaAssets.length; index += 1) {
		entryCandidates[index] = {
			asset: luaAssets[index],
			chunk: decodeBinary(luaAssets[index].compiled_buffer!) as LuaChunk,
		};
	}
	const entryCandidate = entryCandidates[resolveLuaEntryModuleIndex(entryCandidates)];
	const entrySource = utf8FatalDecoder.decode(entryCandidate.asset.buffer!);
	const entrySourcePath = entryCandidate.asset.source_path!;
	const firstLineEnd = entrySource.indexOf('\n') + 1;
	const entryComposition = composeLuaSource(SCENARIO_ENTRY_MODULE_PATH, [
		{
			kind: 'source',
			rangePath: entryCandidate.chunk.range.path,
			displayPath: entrySourcePath,
			source: entrySource,
			endOffset: firstLineEnd,
		},
		{
			kind: 'generated',
			source: `${SCENARIO_TEST_LOADER_GLOBAL} = function()`,
		},
		{
			kind: 'generated',
			source: SCENARIO_GUEST_API_SOURCE,
		},
		{
			kind: 'source',
			rangePath: toLuaModulePath(options.test.sourcePath),
			displayPath: options.test.sourcePath,
			source: options.test.source,
		},
		{ kind: 'generated', source: 'end' },
		{
			kind: 'source',
			rangePath: entryCandidate.chunk.range.path,
			displayPath: entrySourcePath,
			source: entrySource,
			startOffset: firstLineEnd,
		},
	]);
	const changes: Blua32PublicAssetChanges = {
		assetEdit: [
			'lua',
			scenarioTestAssetId(options.test.sourcePath),
			utf8Encoder.encode(options.test.source),
		],
	};
	const imageByteCount = imageEntry.end! - imageEntry.start!;
	const compileAssets = layoutBlua32PublicAssets(layer, imageByteCount, changes);
	const assetModule = buildRelocatableRomAssetSymbolModule(
		compileAssets.entries,
		'cart',
		imageEntry.start!,
	);
	const built = buildBlua32Image({
		luaAssets,
		entryComposition,
		generatedLuaModules: [
			{
				path: ROM_ASSET_SYMBOL_MODULE_PATH,
				source: assetModule.source,
				linkValues: assetModule.linkValues,
			},
			{ path: GX_DISPLAY_PRESET_MODULE_PATH, source: GX_DISPLAY_PRESET_MODULE_SOURCE },
			{ path: GX_REGISTER_MODULE_PATH, source: GX_REGISTER_MODULE_SOURCE },
		],
		loadAddress: CART_ROM_BASE + imageEntry.start!,
		ramByteCount: options.ramByteCount,
		optLevel: options.optLevel,
		traceStatements: 'emit',
		domain: 'cart',
		biosImports,
	});
	const finalAssets = layoutBlua32PublicAssets(layer, built.linked.bytes.byteLength, changes);
	const finalAssetModule = buildRelocatableRomAssetSymbolModule(
		finalAssets.entries,
		'cart',
		imageEntry.start!,
	);
	applyBlua32LinkValues(
		built.linked,
		built.object.link.constValueRelocs,
		ROM_ASSET_SYMBOL_MODULE_PATH,
		finalAssetModule.linkValues,
	);
	const diagnosticSources = new Map(built.diagnosticSources);
	diagnosticSources.set(ROM_ASSET_SYMBOL_MODULE_PATH, {
		displayPath: `${ROM_ASSET_SYMBOL_MODULE_PATH}.lua`,
		source: finalAssetModule.source,
	});
	return {
		layer: buildBlua32Tail(layer, built.linked, diagnosticSources, changes),
		linked: built.linked,
		diagnosticSources,
	};
}
