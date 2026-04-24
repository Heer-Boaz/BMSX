import { engineCore } from '../../../core/engine';
import { Table, createNativeFunction } from '../../cpu/cpu';

import type { StringValue } from '../../memory/string/pool';
import type { Runtime } from '../runtime';

type GameTableKeys = {
	game: StringValue;
	platform: StringValue;
	clock: StringValue;
	now: StringValue;
	perf_now: StringValue;
	viewportsize: StringValue;
	view: StringValue;
	x: StringValue;
	y: StringValue;
	emit: StringValue;
	get_frame_delta_ms: StringValue;
	get_action_state: StringValue;
	crt_postprocessing_enabled: StringValue;
	enable_noise: StringValue;
	enable_colorbleed: StringValue;
	enable_scanlines: StringValue;
	enable_blur: StringValue;
	enable_glow: StringValue;
	enable_fringing: StringValue;
	enable_aperture: StringValue;
};

const gameTableKeysByRuntime = new WeakMap<Runtime, GameTableKeys>();

function getGameTableKeys(runtime: Runtime): GameTableKeys {
	let keys = gameTableKeysByRuntime.get(runtime);
	if (keys) {
		return keys;
	}
	keys = {
		game: runtime.luaKey('game'),
		platform: runtime.luaKey('platform'),
		clock: runtime.luaKey('clock'),
		now: runtime.luaKey('now'),
		perf_now: runtime.luaKey('perf_now'),
		viewportsize: runtime.luaKey('viewportsize'),
		view: runtime.luaKey('view'),
		x: runtime.luaKey('x'),
		y: runtime.luaKey('y'),
		emit: runtime.luaKey('emit'),
		get_frame_delta_ms: runtime.luaKey('get_frame_delta_ms'),
		get_action_state: runtime.luaKey('get_action_state'),
		crt_postprocessing_enabled: runtime.luaKey('crt_postprocessing_enabled'),
		enable_noise: runtime.luaKey('enable_noise'),
		enable_colorbleed: runtime.luaKey('enable_colorbleed'),
		enable_scanlines: runtime.luaKey('enable_scanlines'),
		enable_blur: runtime.luaKey('enable_blur'),
		enable_glow: runtime.luaKey('enable_glow'),
		enable_fringing: runtime.luaKey('enable_fringing'),
		enable_aperture: runtime.luaKey('enable_aperture'),
	};
	gameTableKeysByRuntime.set(runtime, keys);
	return keys;
}

function writeRuntimeViewportTable(runtime: Runtime, table: Table): void {
	const keys = getGameTableKeys(runtime);
	const { viewportSize } = runtime.gameViewState;
	table.set(keys.x, viewportSize.x);
	table.set(keys.y, viewportSize.y);
}

function writeRuntimeViewTable(runtime: Runtime, table: Table): void {
	const keys = getGameTableKeys(runtime);
	const state = runtime.gameViewState;
	table.set(keys.crt_postprocessing_enabled, state.crt_postprocessing_enabled);
	table.set(keys.enable_noise, state.enable_noise);
	table.set(keys.enable_colorbleed, state.enable_colorbleed);
	table.set(keys.enable_scanlines, state.enable_scanlines);
	table.set(keys.enable_blur, state.enable_blur);
	table.set(keys.enable_glow, state.enable_glow);
	table.set(keys.enable_fringing, state.enable_fringing);
	table.set(keys.enable_aperture, state.enable_aperture);
}

function getRuntimeGameTable(runtime: Runtime): Table {
	return runtime.machine.cpu.getGlobalByKey(getGameTableKeys(runtime).game) as Table;
}

function getRuntimeViewportTable(runtime: Runtime): Table {
	return getRuntimeGameTable(runtime).get(getGameTableKeys(runtime).viewportsize) as Table;
}

function getRuntimeViewTable(runtime: Runtime): Table {
	return getRuntimeGameTable(runtime).get(getGameTableKeys(runtime).view) as Table;
}

