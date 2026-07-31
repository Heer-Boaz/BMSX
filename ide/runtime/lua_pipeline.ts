import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast/index';
import { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import type { ProgramObjectImage } from '../../toolchain/ts/lua/compiler/program_object';
import { resolveLuaEntryModuleIndex } from '../../toolchain/ts/lua/entry_module';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { LuaSourceRegistry } from './source_registry';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { resetHandledLuaErrors } from './fault_state';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import type { Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	createBlua32SourceImage,
	createBlua32SystemSourceImage,
	installRuntimeRomLayers,
	resolveRuntimeLuaSource,
	type Blua32SourceImage,
	type RuntimeSourceState,
} from './sources';
import {
	applyBlua32LinkValues,
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedCartBlua32Image,
	type LinkedBlua32Image,
	type LinkedSystemBlua32Image,
} from '../../toolchain/ts/rompack/blua32_linker';
import {
	buildBlua32Tail,
	layoutBlua32PublicAssets,
	type RomAssetEdit,
} from '../../toolchain/ts/rompack/blua32_tail';
import type { RomSourceLayer } from '../../toolchain/ts/rompack/source';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
	type ResourceIdentity,
} from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import type { RuntimeLuaTooling } from './lua_tooling';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import {
	buildRomAssetLinkValuesFromSymbols,
	buildRomAssetSymbolModuleSourceFromSymbols,
	collectRomAssetSymbols,
	type RomAssetSymbol,
} from '../../toolchain/ts/rompack/asset_symbols';
import {
	ROM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';

export type RebuiltBlua32Image<
	TLinkedImage extends LinkedBlua32Image = LinkedBlua32Image,
> = {
	linked: TLinkedImage;
	previousImage: Blua32ImageLayout;
	previousSymbols: Blua32SymbolsImage;
	sources: ReadonlyMap<string, string>;
};

type ProgramSourceModule = {
	path: string;
	sourcePath: string;
	chunk: LuaChunk;
	source: string;
	linkValues?: ReadonlyMap<string, number>;
};

export type RebuiltBlua32Media = {
	system: RebuiltBlua32Image<LinkedSystemBlua32Image> | null;
	cartridgeSlots: [
		RebuiltBlua32Image<LinkedCartBlua32Image> | null,
		RebuiltBlua32Image<LinkedCartBlua32Image> | null,
	];
};

export type RuntimeRomAssetRevision = readonly [
	domain: ResourceDomain,
	edit: RomAssetEdit,
];

function createFreshLuaInterpreter(
	bridge: RuntimeLuaTooling,
): LuaInterpreter {
	return new LuaInterpreter(bridge.luaJsBridge);
}

function buildProgramSources(
	registries: LuaSourceRegistry[],
	interpreter: LuaInterpreter,
	generatedSourceRevision?: readonly [
		modulePath: string,
		source: string,
		linkValues: ReadonlyMap<string, number>,
	],
): {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
} {
	const modules: ProgramSourceModule[] = [];
	const seen = new Set<string>();
	for (const registry of registries) {
		for (const asset of registry.records) {
			const key = asset.module_path;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const generated = generatedSourceRevision && key === generatedSourceRevision[0]
				? generatedSourceRevision
				: undefined;
			const source = generated
				? generated[1]
				: readWorkspaceLuaSourceText(registry, asset);
			const chunk = interpreter.compileChunk(source, key);
			const module: ProgramSourceModule = {
				path: key,
				sourcePath: asset.source_path,
				chunk,
				source,
			};
			if (generated) {
				module.linkValues = generated[2];
			}
			modules.push(module);
		}
	}
	const entryIndex = resolveLuaEntryModuleIndex(modules);
	const entry = modules[entryIndex];
	for (let index = entryIndex; index + 1 < modules.length; index += 1) {
		modules[index] = modules[index + 1];
	}
	modules.length -= 1;
	return { entry, modules };
}

function prepareRegistryProgramSources(
	registry: LuaSourceRegistry,
	interpreter: LuaInterpreter,
	assetModulePath: string,
	assetModule: readonly [
		source: string,
		linkValues: ReadonlyMap<string, number>,
	],
): {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
	sources: Map<string, string>;
} {
	const programSources = buildProgramSources(
		[registry],
		interpreter,
		[assetModulePath, assetModule[0], assetModule[1]],
	);
	const entryPath = programSources.entry.path;
	const entrySource = programSources.entry.source;
	const modules = programSources.modules;
	registry.entrySourcePath = programSources.entry.sourcePath;
	const compiledSources = new Map<string, string>();
	compiledSources.set(entryPath, entrySource);
	for (let index = 0; index < modules.length; index += 1) {
		compiledSources.set(modules[index].path, modules[index].source);
	}
	return {
		entry: programSources.entry,
		modules,
		sources: compiledSources,
	};
}

function buildAssetModule(
	entries: ReadonlyArray<RomAsset>,
	domain: RomSourceLayer['id'],
	imageOffset: number,
	assetEdit?: RomAssetEdit,
): readonly [source: string, linkValues: ReadonlyMap<string, number>] {
	const symbols = collectRomAssetSymbols(entries, domain);
	const linkSymbols: RomAssetSymbol[] = [];
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		if (symbol.offset >= imageOffset
			|| (assetEdit
				&& symbol.assetType === assetEdit[0]
				&& symbol.assetId === assetEdit[1])) {
			linkSymbols.push(symbol);
		}
	}
	return [
		buildRomAssetSymbolModuleSourceFromSymbols(symbols),
		buildRomAssetLinkValuesFromSymbols(linkSymbols),
	];
}

