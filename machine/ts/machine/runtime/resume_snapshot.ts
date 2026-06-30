import type { LuaValue } from '../../lua/value';
import { convertToError, isLuaFunctionValue, isLuaTable } from '../../lua/value';
import type { LuaEntrySnapshot } from './host/native_bridge';
import type { Runtime } from './runtime';
import { captureRuntimeMachineState, type RuntimeMachineState } from './machine_state';


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
	'load',
	'loadstring',
	'dofile',
	'select',
	'debug',
]);

export function captureRuntimeResumeSnapshot(runtime: Runtime): RuntimeResumeSnapshot {
	const luaSnapshot = captureRuntimeLuaSnapshot(runtime);
	const snapshot: RuntimeResumeSnapshot = {
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		luaPath: runtime.currentPath,
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

function captureRuntimeLuaSnapshot(runtime: Runtime): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; programCounter?: number } {
	const interpreter = runtime.interpreter;
	const globals = captureLuaEntryCollection(runtime, interpreter.enumerateGlobalEntries());
	const locals = captureLuaEntryCollection(runtime, interpreter.enumerateChunkEntries());
	return {
		globals,
		locals,
		programCounter: interpreter.programCounter,
	};
}

function captureLuaEntryCollection(runtime: Runtime, entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
	if (!entries || entries.length === 0) {
		return null;
	}
	const ctx = runtime.luaJsBridge.createLuaSnapshotContext();
	const snapshotRoot: Record<string, unknown> = {};
	let count = 0;
	for (const [name, value] of entries) {
		if (shouldSkipLuaResumeSnapshotEntry(runtime, name, value)) {
			continue;
		}
		try {
			snapshotRoot[name] = runtime.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
			count += 1;
		}
		catch (error) {
			throw new Error(`Resume snapshot fault: failed to serialize Lua entry '${name}': ${convertToError(error).message}`);
		}
	}
	return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
}

function shouldSkipLuaResumeSnapshotEntry(runtime: Runtime, name: string, value: LuaValue): boolean {
	if (!name || runtime.apiFunctionNames.has(name)) {
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

export function restoreRuntimeLuaSnapshot(runtime: Runtime, snapshot: RuntimeResumeSnapshot): void {
	const interpreter = runtime.interpreter;
	if (snapshot.luaProgramCounter !== undefined) {
		interpreter.programCounter = snapshot.luaProgramCounter;
	}
	if (snapshot.luaGlobals) {
		restoreLuaGlobals(runtime, snapshot.luaGlobals);
	}
	if (snapshot.luaLocals) {
		restoreLuaLocals(runtime, snapshot.luaLocals);
	}
}

function restoreLuaGlobals(runtime: Runtime, globals: LuaEntrySnapshot): void {
	const interpreter = runtime.interpreter;
	const entries = runtime.luaJsBridge.materializeLuaEntrySnapshot(globals);
	for (const [name, value] of entries) {
		if (!name || runtime.apiFunctionNames.has(name) || LUA_RESUME_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			continue;
		}
		const existing = interpreter.getGlobal(name);
		if (isLuaTable(existing) && isLuaTable(value)) {
			runtime.luaJsBridge.applyLuaTableSnapshot(existing, value);
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

function restoreLuaLocals(runtime: Runtime, locals: LuaEntrySnapshot): void {
	const interpreter = runtime.interpreter;
	const entries = runtime.luaJsBridge.materializeLuaEntrySnapshot(locals);
	for (const [name, value] of entries) {
		if (!name || !interpreter.hasChunkBinding(name)) {
			continue;
		}
		const env = interpreter.pathEnvironment;
		if (env) {
			const current = env.get(name);
			if (isLuaTable(current) && isLuaTable(value)) {
				runtime.luaJsBridge.applyLuaTableSnapshot(current, value);
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