function readRuntimeViewBool(runtime: Runtime, table: Table, key: StringValue, field: string): boolean {
	const value = table.get(key);
	if (typeof value !== 'boolean') {
		throw runtime.createApiRuntimeError(`game.view.${field} must be boolean.`);
	}
	return value;
}

export function createRuntimeGameTable(runtime: Runtime): Table {
	const keys = getGameTableKeys(runtime);
	const viewportTable = new Table(0, 2);
	writeRuntimeViewportTable(runtime, viewportTable);
	const viewTable = new Table(0, 8);
	writeRuntimeViewTable(runtime, viewTable);

	const clockNowFn = createNativeFunction('platform.clock.now', (_args, out) => {
		out.push(engineCore.platform.clock.now());
	});
	const clockPerfNowFn = createNativeFunction('platform.clock.perf_now', (_args, out) => {
		out.push(engineCore.platform.clock.perf_now());
	});
	const clockTable = new Table(0, 2);
	clockTable.set(keys.now, clockNowFn);
	clockTable.set(keys.perf_now, clockPerfNowFn);

	const platformTable = new Table(0, 1);
	platformTable.set(keys.clock, clockTable);

	const emitFn = createNativeFunction('game.emit', () => {
	});
	const getFrameDeltaMsFn = createNativeFunction('game.get_frame_delta_ms', (_args, out) => {
		out.push(runtime.frameLoop.frameDeltaMs);
	});
	const getActionStateFn = createNativeFunction('game.get_action_state', (args, out) => {
		const playerOrAction = args[0] as number | StringValue;
		if (typeof playerOrAction === 'number') {
			const action = args[1] as StringValue;
			const windowFrames = args.length > 2 && args[2] !== null ? args[2] as number : undefined;
			out.push(engineCore.get_action_state(playerOrAction, action.text, windowFrames));
			return;
		}
		const windowFrames = args.length > 1 && args[1] !== null ? args[1] as number : undefined;
		out.push(engineCore.get_action_state(1, playerOrAction.text, windowFrames));
	});

	const gameTable = new Table(0, 6);
	gameTable.set(keys.platform, platformTable);
	gameTable.set(keys.viewportsize, viewportTable);
	gameTable.set(keys.view, viewTable);
	gameTable.set(keys.emit, emitFn);
	gameTable.set(keys.get_frame_delta_ms, getFrameDeltaMsFn);
	gameTable.set(keys.get_action_state, getActionStateFn);
	return gameTable;
}

export function syncRuntimeGameViewStateToTable(runtime: Runtime): void {
	if (!runtime.isInitialized) {
		return;
	}
	writeRuntimeViewportTable(runtime, getRuntimeViewportTable(runtime));
	writeRuntimeViewTable(runtime, getRuntimeViewTable(runtime));
}

export function applyRuntimeGameViewTableToState(runtime: Runtime): void {
	if (!runtime.isInitialized) {
		return;
	}
	const keys = getGameTableKeys(runtime);
	const table = getRuntimeViewTable(runtime);
	const state = runtime.gameViewState;
	state.crt_postprocessing_enabled = readRuntimeViewBool(runtime, table, keys.crt_postprocessing_enabled, 'crt_postprocessing_enabled');
	state.enable_noise = readRuntimeViewBool(runtime, table, keys.enable_noise, 'enable_noise');
	state.enable_colorbleed = readRuntimeViewBool(runtime, table, keys.enable_colorbleed, 'enable_colorbleed');
	state.enable_scanlines = readRuntimeViewBool(runtime, table, keys.enable_scanlines, 'enable_scanlines');
	state.enable_blur = readRuntimeViewBool(runtime, table, keys.enable_blur, 'enable_blur');
	state.enable_glow = readRuntimeViewBool(runtime, table, keys.enable_glow, 'enable_glow');
	state.enable_fringing = readRuntimeViewBool(runtime, table, keys.enable_fringing, 'enable_fringing');
	state.enable_aperture = readRuntimeViewBool(runtime, table, keys.enable_aperture, 'enable_aperture');
}
