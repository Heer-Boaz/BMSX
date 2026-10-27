import { parseCartHeader } from '../../machine/ts/rompack/format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { StudioSourceContext } from '../../hosts/common/studio_projects';
import type { RomToolingPackage } from '../../toolchain/ts/rompack/assets';
import type { RomToolingLayer } from '../../toolchain/ts/rompack/loader';
import { RomSourceStack, type PackedRomSourceLayer, type RawRomSource } from '../../toolchain/ts/rompack/source';
import {
	buildLuaSources, captureInstalledLuaSources,
	type LuaSourceRoot,
} from './source_registry';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../common/resource';
import { WorkspaceSourceCatalog } from '../workspace/source_catalog';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import { CART_LIBRARY_ROOT } from '../../toolchain/ts/lua/source_paths';
import {
	loadBlua32ToolingImage, type Blua32ToolingImage,
} from '../../toolchain/ts/rompack/blua32_media';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import { readBlua32BiosImports, type Blua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import type { Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';

export const enum Blua32GlobalRegisterFile { Global = 1, System = 2 }

type Blua32SourceIndex = {
	readonly globalRegisterFileByName: ReadonlyMap<string, Blua32GlobalRegisterFile>;
	readonly sourceContextId: string;
	/** Canonical module keys; records retain their admitted logical resource paths. */
	readonly sources: ReadonlyMap<string, Blua32CompiledSource>;
};
export type Blua32SourceImage = Blua32ToolingImage & Blua32SourceIndex;
export type Blua32SystemSourceImage = Blua32SourceImage & { readonly biosImports: Blua32BiosImports };

/** Physical code and exact installed source provenance, without mutable authoring registries. */
export type Blua32InstalledMedia = {
	readonly system: Blua32SourceImage | null;
	readonly cartridgeSlots: readonly [Blua32SourceImage | null, Blua32SourceImage | null];
};
export type Blua32SourceMedia = Blua32InstalledMedia & { readonly system: Blua32SystemSourceImage | null };
export type RuntimeInstalledSourceState = { readonly currentBlua32Media: Blua32InstalledMedia };
export type RuntimeSourceBindings = {
	readonly catalog: WorkspaceSourceCatalog;
	readonly systemContextId: string;
	readonly cartridgeContextIds: readonly [string | null, string | null];
};
export type RuntimeCartridgeSourceState = {
	domain: 0 | 1;
	contextId: string;
	rom: RomToolingLayer<'cart'>;
	package: RomToolingPackage;
	romSource: RawRomSource;
	installedBlua32Sources: ReadonlyMap<string, string>;
	installedSourceRevision: number;
};
export type AemSourceApplication = { readonly image: Blua32SourceImage; readonly rom: Uint8Array; installedSource: string | undefined; failed: boolean };

/** Execution attachments reference the independently retained workspace catalog. */
export type RuntimeSourceState = {
	catalog: WorkspaceSourceCatalog;
	systemContextId: string;
	systemRom: RomToolingLayer<'system'>;
	cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null];
	systemPackage: RomToolingPackage;
	activePackage: RomToolingPackage;
	systemRomSource: RawRomSource;
	activeRomSource: RawRomSource;
	activeContextId: string;
	activeCartridgeSlot: ResourceDomain;
	systemBlua32MediaDirty: boolean;
	cartridgeBlua32MediaDirty: [boolean, boolean];
	systemInstalledBlua32Sources: ReadonlyMap<string, string>;
	systemSourceRevision: number;
	aemSourceApplications: Map<string, AemSourceApplication>;
	currentBlua32Media: Blua32SourceMedia;
};

const NO_INSTALLED_SOURCE_TEXT: ReadonlyMap<string, Blua32CompiledSource> = new Map();

function indexInstalledBlua32Sources(compiled: ReadonlyMap<string, Blua32CompiledSource>): Map<string, string> {
	const sources = new Map<string, string>();
	for (const [path, record] of compiled) sources.set(path, readBlua32CompiledSource(record));
	return sources;
}

export function indexBlua32GlobalRegisterFiles(symbols: Blua32SymbolsImage | null): ReadonlyMap<string, Blua32GlobalRegisterFile> {
	const registers = new Map<string, Blua32GlobalRegisterFile>();
	if (symbols !== null) {
		for (const name of symbols.metadata.globalNames) registers.set(name, Blua32GlobalRegisterFile.Global);
		for (const name of symbols.metadata.systemGlobalNames) registers.set(name, Blua32GlobalRegisterFile.System);
	}
	return registers;
}

export function createBlua32SourceImage(layout: Blua32ImageLayout, symbols: Blua32SymbolsImage | null,
	sources: ReadonlyMap<string, Blua32CompiledSource>, sourceContextId: string): Blua32SourceImage {
	return { layout, symbols, sources, sourceContextId, globalRegisterFileByName: indexBlua32GlobalRegisterFiles(symbols) };
}

export function createBlua32SystemSourceImage(layout: Blua32ImageLayout, symbols: Blua32SymbolsImage | null,
	biosImports: Blua32BiosImports, sources: ReadonlyMap<string, Blua32CompiledSource>, sourceContextId: string): Blua32SystemSourceImage {
	return { ...createBlua32SourceImage(layout, symbols, sources, sourceContextId), biosImports };
}

/** The caller explicitly selects one source seed per admitted namespace. */
export function createLoadedProjectSourceCatalog(
	system: { readonly admission: StudioSourceContext; readonly layer: RomToolingLayer<'system'> },
	cartridges: readonly { readonly admission: StudioSourceContext; readonly layer: RomToolingLayer<'cart'> }[],
): WorkspaceSourceCatalog {
	const catalog = new WorkspaceSourceCatalog();
	const seeds = [system, ...cartridges];
	for (const { admission, layer } of seeds) {
		const source = new RomSourceStack([{ id: layer.id, index: layer.index, bytes: layer.bytes }]);
		const image = loadBlua32ToolingImage(layer, layer.id === 'system' ? SYSTEM_ROM_BASE : CART_ROM_BASE);
		const sourceRoots: LuaSourceRoot[] = [{ path: admission.projectRoot, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' }];
		if (layer.id === 'cart') sourceRoots.push({ path: CART_LIBRARY_ROOT, resourcePathPrefix: CART_LIBRARY_ROOT,
			modulePathPrefix: CART_LIBRARY_ROOT, structured: false, sourceKind: 'library' });
		const registry = buildLuaSources(source, source, layer.index, layer.id,
			image === null || image.symbols === null ? undefined : image.symbols.metadata.compiledModulePaths[0], sourceRoots);
		const previewPackage = { ...layer.package, img: { ...layer.package.img }, audio: { ...layer.package.audio },
			model: { ...layer.package.model }, data: { ...layer.package.data }, bin: { ...layer.package.bin },
			collision_shape: { ...layer.package.collision_shape }, audioevents: { ...layer.package.audioevents } };
		catalog.admitContext({ admission, programDomain: layer.id, systemContextId: layer.id === 'cart' ? system.admission.id : null, luaSources: registry, sourceRoots,
			dependencyContextIds: layer.id === 'cart' ? [system.admission.id] : [], previewPackage,
			previewRom: { ...layer, package: previewPackage }, assetSources: source.list() });
	}
	return catalog;
}

/** Installs exact image provenance against existing retained source authority. */
export function createRuntimeSourceState(systemLayer: RomToolingLayer<'system'>,
	cartridgeLayers: readonly [RomToolingLayer<'cart'> | null, RomToolingLayer<'cart'> | null],
	bindings: RuntimeSourceBindings): RuntimeSourceState {
	const { catalog, systemContextId } = bindings;
	const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, bytes: systemLayer.bytes }]);
	const systemImage = loadBlua32ToolingImage(systemLayer, SYSTEM_ROM_BASE);
	const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, 'system',
		systemImage === null || systemImage.symbols === null ? undefined : systemImage.symbols.metadata.compiledModulePaths[0], catalog.getContext(systemContextId).sourceRoots);
	const cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null] = [null, null];
	const images: [Blua32SourceImage | null, Blua32SourceImage | null] = [null, null];
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const layer = cartridgeLayers[slot];
		if (layer === null) continue;
		const contextId = bindings.cartridgeContextIds[slot]!;
		const source = new RomSourceStack([{ id: layer.id, index: layer.index, bytes: layer.bytes }]);
		const image = loadBlua32ToolingImage(layer, CART_ROM_BASE);
		const registry = buildLuaSources(source, source, layer.index, 'cart',
			image === null || image.symbols === null ? undefined : image.symbols.metadata.compiledModulePaths[0], catalog.getContext(contextId).sourceRoots);
		const compiledSources = image === null || image.symbols === null ? NO_INSTALLED_SOURCE_TEXT
			: captureInstalledLuaSources(registry, image.symbols.metadata.compiledModulePaths);
		const installedBlua32Sources = indexInstalledBlua32Sources(compiledSources);
		cartridgeSlots[slot] = { domain: slot, contextId, rom: layer, package: layer.package, romSource: source,
			installedBlua32Sources, installedSourceRevision: sourceRevisionForInstallation(catalog, contextId, image, installedBlua32Sources) };
		images[slot] = image === null ? null : createBlua32SourceImage(image.layout, image.symbols, compiledSources, contextId);
	}
	const compiledSystemSources = systemImage === null || systemImage.symbols === null ? NO_INSTALLED_SOURCE_TEXT
		: captureInstalledLuaSources(systemLuaSources, systemImage.symbols.metadata.compiledModulePaths);
	const systemInstalledBlua32Sources = indexInstalledBlua32Sources(compiledSystemSources);
	return {
		catalog, systemContextId, systemRom: systemLayer, cartridgeSlots,
		systemPackage: systemLayer.package, activePackage: systemLayer.package,
		systemRomSource: systemSource, activeRomSource: systemSource,
		activeContextId: systemContextId, activeCartridgeSlot: SYSTEM_RESOURCE_DOMAIN,
		systemBlua32MediaDirty: false, cartridgeBlua32MediaDirty: [false, false],
		systemInstalledBlua32Sources, systemSourceRevision: sourceRevisionForInstallation(catalog, systemContextId, systemImage, systemInstalledBlua32Sources),
		aemSourceApplications: new Map(),
		currentBlua32Media: { system: systemImage === null ? null : createBlua32SystemSourceImage(
			systemImage.layout, systemImage.symbols, readBlua32BiosImports(systemLayer.bytes),
			compiledSystemSources, systemContextId), cartridgeSlots: images },
	};
}

