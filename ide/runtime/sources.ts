import { parseCartHeader, type RuntimeRomPackage } from '../../machine/ts/rompack/format';
import type { RuntimeRomLayer } from '../../machine/ts/rompack/loader';
import { RomSourceStack, type RawRomSource, type RomSourceLayer } from '../../machine/ts/rompack/source';
import {
	buildLuaSources,
	resolveLuaSourceRecord,
	type LuaSourceMatch,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../machine/ts/lua/source_registry';
import {
	CARTRIDGE_RESOURCE_DOMAINS,
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
	type ResourceIdentity,
	type RuntimeResource,
	resourceIdentityKey,
	resourceIdentityKeyFromParts,
} from '../common/resource';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	loadBlua32ToolingImage,
	type Blua32ToolingImage,
	type Blua32ToolingMedia,
} from '../../machine/ts/rompack/tooling/blua32_media';

const SYSTEM_PROJECT_ROOT_PATH = 'machine/firmware';

export type RuntimeCartridgeSourceState = {
	domain: 0 | 1;
	rom: RuntimeRomLayer;
	package: RuntimeRomPackage;
	luaSources: LuaSourceRegistry;
	romSource: RawRomSource;
	projectRootPath: string;
	installedBlua32Sources: ReadonlyMap<string, string>;
	aemResources: RuntimeResource[];
};

export type RuntimeSourceState = {
	systemRom: RuntimeRomLayer;
	cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null];
	systemPackage: RuntimeRomPackage;
	activePackage: RuntimeRomPackage;
	systemLuaSources: LuaSourceRegistry;
	activeLuaSources: LuaSourceRegistry;
	luaSourceRegistries: LuaSourceRegistry[];
	moduleCompileLuaSources: LuaSourceRegistry[];
	systemRomSource: RawRomSource;
	activeRomSource: RawRomSource;
	resourceByIdentity: Map<string, RuntimeResource>;
	luaResources: RuntimeResource[];
	systemAemResources: RuntimeResource[];
	activeResources: RuntimeResource[];
	systemProjectRootPath: string;
	activeCartridgeSlot: ResourceDomain;
	realtimeCompileOptLevel: 0 | 1 | 2 | 3;
	systemBlua32MediaDirty: boolean;
	cartridgeBlua32MediaDirty: [boolean, boolean];
	systemInstalledBlua32Sources: ReadonlyMap<string, string>;
	currentBlua32Media: Blua32ToolingMedia;
};

export type RuntimeLuaSourceMatch = LuaSourceMatch & {
	domain: ResourceDomain;
};

function indexInstalledBlua32Sources(registry: LuaSourceRegistry): Map<string, string> {
	const sourceByPath = new Map<string, string>();
	for (let index = 0; index < registry.records.length; index += 1) {
		const record = registry.records[index];
		sourceByPath.set(record.module_path, record.src);
	}
	return sourceByPath;
}

export function createRuntimeSourceState(
	systemLayer: RuntimeRomLayer,
	cartridgeLayers: readonly [RuntimeRomLayer | null, RuntimeRomLayer | null],
): RuntimeSourceState {
	const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
	const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, ['system']);
	const luaSourceRegistries: LuaSourceRegistry[] = [];
	const moduleCompileLuaSources: LuaSourceRegistry[] = [];
	const systemProjectRootPath = systemLuaSources.projectRootPath || SYSTEM_PROJECT_ROOT_PATH;
	const cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null] = [null, null];
	const cartridgeToolingImages: [Blua32ToolingImage | null, Blua32ToolingImage | null] = [null, null];
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const cartLayer = cartridgeLayers[slot];
		if (cartLayer === null) {
			continue;
		}
		const activeSourceLayers: RomSourceLayer[] = [
			{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload },
			{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload },
		];
		const activeRomSource = new RomSourceStack(activeSourceLayers);
		const cartRomSource = new RomSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = buildLuaSources(cartRomSource, activeRomSource, cartLayer.index, ['cart']);
		cartridgeSlots[slot] = {
			domain: slot,
			rom: cartLayer,
			package: cartLayer.package,
			luaSources: cartLuaSources,
			romSource: cartRomSource,
			projectRootPath: cartLayer.index.projectRootPath,
			installedBlua32Sources: indexInstalledBlua32Sources(cartLuaSources),
			aemResources: [],
		};
		cartridgeToolingImages[slot] = loadBlua32ToolingImage(
			cartLayer,
			cartRomSource,
			CART_ROM_BASE,
		);
	}
	const state: RuntimeSourceState = {
		systemRom: systemLayer,
		cartridgeSlots,
		systemPackage: systemLayer.package,
		activePackage: systemLayer.package,
		systemLuaSources,
		activeLuaSources: systemLuaSources,
		luaSourceRegistries,
		moduleCompileLuaSources,
		systemRomSource: systemSource,
		activeRomSource: systemSource,
		resourceByIdentity: new Map(),
		luaResources: [],
		systemAemResources: [],
		activeResources: [],
		systemProjectRootPath,
		activeCartridgeSlot: SYSTEM_RESOURCE_DOMAIN,
		realtimeCompileOptLevel: 3,
		systemBlua32MediaDirty: false,
		cartridgeBlua32MediaDirty: [false, false],
		systemInstalledBlua32Sources: indexInstalledBlua32Sources(systemLuaSources),
		currentBlua32Media: {
			system: loadBlua32ToolingImage(systemLayer, systemSource, SYSTEM_ROM_BASE),
			cartridgeSlots: cartridgeToolingImages,
		},
	};
	rebuildRuntimeSourceResources(state);
	enterSystemSources(state);
	return state;
}

