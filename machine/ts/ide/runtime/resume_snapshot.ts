import type { LuaValue } from '../../lua/value';
import { convertToError, isLuaFunctionValue, isLuaTable } from '../../lua/value';
import type { LuaEntrySnapshot } from './native_bridge';
import type { Runtime } from '../../machine/runtime/runtime';
import { captureRuntimeMachineState, type RuntimeMachineState } from '../../machine/runtime/machine_state';
import { luaInterpreterApiFunctionNames } from './lua_builtins';
import { machineManager } from '../../core/machine_manager';


export type RuntimeResumeSnapshot = {
	luaRuntimeFailed: boolean;
	luaPath: string;
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaProgramCounter?: number;
	machineState: RuntimeMachineState;
};

const LUA_RESUME_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>([
	'print',
	'type',
	'tostring',
	'tonumber',
	'setmetatable',
	'getmetatable',
	'require',
	'pairs',
	'ipairs',
	'serialize',
	'deserialize',
	'math',
	'easing',
	'table',
	'string',
	'coroutine',
	'debug',
	'utf8',
	'_VERSION',
	'assert',
	'error',
	'next',
	'rawget',
	'rawset',
	'rawequal',
	'pcall',
	'xpcall',
	'collectgarbage',
	'dofile',
	'select',
	'debug',
]);

export function captureRuntimeResumeSnapshot(runtime: Runtime): RuntimeResumeSnapshot {
	const luaSnapshot = captureRuntimeLuaSnapshot();
	const snapshot: RuntimeResumeSnapshot = {
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		luaPath: machineManager.sourceState.currentPath,
		machineState: captureRuntimeMachineState(runtime),
	};
	if (luaSnapshot) {
		if (luaSnapshot.globals) {
			snapshot.luaGlobals = luaSnapshot.globals;
		}
		if (luaSnapshot.locals) {
			snapshot.luaLocals = luaSnapshot.locals;
		}
		if (luaSnapshot.programCounter !== undefined) {
			snapshot.luaProgramCounter = luaSnapshot.programCounter;
		}
	}
	return snapshot;
}

function captureRuntimeLuaSnapshot(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; programCounter?: number } {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	const globals = captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
	const locals = captureLuaEntryCollection(interpreter.enumerateChunkEntries());
	return {
		globals,
		locals,
		programCounter: interpreter.programCounter,
	};
}

function captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
	if (!entries || entries.length === 0) {
		return null;
	}
	const bridge = machineManager.ideState.nativeBridge;
	const ctx = bridge.luaJsBridge.createLuaSnapshotContext();
	const snapshotRoot: Record<string, unknown> = {};
	let count = 0;
	for (const [name, value] of entries) {
		if (shouldSkipLuaResumeSnapshotEntry(name, value)) {
			continue;
		}
		try {
			snapshotRoot[name] = bridge.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
			count += 1;
		}
		catch (error) {
			throw new Error(`Resume snapshot fault: failed to serialize Lua entry '${name}': ${convertToError(error).message}`);
		}
	}
	return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
}

function shouldSkipLuaResumeSnapshotEntry(name: string, value: LuaValue): boolean {
	if (!name || luaInterpreterApiFunctionNames.has(name)) {
		return true;
	}
	if (LUA_RESUME_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
		return true;
	}
	if (isLuaFunctionValue(value)) {
		return true;
	}
	return false;
}

export function restoreRuntimeLuaSnapshot(snapshot: RuntimeResumeSnapshot): void {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	if (snapshot.luaProgramCounter !== undefined) {
		interpreter.programCounter = snapshot.luaProgramCounter;
	}
	if (snapshot.luaGlobals) {
		restoreLuaGlobals(snapshot.luaGlobals);
	}
	if (snapshot.luaLocals) {
		restoreLuaLocals(snapshot.luaLocals);
	}
}

function restoreLuaGlobals(globals: LuaEntrySnapshot): void {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	const bridge = machineManager.ideState.nativeBridge;
	const entries = bridge.luaJsBridge.materializeLuaEntrySnapshot(globals);
	for (const [name, value] of entries) {
		if (!name || luaInterpreterApiFunctionNames.has(name) || LUA_RESUME_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			continue;
		}
		const existing = interpreter.getGlobal(name);
		if (isLuaTable(existing) && isLuaTable(value)) {
			bridge.luaJsBridge.applyLuaTableSnapshot(existing, value);
			continue;
		}
		try {
			interpreter.setGlobal(name, value);
		}
		catch (error) {
			throw new Error(`Resume snapshot fault: failed to restore Lua global '${name}': ${convertToError(error).message}`);
		}
	}
}

function restoreLuaLocals(locals: LuaEntrySnapshot): void {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	const bridge = machineManager.ideState.nativeBridge;
	const entries = bridge.luaJsBridge.materializeLuaEntrySnapshot(locals);
	for (const [name, value] of entries) {
		if (!name || !interpreter.hasChunkBinding(name)) {
			continue;
		}
		const env = interpreter.pathEnvironment;
		if (env) {
			const current = env.get(name);
			if (isLuaTable(current) && isLuaTable(value)) {
				bridge.luaJsBridge.applyLuaTableSnapshot(current, value);
				continue;
			}
		}
		try {
			interpreter.assignChunkValue(name, value);
		}
		catch (error) {
			throw new Error(`Resume snapshot fault: failed to restore Lua local '${name}': ${convertToError(error).message}`);
		}
	}
}