function sourceRevisionForInstallation(catalog: WorkspaceSourceCatalog, contextId: string,
	image: Blua32ToolingImage | null, installed: ReadonlyMap<string, string>): number {
	if (image === null || image.symbols === null) return -1;
	const context = catalog.getContext(contextId);
	for (const path of image.symbols.metadata.compiledModulePaths) {
		const record = context.luaSources.module2lua[path], text = installed.get(path);
		if (record === undefined || text === undefined || !record.generated && text !== readWorkspaceLuaSourceText(context.luaSources, record)) return -1;
	}
	return context.programRevision;
}

export function enterSystemSources(state: RuntimeSourceState): void {
	state.activeCartridgeSlot = SYSTEM_RESOURCE_DOMAIN;
	state.activeContextId = state.systemContextId;
	state.activePackage = state.systemPackage;
	state.activeRomSource = state.systemRomSource;
}
export function enterCartridgeSources(state: RuntimeSourceState, slot: 0 | 1): void {
	const cartridge = state.cartridgeSlots[slot]!;
	state.activeCartridgeSlot = slot;
	state.activeContextId = cartridge.contextId;
	state.activePackage = cartridge.package;
	state.activeRomSource = cartridge.romSource;
}
export function syncRuntimeSourceActivity(state: RuntimeSourceState, slot: ResourceDomain): void {
	if (state.activeCartridgeSlot === slot) return;
	if (slot === SYSTEM_RESOURCE_DOMAIN) enterSystemSources(state); else enterCartridgeSources(state, slot);
}
export function runtimeSourcesSupportIde(state: RuntimeSourceState): boolean {
	const active = state.catalog.getContext(state.activeContextId);
	return state.catalog.getContext(state.systemContextId).luaSources.can_boot_from_source && active.luaSources.can_boot_from_source;
}