export function enterSystemSources(state: RuntimeSourceState): void {
	state.activeCartridgeSlot = SYSTEM_RESOURCE_DOMAIN;
	state.activePackage = state.systemPackage;
	state.activeLuaSources = state.systemLuaSources;
	state.activeRomSource = state.systemRomSource;
	refreshActiveResources(state, state.systemAemResources);
	rebuildLuaSourceOrders(state);
}

export function enterCartridgeSources(state: RuntimeSourceState, slot: 0 | 1): void {
	const cartridge = state.cartridgeSlots[slot]!;
	state.activeCartridgeSlot = slot;
	state.activePackage = cartridge.package;
	state.activeLuaSources = cartridge.luaSources;
	state.activeRomSource = cartridge.romSource;
	refreshActiveResources(state, cartridge.aemResources);
	rebuildLuaSourceOrders(state);
}

export function syncRuntimeSourceActivity(state: RuntimeSourceState, cartridgeSlot: ResourceDomain): void {
	if (state.activeCartridgeSlot === cartridgeSlot) {
		return;
	}
	if (cartridgeSlot !== SYSTEM_RESOURCE_DOMAIN) {
		enterCartridgeSources(state, cartridgeSlot);
		return;
	}
	enterSystemSources(state);
}

export function developmentCartridgeSource(state: RuntimeSourceState): RuntimeCartridgeSourceState | null {
	if (state.activeCartridgeSlot !== SYSTEM_RESOURCE_DOMAIN) {
		return state.cartridgeSlots[state.activeCartridgeSlot];
	}
	for (let slot = 0; slot < state.cartridgeSlots.length; slot += 1) {
		const cartridge = state.cartridgeSlots[slot];
		if (cartridge
			&& cartridge.rom.header.blua32ImageOffset
			&& cartridge.luaSources.can_boot_from_source) {
			return cartridge;
		}
	}
	return null;
}

export function runtimeSourcesSupportIde(state: RuntimeSourceState): boolean {
	const activeCartridge = state.activeCartridgeSlot !== SYSTEM_RESOURCE_DOMAIN
		? state.cartridgeSlots[state.activeCartridgeSlot]
		: null;
	return state.systemLuaSources.can_boot_from_source
		&& (!activeCartridge || activeCartridge.luaSources.can_boot_from_source);
}

export function installRuntimeRomLayers(
	state: RuntimeSourceState,
	systemLayer: RomSourceLayer | null,
	cartridgeLayers: [RomSourceLayer | null, RomSourceLayer | null],
): void {
	if (systemLayer !== null) {
		state.systemRom.index = systemLayer.index;
		state.systemRom.payload = systemLayer.payload;
		state.systemRom.header = parseCartHeader(systemLayer.payload);
		state.systemRomSource = new RomSourceStack([{
			id: systemLayer.id,
			index: systemLayer.index,
			payload: systemLayer.payload,
		}]);
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		const cartridge = state.cartridgeSlots[slot]!;
		cartridge.rom.index = layer.index;
		cartridge.rom.payload = layer.payload;
		cartridge.rom.header = parseCartHeader(layer.payload);
		cartridge.romSource = new RomSourceStack([{
			id: layer.id,
			index: layer.index,
			payload: layer.payload,
		}]);
	}
	state.activeRomSource = state.activeCartridgeSlot === SYSTEM_RESOURCE_DOMAIN
		? state.systemRomSource
		: state.cartridgeSlots[state.activeCartridgeSlot]!.romSource;
	rebuildRuntimeSourceResources(state);
}

