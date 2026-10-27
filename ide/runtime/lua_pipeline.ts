import { LuaCaptureLayout } from '../../toolchain/ts/lua/compiler/capture_layout';
import { compiledBlua32Sources } from '../../toolchain/ts/rompack/blua32_sources';
import { LuaSourceCorrespondence } from '../../toolchain/ts/lua/semantic/source_correspondence';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import type { ProgramObjectImage } from '../../toolchain/ts/lua/compiler/program_object';
import { collectProgramSources, collectInstalledProgramSources, type ProgramSourceModule, type ProgramSources } from './program_sources';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import type { Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import {
	createBlua32SourceImage,
	createBlua32SystemSourceImage,
	installRuntimeRomLayers,
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
	type Blua32PublicAssetChanges,
} from '../../toolchain/ts/rompack/blua32_tail';
import { buildLuaSourceAssetChanges } from './source_media';
import type { PackedRomSourceLayer } from '../../toolchain/ts/rompack/source';
import type { ResourceIdentity } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import {
	buildRelocatableRomAssetSymbolModule,
	type RomAssetSymbolModule,
} from '../../toolchain/ts/rompack/asset_symbols';
import {
	ROM_ASSET_SYMBOL_MODULE_PATH,
	ROM_ASSET_SYMBOL_SOURCE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import type {
	Blua32DiagnosticSource,
	Blua32DiagnosticSourceMap,
} from '../../toolchain/ts/rompack/blua32_diagnostics';

/** Explicit source admission, separate from the dependent images the linker must rebuild. */
export type Blua32BuildRequest = {
	readonly system: 'workspace' | 'installed' | null;
	readonly cartridgeSlots: readonly ['workspace' | 'installed' | null, 'workspace' | 'installed' | null];
};

export type RebuiltBlua32Image<
	TLinkedImage extends LinkedBlua32Image = LinkedBlua32Image,
> = {
	linked: TLinkedImage;
	sourceSelection: 'workspace' | 'installed';
	sourceRevision: number;
	previousImage: Blua32ImageLayout;
	previousSymbols: Blua32SymbolsImage;
	sources: ReadonlyMap<string, string>;
	sourceCorrespondence: LuaSourceCorrespondence;
	diagnosticSources: Blua32DiagnosticSourceMap;
	entrySourcePath: string;
	assetChanges: Blua32PublicAssetChanges;
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
	systemLayer: PackedRomSourceLayer<'system'> | null;
	cartridgeLayers: [PackedRomSourceLayer<'cart'> | null, PackedRomSourceLayer<'cart'> | null];
	sourceMedia: Blua32SourceMedia;
};

export type Blua32CartridgeEntry = {
	readonly domain: 0 | 1;
	/** Omit to use the project's module<entry>; otherwise compile this source as the root. */
	readonly sourcePath?: string;
};

export type RuntimeRomAssetEditBatch = readonly [
	system: ReadonlyArray<RomAssetEdit>,
	cartridgeSlot0: ReadonlyArray<RomAssetEdit>,
	cartridgeSlot1: ReadonlyArray<RomAssetEdit>,
];

/** Command-boundary comparison against each attachment's actual compiled members. */
export function blua32InstallationNeedsRebuild(sources: RuntimeSourceState, domain: -1 | 0 | 1): boolean {
	const attachment = domain === -1 ? null : sources.cartridgeSlots[domain];
	if (domain !== -1 && attachment === null) return false;
	const context = sources.catalog.getContext(domain === -1 ? sources.systemContextId : attachment!.contextId);
	if ((domain === -1 ? sources.systemBlua32MediaDirty : sources.cartridgeBlua32MediaDirty[domain])
		|| context.programRevision !== (domain === -1 ? sources.systemSourceRevision : attachment!.installedSourceRevision)) return true;
	const installed = domain === -1 ? sources.systemInstalledBlua32Sources : attachment!.installedBlua32Sources;
	for (const [module, text] of installed) {
		const record = context.luaSources.module2lua[module];
		if (record === undefined || !record.generated && readWorkspaceLuaSourceText(context.luaSources, record) !== text) return true;
	}
	return false;
}

export function blua32MediaRequiresRebuild(sources: RuntimeSourceState): boolean {
	return blua32InstallationNeedsRebuild(sources, -1) || blua32InstallationNeedsRebuild(sources, 0) || blua32InstallationNeedsRebuild(sources, 1);
}

/** Publish workspace rebuild selections for these physical installations only. */
export function prepareBlua32SourceBuildRequest(sources: RuntimeSourceState): Blua32BuildRequest {
	return { system: blua32InstallationNeedsRebuild(sources, -1) ? 'workspace' : null,
		cartridgeSlots: [blua32InstallationNeedsRebuild(sources, 0) ? 'workspace' : null, blua32InstallationNeedsRebuild(sources, 1) ? 'workspace' : null] };
}

function prepareBlua32ProgramSources(
	programSources: ProgramSources,
	assetModulePath: string,
	assetSourcePath: string,
	assetModule: RomAssetSymbolModule,
): {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
	sources: Map<string, string>;
	diagnosticSources: Map<string, Blua32DiagnosticSource>;
	entrySourcePath: string;
} {
	// This build's asset directory owns its generated module, independently of
	// whether the preceding executable included an asset-symbol compiler input.
	const generated: ProgramSourceModule = { path: assetModulePath, sourcePath: assetSourcePath,
		source: assetModule.source, chunk: parseLuaChunk(assetModule.source, assetModulePath).chunk, linkValues: assetModule.linkValues };
	const generatedIndex = programSources.modules.findIndex(module => module.path === assetModulePath);
	if (generatedIndex === -1) programSources.modules.push(generated);
	else programSources.modules[generatedIndex] = generated;
	const entryPath = programSources.entry.path;
	const entrySource = programSources.entry.source;
	const modules = programSources.modules;
	const compiledSources = new Map<string, string>();
	const diagnosticSources = new Map<string, Blua32DiagnosticSource>();
	compiledSources.set(entryPath, entrySource);
	diagnosticSources.set(programSources.entry.chunk.locations.path, {
		displayPath: programSources.entry.sourcePath,
		source: entrySource,
	});
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		compiledSources.set(module.path, module.source);
		diagnosticSources.set(module.chunk.locations.path, {
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
	diagnosticSources.set(modules[moduleIndex].chunk.locations.path, {
		displayPath: modules[moduleIndex].sourcePath,
		source: assetModule.source,
	});
}

export function buildBlua32Media(
	sources: RuntimeSourceState,
	ramByteCount: number,
	request: Blua32BuildRequest,
	mode: 'live' | 'boot',
	assetEdits?: RuntimeRomAssetEditBatch,
	entry?: Blua32CartridgeEntry,
): RebuiltBlua32Media {
	const systemContext = sources.catalog.getContext(sources.systemContextId);
	const systemRegistry = systemContext.luaSources;
	const cartridgeImageOffsets: [number, number] = [0, 0];
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		const imageOffset = cartridge ? cartridge.rom.header.blua32ImageOffset : 0;
		if (imageOffset && (request.system !== null || request.cartridgeSlots[slot] !== null)) {
			cartridgeImageOffsets[slot] = imageOffset;
		}
	}
	const installedSystem = sources.currentBlua32Media.system!;
	let biosImports = installedSystem.biosImports;
	let rebuiltSystem: RebuiltBlua32Image<LinkedSystemBlua32Image> | null = null;
	if (request.system !== null) {
		const imageOffset = sources.systemRom.header.blua32ImageOffset;
		const imageAddress = SYSTEM_ROM_BASE + imageOffset;
		const selected = request.system === 'workspace'
			? collectProgramSources(systemRegistry, systemRegistry.entrySourcePath,
				[...installedSystem.symbols!.metadata.preloadModules, ...BIOS_FUNCTION_EXPORTS.map(exported => exported.path)])
			: collectInstalledProgramSources(installedSystem.sources, installedSystem.symbols!.metadata.compiledModulePaths);
		const assetChanges: Blua32PublicAssetChanges = request.system === 'workspace'
			? buildLuaSourceAssetChanges(sources.systemRom, systemRegistry, sources.systemInstalledBlua32Sources, selected.parsed, assetEdits?.[0])
			: { assetEdits: assetEdits?.[0] };
		const publicAssets = layoutBlua32PublicAssets(
			sources.systemRom,
			installedSystem.layout.bytes.byteLength,
			assetChanges,
		);
		const programSources = prepareBlua32ProgramSources(
			selected,
			SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			SYSTEM_ASSET_SYMBOL_SOURCE_PATH,
			buildRelocatableRomAssetSymbolModule(
				publicAssets.entries,
				sources.systemRom.id,
				imageOffset,
			),
		);
		const sourceCorrespondence = new LuaSourceCorrespondence(sources.systemInstalledBlua32Sources, programSources.sources);
		const compiledSystem = compileLuaChunkToProgram(
			programSources.entry.chunk,
			programSources.modules,
			{
				optLevel: installedSystem.symbols!.metadata.optLevel,
				entrySource: programSources.entry.source,
				programDomain: 'system',
				traceStatements: installedSystem.symbols!.metadata.traceStatements,
				preloadModules: installedSystem.symbols!.metadata.preloadModules,
				captureLayout: mode === 'live' ? new LuaCaptureLayout(installedSystem.symbols!.metadata, sourceCorrespondence) : undefined,
			},
		);
		const systemObject = encodeCompiledProgramObject(compiledSystem);
		const linked = linkSystemBlua32Image(
			systemObject,
			compiledSystem.metadata,
			imageAddress,
			ramByteCount,
			BIOS_FUNCTION_EXPORTS,
			{ image: installedSystem.layout, symbols: installedSystem.symbols!, captureSources: sourceCorrespondence },
		);
		biosImports = linked.biosImports;
		rebuiltSystem = {
			linked,
			sourceSelection: request.system,
			sourceRevision: request.system === 'workspace' ? systemContext.programRevision : sources.systemSourceRevision,
			previousImage: installedSystem.layout,
			previousSymbols: installedSystem.symbols!,
			sources: programSources.sources,
			sourceCorrespondence,
			diagnosticSources: programSources.diagnosticSources,
			entrySourcePath: programSources.entrySourcePath,
			assetChanges,
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
		// A BIOS relink must not admit pending cart edits merely because its imports changed.
		const sourceSelection = request.cartridgeSlots[slot] ?? 'installed';
		const context = sources.catalog.getContext(cartridge.contextId);
		const selected = sourceSelection === 'workspace'
			? collectProgramSources(context.luaSources, entry?.domain === slot ? entry.sourcePath : context.luaSources.entrySourcePath,
				installed.symbols!.metadata.preloadModules)
			: collectInstalledProgramSources(installed.sources, installed.symbols!.metadata.compiledModulePaths);
		const assetChanges: Blua32PublicAssetChanges = sourceSelection === 'workspace'
			? buildLuaSourceAssetChanges(cartridge.rom, context.luaSources, cartridge.installedBlua32Sources, selected.parsed, assetEdits?.[slot + 1])
			: { assetEdits: assetEdits?.[slot + 1] };
		const compileAssets = layoutBlua32PublicAssets(
			cartridge.rom,
			installed.layout.bytes.byteLength,
			assetChanges,
		);
		const programSources = prepareBlua32ProgramSources(
			selected,
			ROM_ASSET_SYMBOL_MODULE_PATH,
			ROM_ASSET_SYMBOL_SOURCE_PATH,
			buildRelocatableRomAssetSymbolModule(
				compileAssets.entries,
				cartridge.rom.id,
				imageOffset,
			),
		);
		const sourceCorrespondence = new LuaSourceCorrespondence(cartridge.installedBlua32Sources, programSources.sources);
		const compiled = compileLuaChunkToProgram(
			programSources.entry.chunk,
			programSources.modules,
			{
				optLevel: installed.symbols!.metadata.optLevel,
				entrySource: programSources.entry.source,
				biosFunctions: biosImports.functions,
				programDomain: 'cart',
				traceStatements: installed.symbols!.metadata.traceStatements,
				preloadModules: installed.symbols!.metadata.preloadModules,
				captureLayout: mode === 'live' ? new LuaCaptureLayout(installed.symbols!.metadata, sourceCorrespondence) : undefined,
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
			{ image: installed.layout, symbols: installed.symbols!, captureSources: sourceCorrespondence },
		);
		const publicAssets = layoutBlua32PublicAssets(
			cartridge.rom,
			linked.bytes.byteLength,
			assetChanges,
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
		sourceCorrespondence.invalidate(ROM_ASSET_SYMBOL_MODULE_PATH);
		rebuiltCartridgeSlots[slot] = {
			linked,
			sourceSelection,
			sourceRevision: sourceSelection === 'workspace' ? context.programRevision : cartridge.installedSourceRevision,
			previousImage: installed.layout,
			previousSymbols: installed.symbols!,
			sources: programSources.sources,
			sourceCorrespondence,
			diagnosticSources: programSources.diagnosticSources,
			entrySourcePath: programSources.entrySourcePath,
			assetChanges,
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
): Blua32MediaInstallation {
	let systemLayer: PackedRomSourceLayer<'system'> | null = null;
	const cartridgeLayers: [PackedRomSourceLayer<'cart'> | null, PackedRomSourceLayer<'cart'> | null] = [null, null];
	if (rebuilt.system !== null) {
		systemLayer = buildBlua32Tail(
			sources.systemRom,
			rebuilt.system.linked,
			rebuilt.system.diagnosticSources,
			rebuilt.system.assetChanges,
		);
	}
	for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
		const image = rebuilt.cartridgeSlots[slot];
		if (image !== null) {
			cartridgeLayers[slot] = buildBlua32Tail(
				sources.cartridgeSlots[slot]!.rom,
				image.linked,
				image.diagnosticSources,
				image.assetChanges,
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
			compiledBlua32Sources(rebuilt.system!.diagnosticSources), sources.systemContextId,
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
			compiledBlua32Sources(rebuilt.cartridgeSlots[slot]!.diagnosticSources), sources.cartridgeSlots[slot]!.contextId,
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
	runtime.history.stop();
	const rebuilt = installation.rebuilt;
	const systemLayer = installation.systemLayer;
	const cartridgeLayers = installation.cartridgeLayers;
	installRuntimeRomLayers(sources, systemLayer, cartridgeLayers);
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.bytes);
		sources.systemSourceRevision = rebuilt.system!.sourceRevision;
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		if (rebuilt.system!.sourceSelection === 'workspace') sources.systemBlua32MediaDirty = false;
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		runtime.machine.cartridgeController.installRom(slot, layer.bytes);
		cartridge.installedSourceRevision = rebuilt.cartridgeSlots[slot]!.sourceRevision;
		cartridge.installedBlua32Sources = rebuilt.cartridgeSlots[slot]!.sources;
		if (rebuilt.cartridgeSlots[slot]!.sourceSelection === 'workspace') sources.cartridgeBlua32MediaDirty[slot] = false;
	}
	sources.currentBlua32Media = installation.sourceMedia;
}

/** Compile and lay out candidate media without changing the installed machine. */
export function prepareBlua32MediaBoot(
	sources: RuntimeSourceState,
	runtime: Runtime,
	rebuildBlua32Media: boolean,
	entry?: Blua32CartridgeEntry,
): Blua32MediaInstallation | null {
	let installation: Blua32MediaInstallation | null = null;
	if (rebuildBlua32Media || entry !== undefined) {
		const request = prepareBlua32SourceBuildRequest(sources);
		const rebuilt = buildBlua32Media(
			sources,
			runtime.machine.memory.ramByteCount(),
			entry === undefined ? request : { ...request,
				cartridgeSlots: [entry.domain === 0 ? 'workspace' : request.cartridgeSlots[0], entry.domain === 1 ? 'workspace' : request.cartridgeSlots[1]] },
			'boot',
			undefined,
			entry,
		);
		installation = layoutBlua32MediaInstallation(sources, rebuilt);
	}
	return installation;
}

/** Starts the one Runtime against the media and source map installed by its owner. */
export function bootInstalledBlua32Media(
	fault: RuntimeFaultState,
	runtime: Runtime,
): void {
	runtime.resetForSystemBoot();
	fault.supervisorFaultSequence = runtime.machine.memory.readMappedU32LE(
		IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	);
	runtime.boot();
}

export function resourceSourceForChunk(sources: RuntimeSourceState, identity: ResourceIdentity): string {
	const luaSource = sources.catalog.resolveLuaSource(identity);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${identity.path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