export function installRuntimeRomLayers(state: RuntimeSourceState, systemLayer: PackedRomSourceLayer<'system'> | null,
	cartridgeLayers: [PackedRomSourceLayer<'cart'> | null, PackedRomSourceLayer<'cart'> | null]): void {
	if (systemLayer !== null) {
		state.systemRom.index = systemLayer.index;
		state.systemRom.bytes = systemLayer.bytes;
		state.systemRom.header = parseCartHeader(systemLayer.bytes);
		state.systemRomSource = new RomSourceStack([systemLayer]);
	}
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const layer = cartridgeLayers[slot];
		if (layer === null) continue;
		const cartridge = state.cartridgeSlots[slot]!;
		cartridge.rom.index = layer.index;
		cartridge.rom.bytes = layer.bytes;
		cartridge.rom.header = parseCartHeader(layer.bytes);
		cartridge.romSource = new RomSourceStack([layer]);
	}
	state.activeRomSource = state.activeCartridgeSlot === SYSTEM_RESOURCE_DOMAIN
		? state.systemRomSource : state.cartridgeSlots[state.activeCartridgeSlot]!.romSource;
}

/** Build-owned source copies retain admission identities and exact attachment provenance. */
export function forkRuntimeSourceState(source: RuntimeSourceState): RuntimeSourceState {
	return {
		...source, catalog: source.catalog.fork(), systemRom: { ...source.systemRom },
		cartridgeSlots: [source.cartridgeSlots[0] === null ? null : { ...source.cartridgeSlots[0], rom: { ...source.cartridgeSlots[0].rom } },
			source.cartridgeSlots[1] === null ? null : { ...source.cartridgeSlots[1], rom: { ...source.cartridgeSlots[1].rom } }],
		cartridgeBlua32MediaDirty: [...source.cartridgeBlua32MediaDirty],
		aemSourceApplications: new Map([...source.aemSourceApplications].map(([key, application]) => [key, { ...application }])),
	};
}