export function runtimeLuaSourceRegistry(
	state: RuntimeSourceState,
	domain: ResourceDomain,
): LuaSourceRegistry | null {
	if (domain === SYSTEM_RESOURCE_DOMAIN) {
		return state.systemLuaSources;
	}
	const cartridge = state.cartridgeSlots[domain];
	return cartridge === null ? null : cartridge.luaSources;
}

export function runtimeSourceProjectRootPath(
	state: RuntimeSourceState,
	domain: ResourceDomain,
): string {
	return domain === SYSTEM_RESOURCE_DOMAIN
		? state.systemProjectRootPath
		: state.cartridgeSlots[domain]!.projectRootPath;
}

export function runtimeSourceDomainForProjectRootPath(
	state: RuntimeSourceState,
	projectRootPath: string,
): ResourceDomain {
	if (state.systemProjectRootPath === projectRootPath) {
		return SYSTEM_RESOURCE_DOMAIN;
	}
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		if (state.cartridgeSlots[slot]?.projectRootPath === projectRootPath) {
			return slot;
		}
	}
	throw new Error(`Project root '${projectRootPath}' is not installed.`);
}

export function runtimeLuaSourceDomain(
	state: RuntimeSourceState,
	registry: LuaSourceRegistry,
): ResourceDomain {
	if (registry === state.systemLuaSources) {
		return SYSTEM_RESOURCE_DOMAIN;
	}
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		if (state.cartridgeSlots[slot]?.luaSources === registry) {
			return slot;
		}
	}
	throw new Error('Lua source registry is not installed.');
}

export function resolveRuntimeLuaSource(
	state: RuntimeSourceState,
	identity: ResourceIdentity,
): RuntimeLuaSourceMatch | null {
	const registry = runtimeLuaSourceRegistry(state, identity.domain);
	if (registry === null) {
		return null;
	}
	const record = resolveLuaSourceRecord(registry, identity.path);
	return record === null ? null : { domain: identity.domain, registry, record };
}

export function resolveRuntimeLuaSourceForContext(
	state: RuntimeSourceState,
	domain: ResourceDomain,
	path: string,
): RuntimeLuaSourceMatch | null {
	const source = resolveRuntimeLuaSource(state, { domain, path });
	if (source !== null || domain === SYSTEM_RESOURCE_DOMAIN) {
		return source;
	}
	return resolveRuntimeLuaSource(state, { domain: SYSTEM_RESOURCE_DOMAIN, path });
}

export function resolveRuntimeResource(
	state: RuntimeSourceState,
	identity: ResourceIdentity,
): RuntimeResource | undefined {
	return state.resourceByIdentity.get(resourceIdentityKey(identity));
}

export function resolveRuntimeResourceForContext(
	state: RuntimeSourceState,
	domain: ResourceDomain,
	path: string,
): RuntimeResource | undefined {
	const resource = state.resourceByIdentity.get(resourceIdentityKeyFromParts(domain, path));
	if (resource || domain === SYSTEM_RESOURCE_DOMAIN) {
		return resource;
	}
	return state.resourceByIdentity.get(resourceIdentityKeyFromParts(SYSTEM_RESOURCE_DOMAIN, path));
}

export function registerRuntimeLuaResource(
	state: RuntimeSourceState,
	domain: ResourceDomain,
	source: LuaSourceRecord,
): RuntimeResource {
	const key = resourceIdentityKeyFromParts(domain, source.source_path);
	const previous = state.resourceByIdentity.get(key);
	if (previous) {
		previous.source = source;
		return previous;
	}
	const resource = retainRuntimeResource(
		state.resourceByIdentity,
		state.resourceByIdentity,
		domain,
		source.source_path,
		source,
	);
	state.luaResources.push(resource);
	sortRuntimeResources(state.luaResources);
	refreshActiveResources(
		state,
		state.activeCartridgeSlot === SYSTEM_RESOURCE_DOMAIN
			? state.systemAemResources
			: state.cartridgeSlots[state.activeCartridgeSlot]!.aemResources,
	);
	return resource;
}

