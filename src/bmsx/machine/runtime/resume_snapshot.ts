import type { LuaValue } from '../../lua/value';
import { convertToError, isLuaFunctionValue, isLuaTable } from '../../lua/value';
import type { LuaEntrySnapshot, RuntimeResumeSnapshot } from './contracts';
import { Runtime } from './runtime';
import { cloneGameViewState, copyGameViewState } from './game/view_state';
import { captureRuntimeMachineState } from './machine_state';
import { captureRuntimeRenderState } from '../../render/runtime_state';

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
	'wrap_text_lines',
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

function resumeSnapshotFault(message: string): Error {
	return new Error(`Resume snapshot fault: ${message}`);
}

export function captureRuntimeResumeSnapshot(): RuntimeResumeSnapshot {
	const runtime = Runtime.instance;
	const storageState = runtime.storage.dump();
	const luaSnapshot = captureRuntimeLuaSnapshot();
	const snapshot: RuntimeResumeSnapshot = {
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		luaPath: runtime.currentPath,
		storageState,
		gameViewState: cloneGameViewState(runtime.gameViewState),
		renderState: captureRuntimeRenderState(),
		machineState: captureRuntimeMachineState(),
	};
	if (luaSnapshot) {
		if (luaSnapshot.globals) {
			snapshot.luaGlobals = luaSnapshot.globals;
		}
		if (luaSnapshot.locals) {
			snapshot.luaLocals = luaSnapshot.locals;
		}
		if (luaSnapshot.randomSeed !== undefined) {
			snapshot.luaRandomSeed = luaSnapshot.randomSeed;
		}
		if (luaSnapshot.programCounter !== undefined) {
			snapshot.luaProgramCounter = luaSnapshot.programCounter;
		}
	}
	return snapshot;
}

function captureRuntimeLuaSnapshot(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number; programCounter?: number } {
	const runtime = Runtime.instance;
	const interpreter = runtime.interpreter;
	const globals = captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
	const locals = captureLuaEntryCollection(interpreter.enumerateChunkEntries());
	return {
		globals,
		locals,
		randomSeed: runtime.randomSeedValue,
		programCounter: interpreter.programCounter,
	};
}

function captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
	if (!entries || entries.length === 0) {
		return null;
	}
	const runtime = Runtime.instance;
	const ctx = runtime.luaJsBridge.createLuaSnapshotContext();
	const snapshotRoot: Record<string, unknown> = {};
	let count = 0;
	for (const [name, value] of entries) {
		if (shouldSkipLuaResumeSnapshotEntry(name, value)) {
			continue;
		}
		try {
			snapshotRoot[name] = runtime.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
			count += 1;
		}
		catch (error) {
			throw resumeSnapshotFault(`failed to serialize Lua entry '${name}': ${convertToError(error).message}`);
		}
	}
	return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
}

function shouldSkipLuaResumeSnapshotEntry(name: string, value: LuaValue): boolean {
	const runtime = Runtime.instance;
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

export function restoreRuntimeLuaSnapshot(snapshot: RuntimeResumeSnapshot): void {
	const runtime = Runtime.instance;
	const interpreter = runtime.interpreter;
	copyGameViewState(runtime.gameViewState, snapshot.gameViewState);
	if (snapshot.luaRandomSeed !== undefined) {
		runtime.randomSeedValue = snapshot.luaRandomSeed;
	}
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
	const runtime = Runtime.instance;
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
			throw resumeSnapshotFault(`failed to restore Lua global '${name}': ${convertToError(error).message}`);
		}
	}
}

function restoreLuaLocals(locals: LuaEntrySnapshot): void {
	const runtime = Runtime.instance;
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
			throw resumeSnapshotFault(`failed to restore Lua local '${name}': ${convertToError(error).message}`);
		}
	}
}
