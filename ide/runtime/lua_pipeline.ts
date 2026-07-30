import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast/index';
import { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type ProgramCompileDomain } from '../../toolchain/ts/lua/compiler';
import type { ProgramMetadata } from '../../toolchain/ts/lua/compiler/program';
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
	installRuntimeRomLayers,
	resolveRuntimeLuaSource,
	type RuntimeSourceState,
} from './sources';
import {
	applyBlua32LinkValues,
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
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
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
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

export type RebuiltBlua32Image = {
	linked: LinkedBlua32Image;
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
	system: RebuiltBlua32Image | null;
	cartridgeSlots: [RebuiltBlua32Image | null, RebuiltBlua32Image | null];
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

function compileRegistryProgramObject(
	sources: RuntimeSourceState,
	registry: LuaSourceRegistry,
	interpreter: LuaInterpreter,
	programDomain: ProgramCompileDomain,
	externalModules: ReadonlyArray<ProgramSourceModule>,
	assetModule?: readonly [
		source: string,
		linkValues: ReadonlyMap<string, number>,
	],
): {
	object: ProgramObjectImage;
	metadata: ProgramMetadata;
	modules: ProgramSourceModule[];
	sources: Map<string, string>;
} {
	const programSources = buildProgramSources(
		[registry],
		interpreter,
		assetModule
			? [
				programDomain === 'system'
					? SYSTEM_ASSET_SYMBOL_MODULE_PATH
					: ROM_ASSET_SYMBOL_MODULE_PATH,
				assetModule[0],
				assetModule[1],
			]
			: undefined,
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
	const compiled = compileLuaChunkToProgram(programSources.entry.chunk, modules, {
		optLevel: sources.realtimeCompileOptLevel,
		entrySource,
		externalModules,
		programDomain,
	});
	return {
		object: encodeCompiledProgramObject(compiled),
		metadata: compiled.metadata,
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
	compiled: {
		object: ProgramObjectImage;
		modules: ProgramSourceModule[];
		sources: Map<string, string>;
	},
	linked: LinkedBlua32Image,
	modulePath: string,
	assetModule: readonly [
		source: string,
		linkValues: ReadonlyMap<string, number>,
	],
): void {
	applyBlua32LinkValues(
		linked,
		compiled.object.link.constValueRelocs,
		modulePath,
		assetModule[1],
	);
	compiled.sources.set(modulePath, assetModule[0]);
	let moduleIndex = 0;
	while (compiled.modules[moduleIndex].path !== modulePath) {
		moduleIndex += 1;
	}
	compiled.modules[moduleIndex].source = assetModule[0];
	compiled.modules[moduleIndex].linkValues = assetModule[1];
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
	let rebuildAnyCartridge = false;
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		const imageOffset = cartridge ? cartridge.rom.header.blua32ImageOffset : 0;
		if (imageOffset && (rebuildSystem || rebuildCartridgeSlots[slot])) {
			cartridgeImageOffsets[slot] = imageOffset;
			rebuildAnyCartridge = true;
		}
	}
	const installedSystem = sources.currentBlua32Media.system!;
	let systemImage = installedSystem.layout;
	let systemSymbols = installedSystem.symbols;
	let rebuiltSystem: RebuiltBlua32Image | null = null;
	let systemModules: ReadonlyArray<ProgramSourceModule> = [];
	if (rebuildSystem) {
		const imageOffset = sources.systemRom.header.blua32ImageOffset;
		const imageAddress = SYSTEM_ROM_BASE + imageOffset;
		const assetEdit = assetRevision && assetRevision[0] === SYSTEM_RESOURCE_DOMAIN
			? assetRevision[1]
			: undefined;
		const compiledSystem = compileRegistryProgramObject(
			sources,
			systemRegistry,
			interpreter,
			'system',
			[],
			buildAssetModule(
				sources.systemRom.index.entries,
				sources.systemRom.id,
				imageOffset,
				assetEdit,
			),
		);
		const linked = linkSystemBlua32Image(
			compiledSystem.object,
			compiledSystem.metadata,
			imageAddress,
			ramByteCount,
			{ image: installedSystem.layout, symbols: installedSystem.symbols! },
		);
		const [entries] = layoutBlua32PublicAssets(
			sources.systemRom,
			linked.bytes.byteLength,
			assetEdit,
		);
		applyLinkedAssetModule(
			compiledSystem,
			linked,
			SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				entries,
				sources.systemRom.id,
				imageOffset,
			),
		);
		systemImage = linked.layout;
		systemSymbols = linked.symbols;
		rebuiltSystem = {
			linked,
			previousImage: installedSystem.layout,
			previousSymbols: installedSystem.symbols!,
			sources: compiledSystem.sources,
		};
		systemModules = compiledSystem.modules;
	} else if (rebuildAnyCartridge) {
		systemModules = buildProgramSources([systemRegistry], interpreter).modules;
	}

	const rebuiltCartridgeSlots: [RebuiltBlua32Image | null, RebuiltBlua32Image | null] = [null, null];
	if (rebuildAnyCartridge && systemSymbols === null) {
		throw new Error('Cartridge BLua32 linking requires system symbols.');
	}
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const imageOffset = cartridgeImageOffsets[slot];
		if (!imageOffset) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		const assetEdit = assetRevision && assetRevision[0] === slot
			? assetRevision[1]
			: undefined;
		const compiled = compileRegistryProgramObject(
			sources,
			cartridge.luaSources,
			interpreter,
			'cart',
			systemModules,
			buildAssetModule(
				cartridge.rom.index.entries,
				cartridge.rom.id,
				imageOffset,
				assetEdit,
			),
		);
		const imageAddress = CART_ROM_BASE + imageOffset;
		const installed = sources.currentBlua32Media.cartridgeSlots[slot]!;
		const linked = linkCartBlua32Image(
			systemImage,
			systemSymbols,
			compiled.object,
			compiled.metadata,
			imageAddress,
			ramByteCount,
			{ image: installed.layout, symbols: installed.symbols! },
		);
		const [entries] = layoutBlua32PublicAssets(
			cartridge.rom,
			linked.bytes.byteLength,
			assetEdit,
		);
		applyLinkedAssetModule(
			compiled,
			linked,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			buildAssetModule(
				entries,
				cartridge.rom.id,
				imageOffset,
			),
		);
		rebuiltCartridgeSlots[slot] = {
			linked,
			previousImage: installed.layout,
			previousSymbols: installed.symbols!,
			sources: compiled.sources,
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
	let systemLayer: RomSourceLayer | null = null;
	const cartridgeLayers: [RomSourceLayer | null, RomSourceLayer | null] = [null, null];
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
	const cartridgeImages: [Blua32ToolingImage | null, Blua32ToolingImage | null] = [
		currentMedia.cartridgeSlots[0],
		currentMedia.cartridgeSlots[1],
	];
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.bytes);
		commitInstalledBlua32Sources(sources.systemLuaSources, rebuilt.system!.sources);
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		sources.systemBlua32MediaDirty = false;
		systemImage = {
			layout: rebuilt.system!.linked.layout,
			symbols: rebuilt.system!.linked.symbols,
		};
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
		cartridgeImages[slot] = {
			layout: rebuilt.cartridgeSlots[slot]!.linked.layout,
			symbols: rebuilt.cartridgeSlots[slot]!.linked.symbols,
		};
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