export function rebuildRuntimeSourceResources(state: RuntimeSourceState): void {
	const previousResources = state.resourceByIdentity;
	const resources = new Map<string, RuntimeResource>();
	state.resourceByIdentity = resources;

	state.luaResources.length = 0;
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
		const cartridge = state.cartridgeSlots[domain];
		if (!cartridge) {
			continue;
		}
		retainLuaResources(previousResources, resources, state.luaResources, domain, cartridge.luaSources);
		rebuildAemResources(previousResources, resources, cartridge.aemResources, domain, cartridge.romSource);
	}
	retainLuaResources(
		previousResources,
		resources,
		state.luaResources,
		SYSTEM_RESOURCE_DOMAIN,
		state.systemLuaSources,
	);
	rebuildAemResources(
		previousResources,
		resources,
		state.systemAemResources,
		SYSTEM_RESOURCE_DOMAIN,
		state.systemRomSource,
	);
	sortRuntimeResources(state.luaResources);
	refreshActiveResources(
		state,
		state.activeCartridgeSlot === SYSTEM_RESOURCE_DOMAIN
			? state.systemAemResources
			: state.cartridgeSlots[state.activeCartridgeSlot]!.aemResources,
	);
}

function retainRuntimeResource(
	previousResources: ReadonlyMap<string, RuntimeResource>,
	resources: Map<string, RuntimeResource>,
	domain: ResourceDomain,
	path: string,
	source: RuntimeResource['source'],
): RuntimeResource {
	const key = resourceIdentityKeyFromParts(domain, path);
	const retained = previousResources.get(key);
	if (retained) {
		retained.source = source;
		resources.set(key, retained);
		return retained;
	}
	const resource: RuntimeResource = { domain, path, source };
	resources.set(key, resource);
	return resource;
}

function retainLuaResources(
	previousResources: ReadonlyMap<string, RuntimeResource>,
	resources: Map<string, RuntimeResource>,
	luaResources: RuntimeResource[],
	domain: ResourceDomain,
	registry: LuaSourceRegistry,
): void {
	for (let index = 0; index < registry.records.length; index += 1) {
		const source = registry.records[index];
		luaResources.push(retainRuntimeResource(
			previousResources,
			resources,
			domain,
			source.source_path,
			source,
		));
	}
}

function rebuildAemResources(
	previousResources: ReadonlyMap<string, RuntimeResource>,
	resources: Map<string, RuntimeResource>,
	aemResources: RuntimeResource[],
	domain: ResourceDomain,
	romSource: RawRomSource,
): void {
	aemResources.length = 0;
	const records = romSource.list('aem');
	for (let index = 0; index < records.length; index += 1) {
		const source = records[index];
		if (!source.source_path) {
			continue;
		}
		aemResources.push(retainRuntimeResource(
			previousResources,
			resources,
			domain,
			source.source_path,
			source,
		));
	}
	sortRuntimeResources(aemResources);
}

function refreshActiveResources(state: RuntimeSourceState, aemResources: readonly RuntimeResource[]): void {
	state.activeResources.length = 0;
	for (let index = 0; index < state.luaResources.length; index += 1) {
		state.activeResources.push(state.luaResources[index]);
	}
	for (let index = 0; index < aemResources.length; index += 1) {
		state.activeResources.push(aemResources[index]);
	}
	sortRuntimeResources(state.activeResources);
}

function sortRuntimeResources(resources: RuntimeResource[]): void {
	resources.sort((left, right) => left.path.localeCompare(right.path) || left.domain - right.domain);
}

function rebuildLuaSourceOrders(state: RuntimeSourceState): void {
	state.luaSourceRegistries.length = 0;
	for (let slot = 0; slot < state.cartridgeSlots.length; slot += 1) {
		const cartridge = state.cartridgeSlots[slot];
		if (cartridge !== null) {
			state.luaSourceRegistries.push(cartridge.luaSources);
		}
	}
	state.luaSourceRegistries.push(state.systemLuaSources);

	state.moduleCompileLuaSources.length = 0;
	state.moduleCompileLuaSources.push(state.activeLuaSources);
	if (state.systemLuaSources !== state.activeLuaSources) {
		state.moduleCompileLuaSources.push(state.systemLuaSources);
	}
}
