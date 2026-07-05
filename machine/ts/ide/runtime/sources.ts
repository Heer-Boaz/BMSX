import type { RuntimeRomPackage } from '../../rompack/format';
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

export type RuntimeSourceState = {
	systemRom: RuntimeRomLayer;
	cartRom: RuntimeRomLayer | null;
	systemPackage: RuntimeRomPackage;
	cartPackage: RuntimeRomPackage | null;
	activePackage: RuntimeRomPackage;
	systemLuaSources: LuaSourceRegistry;
	cartLuaSources: LuaSourceRegistry | null;
	activeLuaSources: LuaSourceRegistry;
	luaSourceRegistries: LuaSourceRegistry[];
	luaSourceSearchRegistries: LuaSourceRegistry[];
	moduleCompileLuaSources: LuaSourceRegistry[];
	systemRomSource: RawRomSource;
	cartRomSource: RawRomSource | null;
	activeRomSource: RawRomSource;
	systemProjectRootPath: string;
	cartProjectRootPath: string | null;
	currentPath: string;
	cartProgramStarted: boolean;
	realtimeCompileOptLevel: 0 | 1 | 2 | 3;
	luaChunkEnvironmentsByPath: Map<string, LuaEnvironment>;
	luaGenericChunksExecuted: Set<string>;
};

export function createRuntimeSourceState(systemLayer: RuntimeRomLayer, cartLayer: RuntimeRomLayer | null): RuntimeSourceState {
	const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
	const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, ['system']);
	const luaSourceRegistries: LuaSourceRegistry[] = [];
	const luaSourceSearchRegistries: LuaSourceRegistry[] = [];
	const moduleCompileLuaSources: LuaSourceRegistry[] = [];
	if (cartLayer) {
		const activeSourceLayers: RomSourceLayer[] = [
			{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload },
			{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload },
		];
		const activeRomSource = new RomSourceStack(activeSourceLayers);
		const cartRomSource = new RomSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const state: RuntimeSourceState = {
			systemRom: systemLayer,
			cartRom: cartLayer,
			systemPackage: systemLayer.package,
			cartPackage: cartLayer.package,
			activePackage: systemLayer.package,
			systemLuaSources,
			cartLuaSources: buildLuaSources(cartRomSource, activeRomSource, cartLayer.index, ['cart']),
			activeLuaSources: systemLuaSources,
			luaSourceRegistries,
			luaSourceSearchRegistries,
			moduleCompileLuaSources,
			systemRomSource: systemSource,
			cartRomSource,
			activeRomSource: systemSource,
			systemProjectRootPath: systemLuaSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH,
			cartProjectRootPath: cartLayer.index.projectRootPath,
			currentPath: systemLuaSources.entry_path,
			cartProgramStarted: false,
			realtimeCompileOptLevel: 3,
			luaChunkEnvironmentsByPath: new Map(),
			luaGenericChunksExecuted: new Set(),
		};
		enterSystemSources(state);
		return state;
	}
	const state: RuntimeSourceState = {
		systemRom: systemLayer,
		cartRom: null,
		systemPackage: systemLayer.package,
		cartPackage: null,
		activePackage: systemLayer.package,
		systemLuaSources,
		cartLuaSources: null,
		activeLuaSources: systemLuaSources,
		luaSourceRegistries,
		luaSourceSearchRegistries,
		moduleCompileLuaSources,
		systemRomSource: systemSource,
		cartRomSource: null,
		activeRomSource: systemSource,
		systemProjectRootPath: systemLuaSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH,
		cartProjectRootPath: null,
		currentPath: systemLuaSources.entry_path,
		cartProgramStarted: false,
		realtimeCompileOptLevel: 3,
		luaChunkEnvironmentsByPath: new Map(),
		luaGenericChunksExecuted: new Set(),
	};
	enterSystemSources(state);
	return state;
}

export function enterSystemSources(state: RuntimeSourceState): void {
	state.cartProgramStarted = false;
	state.activePackage = state.systemPackage;
	state.activeLuaSources = state.systemLuaSources;
	state.activeRomSource = state.systemRomSource;
	state.currentPath = state.activeLuaSources.entry_path;
	rebuildLuaSourceOrders(state);
}

export function enterCartSources(state: RuntimeSourceState): void {
	state.cartProgramStarted = true;
	state.activePackage = state.cartPackage!;
	state.activeLuaSources = state.cartLuaSources!;
	state.activeRomSource = state.cartRomSource!;
	state.currentPath = state.activeLuaSources.entry_path;
	rebuildLuaSourceOrders(state);
}

export function syncRuntimeSourceActivity(state: RuntimeSourceState, cartProgramStarted: boolean): void {
	if (state.cartProgramStarted === cartProgramStarted) {
		return;
	}
	if (cartProgramStarted) {
		enterCartSources(state);
		return;
	}
	enterSystemSources(state);
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
	if (state.cartLuaSources) {
		state.luaSourceRegistries.push(state.cartLuaSources);
	}
	state.luaSourceRegistries.push(state.systemLuaSources);

	state.luaSourceSearchRegistries.length = 0;
	state.luaSourceSearchRegistries.push(state.activeLuaSources);
	if (state.cartLuaSources && state.cartLuaSources !== state.activeLuaSources) {
		state.luaSourceSearchRegistries.push(state.cartLuaSources);
	}
	if (state.systemLuaSources !== state.activeLuaSources && state.systemLuaSources !== state.cartLuaSources) {
		state.luaSourceSearchRegistries.push(state.systemLuaSources);
	}

	state.moduleCompileLuaSources.length = 0;
	state.moduleCompileLuaSources.push(state.activeLuaSources);
	if (state.systemLuaSources !== state.activeLuaSources) {
		state.moduleCompileLuaSources.push(state.systemLuaSources);
	}
}
