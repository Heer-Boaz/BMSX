import { parseCartHeader, type RuntimeRomPackage } from '../../rompack/format';
import type { RuntimeRomLayer } from '../../rompack/loader';
import { RomSourceStack, type RawRomSource, type RomSourceLayer } from '../../rompack/source';
import type { LuaEnvironment } from '../../lua/environment';
import {
	buildLuaSources,
	resolveLuaSourceRecord,
	type LuaSourceMatch,
	type LuaSourceRegistry,
	DEFAULT_SYSTEM_PROJECT_ROOT_PATH,
} from '../../lua/source_registry';

export type RuntimeCartridgeSourceState = {
	rom: RuntimeRomLayer;
	package: RuntimeRomPackage;
	luaSources: LuaSourceRegistry;
	romSource: RawRomSource;
	projectRootPath: string;
	installedBlua32Sources: ReadonlyMap<string, string>;
};

export type RuntimeSourceState = {
	systemRom: RuntimeRomLayer;
	cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null];
	systemPackage: RuntimeRomPackage;
	activePackage: RuntimeRomPackage;
	systemLuaSources: LuaSourceRegistry;
	activeLuaSources: LuaSourceRegistry;
	luaSourceRegistries: LuaSourceRegistry[];
	luaSourceSearchRegistries: LuaSourceRegistry[];
	moduleCompileLuaSources: LuaSourceRegistry[];
	systemRomSource: RawRomSource;
	activeRomSource: RawRomSource;
	systemProjectRootPath: string;
	currentPath: string;
	activeCartridgeSlot: number;
	realtimeCompileOptLevel: 0 | 1 | 2 | 3;
	systemBlua32MediaDirty: boolean;
	cartridgeBlua32MediaDirty: [boolean, boolean];
	luaChunkEnvironmentsByPath: Map<string, LuaEnvironment>;
	systemInstalledBlua32Sources: ReadonlyMap<string, string>;
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
	cartridgeLayers: [RuntimeRomLayer | null, RuntimeRomLayer | null],
): RuntimeSourceState {
	const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
	const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, ['system']);
	const luaSourceRegistries: LuaSourceRegistry[] = [];
	const luaSourceSearchRegistries: LuaSourceRegistry[] = [];
	const moduleCompileLuaSources: LuaSourceRegistry[] = [];
	const systemProjectRootPath = systemLuaSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
	const cartridgeSlots: [RuntimeCartridgeSourceState | null, RuntimeCartridgeSourceState | null] = [null, null];
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
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
			rom: cartLayer,
			package: cartLayer.package,
			luaSources: cartLuaSources,
			romSource: cartRomSource,
			projectRootPath: cartLayer.index.projectRootPath,
			installedBlua32Sources: indexInstalledBlua32Sources(cartLuaSources),
		};
	}
	const state: RuntimeSourceState = {
		systemRom: systemLayer,
		cartridgeSlots,
		systemPackage: systemLayer.package,
		activePackage: systemLayer.package,
		systemLuaSources,
		activeLuaSources: systemLuaSources,
		luaSourceRegistries,
		luaSourceSearchRegistries,
		moduleCompileLuaSources,
		systemRomSource: systemSource,
		activeRomSource: systemSource,
		systemProjectRootPath,
		currentPath: systemLuaSources.entry_path,
		activeCartridgeSlot: -1,
		realtimeCompileOptLevel: 3,
		systemBlua32MediaDirty: false,
		cartridgeBlua32MediaDirty: [false, false],
		luaChunkEnvironmentsByPath: new Map(),
		systemInstalledBlua32Sources: indexInstalledBlua32Sources(systemLuaSources),
	};
	enterSystemSources(state);
	return state;
}

export function enterSystemSources(state: RuntimeSourceState): void {
	state.activeCartridgeSlot = -1;
	state.activePackage = state.systemPackage;
	state.activeLuaSources = state.systemLuaSources;
	state.activeRomSource = state.systemRomSource;
	state.currentPath = state.activeLuaSources.entry_path;
	rebuildLuaSourceOrders(state);
}

export function enterCartridgeSources(state: RuntimeSourceState, slot: number): void {
	const cartridge = state.cartridgeSlots[slot]!;
	state.activeCartridgeSlot = slot;
	state.activePackage = cartridge.package;
	state.activeLuaSources = cartridge.luaSources;
	state.activeRomSource = cartridge.romSource;
	state.currentPath = state.activeLuaSources.entry_path;
	rebuildLuaSourceOrders(state);
}

export function syncRuntimeSourceActivity(state: RuntimeSourceState, cartridgeSlot: number): void {
	if (state.activeCartridgeSlot === cartridgeSlot) {
		return;
	}
	if (cartridgeSlot >= 0) {
		enterCartridgeSources(state, cartridgeSlot);
		return;
	}
	enterSystemSources(state);
}

export function developmentCartridgeSource(state: RuntimeSourceState): RuntimeCartridgeSourceState | null {
	if (state.activeCartridgeSlot >= 0) {
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
	state.activeRomSource = state.activeCartridgeSlot < 0
		? state.systemRomSource
		: state.cartridgeSlots[state.activeCartridgeSlot]!.romSource;
}

export function resolveRuntimeLuaSource(state: RuntimeSourceState, path: string): LuaSourceMatch | null {
	for (let index = 0; index < state.luaSourceSearchRegistries.length; index += 1) {
		const registry = state.luaSourceSearchRegistries[index];
		const record = resolveLuaSourceRecord(registry, path);
		if (record) {
			return { registry, record };
		}
	}
	return null;
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

	state.luaSourceSearchRegistries.length = 0;
	state.luaSourceSearchRegistries.push(state.activeLuaSources);
	for (let slot = 0; slot < state.cartridgeSlots.length; slot += 1) {
		const cartridge = state.cartridgeSlots[slot];
		if (cartridge !== null && cartridge.luaSources !== state.activeLuaSources) {
			state.luaSourceSearchRegistries.push(cartridge.luaSources);
		}
	}
	if (state.systemLuaSources !== state.activeLuaSources) {
		state.luaSourceSearchRegistries.push(state.systemLuaSources);
	}

	state.moduleCompileLuaSources.length = 0;
	state.moduleCompileLuaSources.push(state.activeLuaSources);
	if (state.systemLuaSources !== state.activeLuaSources) {
		state.moduleCompileLuaSources.push(state.systemLuaSources);
	}
}