function applyLinkedAssetModule(
	object: ProgramObjectImage,
	modules: ProgramSourceModule[],
	sources: Map<string, string>,
	linked: LinkedBlua32Image,
	modulePath: string,
	assetModule: readonly [
		source: string,
		linkValues: ReadonlyMap<string, number>,
	],
): void {
	applyBlua32LinkValues(
		linked,
		object.link.constValueRelocs,
		modulePath,
		assetModule[1],
	);
	sources.set(modulePath, assetModule[0]);
	let moduleIndex = 0;
	while (modules[moduleIndex].path !== modulePath) {
		moduleIndex += 1;
	}
	modules[moduleIndex].source = assetModule[0];
	modules[moduleIndex].linkValues = assetModule[1];
}

function commitInstalledBlua32Sources(
	registry: LuaSourceRegistry,
	installedSources: ReadonlyMap<string, string>,
): void {
	let changed = false;
	for (let index = 0; index < registry.records.length; index += 1) {
		const record = registry.records[index];
		if (!record.generated) {
			continue;
		}
		const source = installedSources.get(record.module_path)!;
		if (record.src === source) {
			continue;
		}
		record.src = source;
		record.base_src = source;
		changed = true;
	}
	if (changed) {
		registry.revision += 1;
	}
}

export function buildBlua32Media(
	sources: RuntimeSourceState,
	interpreter: LuaInterpreter,
	ramByteCount: number,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
	assetRevision?: RuntimeRomAssetRevision,
): RebuiltBlua32Media {
	const systemRegistry = sources.systemLuaSources;
	const cartridgeImageOffsets: [number, number] = [0, 0];
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		const imageOffset = cartridge ? cartridge.rom.header.blua32ImageOffset : 0;
		if (imageOffset && (rebuildSystem || rebuildCartridgeSlots[slot])) {
			cartridgeImageOffsets[slot] = imageOffset;
		}
	}
	const installedSystem = sources.currentBlua32Media.system!;
	let biosImports = installedSystem.biosImports;
	let rebuiltSystem: RebuiltBlua32Image<LinkedSystemBlua32Image> | null = null;
	if (rebuildSystem) {
		const imageOffset = sources.systemRom.header.blua32ImageOffset;
		const imageAddress = SYSTEM_ROM_BASE + imageOffset;
		const assetEdit = assetRevision && assetRevision[0] === SYSTEM_RESOURCE_DOMAIN
			? assetRevision[1]
			: undefined;
		const programSources = prepareRegistryProgramSources(
			systemRegistry,
			interpreter,
			SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				sources.systemRom.index.entries,
				sources.systemRom.id,
				imageOffset,
				assetEdit,
			),
		);
		const compiledSystem = compileLuaChunkToProgram(
			programSources.entry.chunk,
			programSources.modules,
			{
				optLevel: sources.realtimeCompileOptLevel,
				entrySource: programSources.entry.source,
				programDomain: 'system',
			},
		);
		const systemObject = encodeCompiledProgramObject(compiledSystem);
		const linked = linkSystemBlua32Image(
			systemObject,
			compiledSystem.metadata,
			imageAddress,
			ramByteCount,
			BIOS_FUNCTION_EXPORTS,
			{ image: installedSystem.layout, symbols: installedSystem.symbols! },
		);
		const publicAssets = layoutBlua32PublicAssets(
			sources.systemRom,
			linked.bytes.byteLength,
			assetEdit,
		);
		applyLinkedAssetModule(
			systemObject,
			programSources.modules,
			programSources.sources,
			linked,
			SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				publicAssets.entries,
				sources.systemRom.id,
				imageOffset,
			),
		);
		biosImports = linked.biosImports;
		rebuiltSystem = {
			linked,
			previousImage: installedSystem.layout,
			previousSymbols: installedSystem.symbols!,
			sources: programSources.sources,
		};
	}

	const rebuiltCartridgeSlots: [
		RebuiltBlua32Image<LinkedCartBlua32Image> | null,
		RebuiltBlua32Image<LinkedCartBlua32Image> | null,
	] = [null, null];
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const imageOffset = cartridgeImageOffsets[slot];
		if (!imageOffset) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		const assetEdit = assetRevision && assetRevision[0] === slot
			? assetRevision[1]
			: undefined;
		const programSources = prepareRegistryProgramSources(
			cartridge.luaSources,
			interpreter,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				cartridge.rom.index.entries,
				cartridge.rom.id,
				imageOffset,
				assetEdit,
			),
		);
		const compiled = compileLuaChunkToProgram(
			programSources.entry.chunk,
			programSources.modules,
			{
				optLevel: sources.realtimeCompileOptLevel,
				entrySource: programSources.entry.source,
				biosFunctions: biosImports.functions,
				programDomain: 'cart',
			},
		);
		const cartObject = encodeCompiledProgramObject(compiled);
		const imageAddress = CART_ROM_BASE + imageOffset;
		const installed = sources.currentBlua32Media.cartridgeSlots[slot]!;
		const linked = linkCartBlua32Image(
			biosImports,
			cartObject,
			compiled.metadata,
			imageAddress,
			ramByteCount,
			{ image: installed.layout, symbols: installed.symbols! },
		);
		const publicAssets = layoutBlua32PublicAssets(
			cartridge.rom,
			linked.bytes.byteLength,
			assetEdit,
		);
		applyLinkedAssetModule(
			cartObject,
			programSources.modules,
			programSources.sources,
			linked,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				publicAssets.entries,
				cartridge.rom.id,
				imageOffset,
			),
		);
		rebuiltCartridgeSlots[slot] = {
			linked,
			previousImage: installed.layout,
			previousSymbols: installed.symbols!,
			sources: programSources.sources,
		};
	}
	return {
		system: rebuiltSystem,
		cartridgeSlots: rebuiltCartridgeSlots,
	};
}

