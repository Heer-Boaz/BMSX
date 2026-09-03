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
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import {
	createBlua32SourceImage,
	createBlua32SystemSourceImage,
	installRuntimeRomLayers,
	resolveRuntimeLuaSource,
	type Blua32SourceImage,
	type Blua32SourceMedia,
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
import type { ResourceIdentity } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import type { RuntimeLuaTooling } from './lua_tooling';
import {
	buildRelocatableRomAssetSymbolModule,
	type RomAssetSymbolModule,
} from '../../toolchain/ts/rompack/asset_symbols';
import {
	ROM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import type {
	Blua32DiagnosticSource,
	Blua32DiagnosticSourceMap,
} from '../../toolchain/ts/rompack/blua32_diagnostics';

export type RebuiltBlua32Image<
	TLinkedImage extends LinkedBlua32Image = LinkedBlua32Image,
> = {
	linked: TLinkedImage;
	previousImage: Blua32ImageLayout;
	previousSymbols: Blua32SymbolsImage;
	sources: ReadonlyMap<string, string>;
	diagnosticSources: Blua32DiagnosticSourceMap;
	entrySourcePath: string;
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

export type Blua32MediaInstallation = {
	rebuilt: RebuiltBlua32Media;
	systemLayer: RomSourceLayer<'system'> | null;
	cartridgeLayers: [RomSourceLayer<'cart'> | null, RomSourceLayer<'cart'> | null];
	sourceMedia: Blua32SourceMedia;
};

export type RuntimeRomAssetEditBatch = readonly [
	system: ReadonlyArray<RomAssetEdit>,
	cartridgeSlot0: ReadonlyArray<RomAssetEdit>,
	cartridgeSlot1: ReadonlyArray<RomAssetEdit>,
];

export function blua32MediaRequiresRebuild(sources: RuntimeSourceState): boolean {
	return sources.systemBlua32MediaDirty
		|| sources.cartridgeBlua32MediaDirty[0]
		|| sources.cartridgeBlua32MediaDirty[1];
}

function createFreshLuaInterpreter(
	bridge: RuntimeLuaTooling,
): LuaInterpreter {
	return new LuaInterpreter(bridge.luaJsBridge);
}

function buildProgramSources(
	registries: LuaSourceRegistry[],
	interpreter: LuaInterpreter,
	generatedSourceRevision?: RomAssetSymbolModule & { modulePath: string },
): {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
} {
	const modules: ProgramSourceModule[] = [];
	const seen = new Set<string>();
	for (const registry of registries) {
		for (const asset of registry.records) {
			if (!asset.program_module) {
				continue;
			}
			const key = asset.module_path;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const generated = generatedSourceRevision && key === generatedSourceRevision.modulePath
				? generatedSourceRevision
				: undefined;
			const source = generated
				? generated.source
				: readWorkspaceLuaSourceText(registry, asset);
			const chunk = interpreter.compileChunk(source, key);
			const module: ProgramSourceModule = {
				path: key,
				sourcePath: asset.source_path,
				chunk,
				source,
			};
			if (generated) {
				module.linkValues = generated.linkValues;
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
	assetModule: RomAssetSymbolModule,
): {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
	sources: Map<string, string>;
	diagnosticSources: Map<string, Blua32DiagnosticSource>;
	entrySourcePath: string;
} {
	const programSources = buildProgramSources(
		[registry],
		interpreter,
		{ modulePath: assetModulePath, ...assetModule },
	);
	const entryPath = programSources.entry.path;
	const entrySource = programSources.entry.source;
	const modules = programSources.modules;
	const compiledSources = new Map<string, string>();
	const diagnosticSources = new Map<string, Blua32DiagnosticSource>();
	compiledSources.set(entryPath, entrySource);
	diagnosticSources.set(programSources.entry.chunk.range.path, {
		displayPath: programSources.entry.sourcePath,
		source: entrySource,
	});
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		compiledSources.set(module.path, module.source);
		diagnosticSources.set(module.chunk.range.path, {
			displayPath: module.sourcePath,
			source: module.source,
		});
	}
	return {
		entry: programSources.entry,
		modules,
		sources: compiledSources,
		diagnosticSources,
		entrySourcePath: programSources.entry.sourcePath,
	};
}

function applyLinkedAssetModule(
	object: ProgramObjectImage,
	modules: ProgramSourceModule[],
	sources: Map<string, string>,
	diagnosticSources: Map<string, Blua32DiagnosticSource>,
	linked: LinkedBlua32Image,
	modulePath: string,
	assetModule: RomAssetSymbolModule,
): void {
	applyBlua32LinkValues(
		linked,
		object.link.constValueRelocs,
		modulePath,
		assetModule.linkValues,
	);
	sources.set(modulePath, assetModule.source);
	let moduleIndex = 0;
	while (modules[moduleIndex].path !== modulePath) {
		moduleIndex += 1;
	}
	modules[moduleIndex].source = assetModule.source;
	modules[moduleIndex].linkValues = assetModule.linkValues;
	diagnosticSources.set(modules[moduleIndex].chunk.range.path, {
		displayPath: modules[moduleIndex].sourcePath,
		source: assetModule.source,
	});
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
	assetEdits?: RuntimeRomAssetEditBatch,
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
		const publicAssets = layoutBlua32PublicAssets(
			sources.systemRom,
			installedSystem.layout.bytes.byteLength,
			{ assetEdits: assetEdits?.[0] },
		);
		const programSources = prepareRegistryProgramSources(
			systemRegistry,
			interpreter,
			SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			buildRelocatableRomAssetSymbolModule(
				publicAssets.entries,
				sources.systemRom.id,
				imageOffset,
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
		biosImports = linked.biosImports;
		rebuiltSystem = {
			linked,
			previousImage: installedSystem.layout,
			previousSymbols: installedSystem.symbols!,
			sources: programSources.sources,
			diagnosticSources: programSources.diagnosticSources,
			entrySourcePath: programSources.entrySourcePath,
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
		const installed = sources.currentBlua32Media.cartridgeSlots[slot]!;
		const compileAssets = layoutBlua32PublicAssets(
			cartridge.rom,
			installed.layout.bytes.byteLength,
			{ assetEdits: assetEdits?.[slot + 1] },
		);
		const programSources = prepareRegistryProgramSources(
			cartridge.luaSources,
			interpreter,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			buildRelocatableRomAssetSymbolModule(
				compileAssets.entries,
				cartridge.rom.id,
				imageOffset,
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
			{ assetEdits: assetEdits?.[slot + 1] },
		);
		applyLinkedAssetModule(
			cartObject,
			programSources.modules,
			programSources.sources,
			programSources.diagnosticSources,
			linked,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			buildRelocatableRomAssetSymbolModule(
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
			diagnosticSources: programSources.diagnosticSources,
			entrySourcePath: programSources.entrySourcePath,
		};
	}
	return {
		system: rebuiltSystem,
		cartridgeSlots: rebuiltCartridgeSlots,
	};
}

export function layoutBlua32MediaInstallation(
	sources: RuntimeSourceState,
	rebuilt: RebuiltBlua32Media,
	assetEdits?: RuntimeRomAssetEditBatch,
): Blua32MediaInstallation {
	let systemLayer: RomSourceLayer<'system'> | null = null;
	const cartridgeLayers: [RomSourceLayer<'cart'> | null, RomSourceLayer<'cart'> | null] = [null, null];
	if (rebuilt.system !== null) {
		systemLayer = buildBlua32Tail(
			sources.systemRom,
			rebuilt.system.linked,
			rebuilt.system.diagnosticSources,
			{
				assetEdits: assetEdits?.[0],
			},
		);
	}
	for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
		const image = rebuilt.cartridgeSlots[slot];
		if (image !== null) {
			cartridgeLayers[slot] = buildBlua32Tail(
				sources.cartridgeSlots[slot]!.rom,
				image.linked,
				image.diagnosticSources,
				{
					assetEdits: assetEdits?.[slot + 1],
				},
			);
		}
	}
	const currentMedia = sources.currentBlua32Media;
	let systemImage = currentMedia.system;
	const cartridgeImages: [Blua32SourceImage | null, Blua32SourceImage | null] = [
		currentMedia.cartridgeSlots[0],
		currentMedia.cartridgeSlots[1],
	];
	if (systemLayer !== null) {
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
		cartridgeImages[slot] = createBlua32SourceImage(
			rebuilt.cartridgeSlots[slot]!.linked.layout,
			rebuilt.cartridgeSlots[slot]!.linked.symbols,
		);
	}
	return {
		rebuilt,
		systemLayer,
		cartridgeLayers,
		sourceMedia: {
			system: systemImage,
			cartridgeSlots: cartridgeImages,
		},
	};
}

export function installBlua32Media(
	sources: RuntimeSourceState,
	runtime: Runtime,
	installation: Blua32MediaInstallation,
): void {
	const rebuilt = installation.rebuilt;
	const systemLayer = installation.systemLayer;
	const cartridgeLayers = installation.cartridgeLayers;
	installRuntimeRomLayers(sources, systemLayer, cartridgeLayers);
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.bytes);
		commitInstalledBlua32Sources(sources.systemLuaSources, rebuilt.system!.sources);
		sources.systemLuaSources.entrySourcePath = rebuilt.system!.entrySourcePath;
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		sources.systemBlua32MediaDirty = false;
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		runtime.machine.cartridgeController.installRom(slot, layer.bytes);
		commitInstalledBlua32Sources(
			cartridge.luaSources,
			rebuilt.cartridgeSlots[slot]!.sources,
		);
		cartridge.luaSources.entrySourcePath = rebuilt.cartridgeSlots[slot]!.entrySourcePath;
		cartridge.installedBlua32Sources = rebuilt.cartridgeSlots[slot]!.sources;
		sources.cartridgeBlua32MediaDirty[slot] = false;
	}
	sources.currentBlua32Media = installation.sourceMedia;
}

/** Materializes canonical dirty media and returns the fresh tooling interpreter for the next boot. */
export function prepareBlua32MediaBoot(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	rebuildBlua32Media: boolean,
): LuaInterpreter {
	const interpreter = createFreshLuaInterpreter(luaTooling);
	if (rebuildBlua32Media) {
		const rebuilt = buildBlua32Media(
			sources,
			interpreter,
			runtime.machine.memory.ramByteCount(),
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
		);
		installBlua32Media(
			sources,
			runtime,
			layoutBlua32MediaInstallation(sources, rebuilt),
		);
	}
	return interpreter;
}

/** Starts the one Runtime against the media and source map installed by its owner. */
export function bootInstalledBlua32Media(
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	interpreter: LuaInterpreter,
): void {
	resetHandledLuaErrors(fault);
	luaTooling.luaInterpreter = interpreter;
	runtime.resetForSystemBoot();
	fault.supervisorFaultSequence = runtime.machine.memory.readMappedU32LE(
		IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	);
	runtime.boot();
}

export function resourceSourceForChunk(sources: RuntimeSourceState, identity: ResourceIdentity): string {
	const luaSource = resolveRuntimeLuaSource(sources, identity);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${identity.path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