export function installBlua32Media(
	sources: RuntimeSourceState,
	runtime: Runtime,
	rebuilt: RebuiltBlua32Media,
	assetRevision?: RuntimeRomAssetRevision,
): void {
	let systemLayer: RomSourceLayer<'system'> | null = null;
	const cartridgeLayers: [RomSourceLayer<'cart'> | null, RomSourceLayer<'cart'> | null] = [null, null];
	if (rebuilt.system !== null) {
		systemLayer = buildBlua32Tail(
			sources.systemRom,
			rebuilt.system.linked,
			assetRevision && assetRevision[0] === SYSTEM_RESOURCE_DOMAIN
				? assetRevision[1]
				: undefined,
		);
	}
	for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
		const image = rebuilt.cartridgeSlots[slot];
		if (image !== null) {
			cartridgeLayers[slot] = buildBlua32Tail(
				sources.cartridgeSlots[slot]!.rom,
				image.linked,
				assetRevision && assetRevision[0] === slot
					? assetRevision[1]
					: undefined,
			);
		}
	}
	installRuntimeRomLayers(sources, systemLayer, cartridgeLayers);
	const currentMedia = sources.currentBlua32Media;
	let systemImage = currentMedia.system;
	const cartridgeImages: [Blua32SourceImage | null, Blua32SourceImage | null] = [
		currentMedia.cartridgeSlots[0],
		currentMedia.cartridgeSlots[1],
	];
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.bytes);
		commitInstalledBlua32Sources(sources.systemLuaSources, rebuilt.system!.sources);
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		sources.systemBlua32MediaDirty = false;
		systemImage = createBlua32SystemSourceImage(
			rebuilt.system!.linked.layout,
			rebuilt.system!.linked.symbols,
			rebuilt.system!.linked.biosImports,
		);
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		runtime.machine.cartridgeController.installRom(slot, layer.bytes);
		commitInstalledBlua32Sources(
			sources.cartridgeSlots[slot]!.luaSources,
			rebuilt.cartridgeSlots[slot]!.sources,
		);
		sources.cartridgeSlots[slot]!.installedBlua32Sources = rebuilt.cartridgeSlots[slot]!.sources;
		sources.cartridgeBlua32MediaDirty[slot] = false;
		cartridgeImages[slot] = createBlua32SourceImage(
			rebuilt.cartridgeSlots[slot]!.linked.layout,
			rebuilt.cartridgeSlots[slot]!.linked.symbols,
		);
	}
	sources.currentBlua32Media = {
		system: systemImage,
		cartridgeSlots: cartridgeImages,
	};
}

export function bootActiveBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	rebuildBlua32Media: boolean,
): void {
	const interpreter = createFreshLuaInterpreter(luaTooling);
	if (rebuildBlua32Media) {
		installBlua32Media(sources, runtime, buildBlua32Media(
			sources,
			interpreter,
			runtime.machine.memory.ramByteCount(),
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
		));
	}
	resetHandledLuaErrors(fault);
	luaTooling.luaInterpreter = interpreter;
	runtime.resetForSystemBoot();
	runtime.boot();
}

export function resourceSourceForChunk(sources: RuntimeSourceState, identity: ResourceIdentity): string {
	const luaSource = resolveRuntimeLuaSource(sources, identity);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${identity.path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
