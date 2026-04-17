import { $ } from '../../core/engine_core';
import type { LuaChunk } from '../../lua/syntax/lua_ast';
import { LuaInterpreter } from '../../lua/luaruntime';
import type { LuaValue } from '../../lua/luavalue';
import { convertToError, isLuaFunctionValue, isLuaTable, setLuaTableCaseInsensitiveKeys } from '../../lua/luavalue';
import { publishOverlayFrame } from '../../render/editor/editor_overlay_queue';
import { clearNativeMemberCompletionCache } from '../editor/contrib/intellisense/intellisense';
import { ENGINE_LUA_BUILTIN_FUNCTIONS, ENGINE_LUA_BUILTIN_GLOBALS } from '../../machine/firmware/lua_builtin_descriptors';
import { seedLuaGlobals } from '../../machine/firmware/lua_globals';
import { ENGINE_SYSTEM_HELPER_NAMES } from '../../machine/firmware/lua_system_globals';
import { LuaEntrySnapshot } from '../../machine/firmware/lua_js_bridge';
import { compileLuaChunkToProgram, appendLuaChunkToProgram } from '../../machine/program/program_compiler';
import { linkProgramAssets } from '../../machine/program/program_linker';
import { getWorkspaceCachedSource } from '../workspace/workspace_cache';
import type { RuntimeState, SymbolEntry, SymbolKind } from '../../machine/runtime/types';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/program/lua_sources';
import { logDebugState } from '../../machine/runtime/runtime_debug';
import { addTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import * as runtimeIde from './runtime_ide';
import { calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from '../../machine/runtime/runtime_timing';
import {
	buildModuleAliasMap,
	buildModuleAliasesFromPaths,
	buildModuleProtoMap,
	decodeProgramAsset,
	decodeProgramSymbolsAsset,
	inflateProgram,
	PROGRAM_ASSET_ID,
	PROGRAM_SYMBOLS_ASSET_ID,
	type ProgramAsset,
	type ProgramSymbolsAsset,
} from '../../machine/program/program_asset';
import { INSTRUCTION_BYTES } from '../../machine/cpu/instruction_format';
import {
	IRQ_NEWGAME,
	IRQ_REINIT,
} from '../../machine/bus/io';
import { CanonicalizationType, getMachinePerfSpecs } from '../../rompack/rompack';
import type { RawAssetSource } from '../../rompack/asset_source';
import { Table, type Closure, type Program, type ProgramMetadata, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { StringValue, isStringValue, stringValueToString } from '../../machine/memory/string_pool';
import { Runtime } from '../../machine/runtime/runtime';
import { getSourceForChunk } from '../editor/common/text_runtime';

const LUA_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>([
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

const ENGINE_BUILTIN_PRELUDE_PATH = '__engine_builtin_prelude__';
const getRealtimeOptLevel = (runtime: Runtime): 0 | 1 | 2 | 3 =>
	runtime.realtimeCompileOptLevel;
const REQUIRED_ENGINE_SYSTEM_HELPERS: ReadonlyArray<string> = ['clock_now'];

function runtimeFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function snapshotFault(message: string): Error {
	return new Error(`Snapshot fault: ${message}`);
}

function resolvePositiveSafeInteger(value: number | undefined, label: string): number {
	if (value === undefined) {
		throw runtimeFault(`${label} is required.`);
	}
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw runtimeFault(`${label} must be a positive safe integer.`);
	}
	return value;
}

function resolveCpuHz(value: number | undefined): number {
	return resolvePositiveSafeInteger(value, 'machine.specs.cpu.cpu_freq_hz');
}

function applyUfpsScaled(ufps: number): number {
	const ufpsScaled = resolveUfpsScaled(ufps);
	Runtime.instance.timing.applyUfpsScaled(ufpsScaled);
	return ufpsScaled;
}

function resolveRenderHeight(value: number | undefined): number {
	const renderHeight = resolvePositiveSafeInteger(value, 'machine.render_size.height');
	if (renderHeight <= 0) {
		throw runtimeFault('machine.render_size.height must be a positive integer.');
	}
	return renderHeight;
}

type RuntimeAssetReloadMode = 'full' | 'cart';
type RuntimeMachineSource = 'system' | 'cart';

interface RuntimeAssetReloadPlan {
	mode: RuntimeAssetReloadMode;
	machineSource: RuntimeMachineSource;
	sealSystemAssets: boolean;
	resetFreshWorldOptions: { preserve_textures: boolean };
}

function buildRuntimeAssetReloadPlan(runtime: Runtime): RuntimeAssetReloadPlan {
	if (runtime.cartAssetLayer) {
		return {
			mode: 'cart',
			machineSource: 'cart',
			sealSystemAssets: false,
			resetFreshWorldOptions: { preserve_textures: true },
		};
	}
	return {
		mode: 'full',
		machineSource: 'system',
		sealSystemAssets: true,
		resetFreshWorldOptions: { preserve_textures: false },
	};
}

function resolveRuntimeMachineForPlan(runtime: Runtime, plan: RuntimeAssetReloadPlan) {
	if (plan.machineSource === 'cart') {
		return runtime.cartAssetLayer.index.machine;
	}
	return $.engine_layer.index.machine;
}

export function captureCurrentState(runtime: Runtime): RuntimeState {
	const storage = runtime.storage.dump();
	const stateSnapshot = captureRuntimeState(runtime);
	const atlasSlots = runtime.machine.vdp.atlasSlotMapping;
	const skyboxFaceIds = runtime.machine.vdp.skyboxFaceIds;
	const vdpDitherType = runtime.machine.vdp.ditherType;
	const vblankState = runtime.captureVblankState();
	const state: RuntimeState = {
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		luaPath: runtime.currentPath,
		storage,
		atlasSlots,
		skyboxFaceIds,
		vdpDitherType,
		cyclesIntoFrame: vblankState.cyclesIntoFrame,
		inputSampleArmed: vblankState.inputSampleArmed,
	};
	if (stateSnapshot) {
		if (stateSnapshot.globals) {
			state.luaGlobals = stateSnapshot.globals;
		}
		if (stateSnapshot.locals) {
			state.luaLocals = stateSnapshot.locals;
		}
		if (stateSnapshot.randomSeed !== undefined) {
			state.luaRandomSeed = stateSnapshot.randomSeed;
		}
		if (stateSnapshot.programCounter !== undefined) {
			state.luaProgramCounter = stateSnapshot.programCounter;
		}
	}
	return state;
}

export function applyAssetMemorySnapshot(runtime: Runtime, snapshot: RuntimeState): void {
	if (snapshot.assetMemory) {
		runtime.machine.memory.restoreAssetMemory(snapshot.assetMemory);
		runtime.machine.memory.rehydrateAssetEntriesFromTable();
	}
	if (snapshot.atlasSlots) {
		runtime.machine.vdp.restoreAtlasSlotMapping(snapshot.atlasSlots);
	}
	if (snapshot.skyboxFaceIds !== undefined) {
		if (snapshot.skyboxFaceIds === null) {
			runtime.machine.vdp.clearSkybox();
		} else {
			runtime.machine.vdp.setSkyboxImages(snapshot.skyboxFaceIds);
		}
	}
	if (snapshot.vdpDitherType !== undefined) {
		runtime.machine.vdp.ditherType = snapshot.vdpDitherType;
	}
	runtime.machine.vdp.flushAssetEdits();
	runtime.machine.vdp.commitLiveVisualState();
	runtime.machine.vdp.commitViewSnapshot();
}

export async function resumeFromSnapshot(runtime: Runtime, state: RuntimeState, options?: { preserveEngineModules?: boolean }): Promise<void> {
	runtimeIde.clearActiveDebuggerPause(runtime);
	if (!state) {
		runtime.luaRuntimeFailed = false;
		throw runtimeFault('cannot resume from invalid state snapshot.');
	}
	const snapshot: RuntimeState = { ...state, luaRuntimeFailed: false };
	runtime.interpreter.clearLastFaultEnvironment();
	runtimeIde.clearFaultSnapshot(runtime);

	runtime.handledLuaErrors = new WeakSet<object>();
	runtime.luaRuntimeFailed = false;
	publishOverlayFrame(null);
	applyAssetMemorySnapshot(runtime, snapshot);
	resumeLuaProgramState(runtime, snapshot, options);
	runtime.restoreVblankState(snapshot);
	runtime.resetRenderBuffers();
	runtime.luaInitialized = true;
}

export function hotResumeProgramEntry(runtime: Runtime, params: { path: string; source: string; preserveEngineModules?: boolean }): void {
	const preserveRuntimeFailure = runtime.luaRuntimeFailed || (runtime.pauseCoordinator.hasSuspension() && runtime.pauseCoordinator.getPendingException() !== null);
	const binding = params.path;
	const baseMetadata = runtime.programMetadata;
	if (!baseMetadata) {
		throw runtimeFault('hot reload requires program symbols.');
	}
	const interpreter = runtime.interpreter;
	interpreter.clearLastFaultEnvironment();
	const chunk = interpreter.compileChunk(params.source, binding);
	const { modules, modulePaths } = buildModuleChunks(runtime, binding);
	const baseProgram = runtime.machine.cpu.getProgram();
	if (!baseProgram) {
		throw runtimeFault('hot reload requires active program.');
	}
	const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, {
		baseProgram,
		baseMetadata,
		canonicalization: runtime.canonicalization,
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: params.source,
	});
	runtime.moduleProtos.clear();
	for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
		runtime.moduleProtos.set(modulePath, protoIndex);
	}
	runtime.moduleAliases.clear();
	for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
		runtime.moduleAliases.set(entry.alias, entry.path);
	}
	if (params.preserveEngineModules) {
		clearCartModuleCacheForHotResume(runtime);
	} else {
		runtime.moduleCache.clear();
	}
	runtime.machine.vdp.resetIngressState();
	const prelude = runEngineBuiltinPrelude(runtime, program, metadata);
	const finalizedMetadata = prelude.metadata;
	beginEntryExecution(runtime, entryProtoIndex);
	runtime.luaRuntimeFailed = preserveRuntimeFailure;
	runtime._luaPath = binding;
	runtime.programMetadata = finalizedMetadata;
	runtime.luaInitialized = true;
	clearNativeMemberCompletionCache();
	runtimeIde.clearEditorErrorOverlaysIfNoFault(runtime);
}

export function clearCartModuleCacheForHotResume(runtime: Runtime): void {
	for (const path of Array.from(runtime.moduleCache.keys())) {
		if (!runtime.engineLuaSources.path2lua[path]) {
			runtime.moduleCache.delete(path);
		}
	}
}

export function beginEntryExecution(runtime: Runtime, entryProtoIndex: number): void {
	resetFrameState(runtime);
	runtime.machine.cpu.start(entryProtoIndex);
	runtime.pendingCall = 'entry';
}

export function queueLifecycleHandlers(runtime: Runtime, options: { runInit: boolean; runNewGame: boolean }): void {
	let irqMask = 0;
	if (options.runInit) {
		irqMask |= IRQ_REINIT;
	}
	if (options.runNewGame) {
		irqMask |= IRQ_NEWGAME;
	}
	if (irqMask !== 0) {
		runtime.raiseEngineIrq(irqMask);
	}
}

export function reloadLuaProgramState(runtime: Runtime, options: { runInit?: boolean; }): void {
	const runInit = options.runInit !== false;
	let binding = $.lua_sources.path2lua[$.lua_sources.entry_path] as any;
	if (!binding) {
		console.info('No Lua entry point defined; cannot reload program. Please save the entry point and try again.');
		return;
	}
	runtime._luaPath = binding.source_path;
	if (!runtime.interpreter) {
		if (!bootLuaProgram(runtime)) {
			console.info('Lua boot failed.');
			return;
		}
	}
	else {
		hotResumeProgramEntry(runtime, { source: getSourceForChunk(binding.source_path), path: binding.source_path });
		if (runInit) {
			queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
		}
	}
	runtime.luaInitialized = true;
}

export function resumeLuaProgramState(runtime: Runtime, snapshot: RuntimeState, options?: { preserveEngineModules?: boolean }): void {
	const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
	const binding = snapshot.luaPath;
	let source: string;
	try {
		source = resourceSourceForChunk(runtime, binding);
	}
	catch (error) {
		throw convertToError(error);
	}
	runtime._luaPath = binding;
	try {
		const preserveEngineModules = options?.preserveEngineModules ?? !runtime.isEngineProgramActive();
		hotResumeProgramEntry(runtime, { source, path: binding, preserveEngineModules });
	}
	catch (error) {
		runtimeIde.handleLuaError(runtime, error);
		throw convertToError(error);
	}
	refreshLuaModulesOnResume(runtime, binding);
	clearNativeMemberCompletionCache();
	queueLifecycleHandlers(runtime, { runInit: true, runNewGame: false });
	restoreRuntimeState(runtime, snapshot);
	if (savedRuntimeFailed) {
		runtime.luaRuntimeFailed = true;
	}
}

export function refreshLuaModulesOnResume(runtime: Runtime, resumeModuleId: string): void {
	const paths = Object.keys($.lua_sources.path2lua);
	for (let index = 0; index < paths.length; index += 1) {
		const moduleId = paths[index];
		if (resumeModuleId && moduleId === resumeModuleId) {
			continue;
		}
		refreshLuaHandlersForChunk(runtime, moduleId);
	}
}

export function markSourceChunkAsDirty(runtime: Runtime, path: string): void {
	runtime.luaGenericChunksExecuted.delete(path);
}

export function captureRuntimeState(runtime: Runtime): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number; programCounter?: number } {
	const interpreter = runtime.interpreter;
	const globals = captureLuaEntryCollection(runtime, interpreter.enumerateGlobalEntries());
	const locals = captureLuaEntryCollection(runtime, interpreter.enumerateChunkEntries());
	const randomSeed = runtime.randomSeedValue;
	const programCounter = interpreter.programCounter;
	return {
		globals: globals,
		locals: locals,
		randomSeed: randomSeed,
		programCounter: programCounter,
	};
}

export function captureLuaEntryCollection(runtime: Runtime, entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
	if (!entries || entries.length === 0) {
		return null;
	}
	const ctx = runtime.luaJsBridge.createLuaSnapshotContext();
	const snapshotRoot: Record<string, unknown> = {};
	let count = 0;
	for (const [name, value] of entries) {
		if (shouldSkipLuaSnapshotEntry(runtime, name, value)) {
			continue;
		}
		try {
			const serialized = runtime.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
			snapshotRoot[name] = serialized;
			count += 1;
		}
		catch (error) {
			throw snapshotFault(`failed to serialize Lua entry '${name}': ${convertToError(error).message}`);
		}
	}
	return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
}

export function shouldSkipLuaSnapshotEntry(runtime: Runtime, name: string, value: LuaValue): boolean {
	if (!name || runtime.apiFunctionNames.has(name)) {
		return true;
	}
	if (LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
		return true;
	}
	if (isLuaFunctionValue(value)) {
		return true;
	}
	return false;
}

export function restoreRuntimeState(runtime: Runtime, snapshot: RuntimeState): void {
	const interpreter = runtime.interpreter;
	if (snapshot.luaRandomSeed !== undefined) {
		runtime.randomSeedValue = snapshot.luaRandomSeed;
	}
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

export function restoreLuaGlobals(runtime: Runtime, globals: LuaEntrySnapshot): void {
	const interpreter = runtime.interpreter;
	const entries = runtime.luaJsBridge.materializeLuaEntrySnapshot(globals);
	for (const [name, value] of entries) {
		if (!name || runtime.apiFunctionNames.has(name) || LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
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
			throw snapshotFault(`failed to restore Lua global '${name}': ${convertToError(error).message}`);
		}
	}
}

export function restoreLuaLocals(runtime: Runtime, locals: LuaEntrySnapshot): void {
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
			throw snapshotFault(`failed to restore Lua local '${name}': ${convertToError(error).message}`);
		}
	}
}

export function resetLuaInteroperabilityState(runtime: Runtime): void {
	runtime.luaGenericChunksExecuted.clear();
	runtime.handledLuaErrors = new WeakSet<object>();
	runtime.luaFunctionRedirectCache.clear();
	setLuaTableCaseInsensitiveKeys(runtime.canonicalization !== 'none');
}

export function resetRuntimeState(runtime: Runtime): void {
	resetFrameState(runtime);
	runtime.pendingCall = null;
	runtime.pendingCartBoot = false;
	resetHardwareState(runtime);
	runtime.machine.cpu.globals.clear();
	runtime.machine.cpu.clearGlobalSlots();
	resetTrackedLuaHeapBytes();
	addTrackedLuaHeapBytes(runtime.machine.cpu.globals.getTrackedHeapBytes());
	runtime.moduleCache.clear();
	runtime.moduleProtos.clear();
	seedGlobals(runtime);
}

export function resetFrameState(runtime: Runtime): void {
	runtime.abandonFrameState();
	runtime.drawFrameState = null;
	runtime.clearHaltUntilIrq();
	runtime.machineScheduler.reset(runtime);
	runtime.frameLoop.reset();
	runtime.screen.reset();
	runtime.lastTickCompleted = false;
	runtime.lastTickBudgetGranted = 0;
	runtime.lastTickCpuBudgetGranted = 0;
	runtime.lastTickCpuUsedCycles = 0;
	runtime.lastTickBudgetRemaining = 0;
	runtime.lastTickSequence = 0;
	runtime.lastTickConsumedSequence = 0;
}

export function resetHardwareState(runtime: Runtime): void {
	runtime.machine.resetDevices();
	runtime.resetVblankState();
	runtime.resetRenderBuffers();
}

export function registerGlobal(runtime: Runtime, name: string, value: Value): void {
	runtime.machine.cpu.setGlobalByKey(runtime.canonicalKey(name), value);
}

export function buildEngineBuiltinPreludeSource(): string {
	const lines: string[] = [
		'local engine<const> = require("bios/engine")',
	];
	for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
		lines.push(`${name} = engine.${name}`);
	}
	for (let index = 0; index < ENGINE_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_GLOBALS[index].name;
		lines.push(`${name} = engine.${name}`);
	}
	return lines.join('\n');
}

export function runEngineBuiltinPrelude(runtime: Runtime, program: Program, metadata: ProgramMetadata): { program: Program; metadata: ProgramMetadata } {
	const source = buildEngineBuiltinPreludeSource();
	const interpreter = runtime.interpreter;
	interpreter.setReservedIdentifiers([]);
	const chunk = interpreter.compileChunk(source, ENGINE_BUILTIN_PRELUDE_PATH);
	interpreter.setReservedIdentifiers(runtime.getReservedLuaIdentifiers());
	const compiled = appendLuaChunkToProgram(program, metadata, chunk, {
		canonicalization: runtime.canonicalization,
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	runtime.programMetadata = compiled.metadata;
	runtime.callClosure({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
	applyEngineBuiltinGlobals(runtime);
	return { program: compiled.program, metadata: compiled.metadata };
}

export function applyEngineBuiltinGlobals(runtime: Runtime): void {
	const helperCount = ENGINE_SYSTEM_HELPER_NAMES.length;
	for (let index = 0; index < REQUIRED_ENGINE_SYSTEM_HELPERS.length; index += 1) {
		const name = REQUIRED_ENGINE_SYSTEM_HELPERS[index];
		const key = runtime.canonicalKey(name);
		if (runtime.machine.cpu.globals.get(key) === null) {
			seedLuaGlobals(runtime);
			break;
		}
	}
	const engine = requireModule(runtime, 'engine') as Table;
	for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
		const member = engine.get(runtime.canonicalKey(name)) as Closure;
		registerGlobal(runtime, name, member);
	}
	for (let index = 0; index < ENGINE_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_GLOBALS[index].name;
		registerGlobal(runtime, name, engine.get(runtime.canonicalKey(name)));
	}
	for (let index = 0; index < helperCount; index += 1) {
		const name = ENGINE_SYSTEM_HELPER_NAMES[index];
		const key = runtime.canonicalKey(name);
		const value = runtime.machine.cpu.globals.get(key);
		if (value !== null) {
			registerGlobal(runtime, name, value);
		}
	}
}

export function seedGlobals(runtime: Runtime): void {
	seedLuaGlobals(runtime);
}

export function setRandomSeed(runtime: Runtime, seed: number): void {
	runtime.randomSeedValue = seed;
}

export function nextRandom(runtime: Runtime): number {
	runtime.randomSeedValue = (runtime.randomSeedValue * 1664525 + 1013904223) % 4294967296;
	return runtime.randomSeedValue / 4294967296;
}

export function describeSymbolValue(value: Value): { kind: SymbolKind; valueType: string } {
	if (value === null) {
		return { kind: 'constant', valueType: 'nil' };
	}
	if (typeof value === 'boolean') {
		return { kind: 'constant', valueType: 'boolean' };
	}
	if (typeof value === 'number') {
		return { kind: 'constant', valueType: 'number' };
	}
	if (isStringValue(value)) {
		return { kind: 'constant', valueType: 'string' };
	}
	if (value instanceof Table) {
		return { kind: 'table', valueType: 'table' };
	}
	if (isNativeFunction(value)) {
		return { kind: 'function', valueType: 'native_function' };
	}
	if (isNativeObject(value)) {
		return { kind: 'table', valueType: 'native_object' };
	}
	return { kind: 'function', valueType: 'function' };
}

function stripSymbolModuleLuaExtension(path: string): string {
	return path.toLowerCase().endsWith('.lua') ? path.slice(0, path.length - 4) : path;
}

function stripSymbolModuleSourcePrefix(path: string): string {
	const normalized = stripSymbolModuleLuaExtension(path.replace(/\\/g, '/'));
	if (normalized.startsWith('src/carts/')) {
		const parts = normalized.split('/');
		return parts.length > 3 ? parts.slice(3).join('/') : parts[parts.length - 1];
	}
	if (normalized.startsWith('src/bmsx/res/')) {
		return normalized.slice('src/bmsx/res/'.length);
	}
	return normalized;
}

function sanitizeSymbolModuleSlotSegment(value: string, runtime: Runtime): string {
	return runtime.canonicalizeIdentifier(value).replace(/[^A-Za-z0-9_]/g, '_');
}

function buildSymbolModuleSlotPrefix(modulePath: string, runtime: Runtime): string {
	const compactPath = stripSymbolModuleSourcePrefix(modulePath);
	const parts = compactPath.split('/').filter(part => part.length > 0);
	const normalizedParts = parts.length > 0 ? parts : [compactPath];
	return normalizedParts.map(part => sanitizeSymbolModuleSlotSegment(part, runtime)).join('__');
}

function collectHiddenSymbolPrefixes(runtime: Runtime): Set<string> {
	const prefixes = new Set<string>();
	const registries = [runtime.engineLuaSources, runtime.cartLuaSources];
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const registry = registries[registryIndex];
		if (!registry) {
			continue;
		}
		const luaAssets = Object.values(registry.path2lua);
		for (let assetIndex = 0; assetIndex < luaAssets.length; assetIndex += 1) {
			prefixes.add(buildSymbolModuleSlotPrefix(luaAssets[assetIndex].source_path, runtime));
		}
	}
	return prefixes;
}

function shouldHideTerminalSymbolName(name: string, hiddenPrefixes: ReadonlySet<string>): boolean {
	for (const prefix of hiddenPrefixes) {
		if (name === prefix || name.startsWith(`${prefix}__`)) {
			return true;
		}
	}
	return false;
}

export function listSymbols(runtime: Runtime): SymbolEntry[] {
	runtime.machine.cpu.syncGlobalSlotsToTable();
	const entries = runtime.machine.cpu.globals.entriesArray();
	const hiddenPrefixes = collectHiddenSymbolPrefixes(runtime);
	const symbolsByName = new Map<string, SymbolEntry>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const key = entry[0];
		if (!isStringValue(key)) {
			continue;
		}
		const name = stringValueToString(key);
		if (shouldHideTerminalSymbolName(name, hiddenPrefixes) || symbolsByName.has(name)) {
			continue;
		}
		const classification = describeSymbolValue(entry[1]);
		symbolsByName.set(name, {
			name,
			kind: classification.kind,
			valueType: classification.valueType,
			origin: 'global',
		});
	}
	return Array.from(symbolsByName.values());
}

export function requireString(value: Value): string {
	return stringValueToString(value as StringValue);
}

export function hasLuaAssets(runtime: Runtime): boolean {
	const registry = runtime.isEngineProgramActive() ? runtime.engineLuaSources : runtime.cartLuaSources;
	return registry.can_boot_from_source;
}

export function shouldBootLuaProgramFromSources(runtime: Runtime): boolean {
	return hasLuaAssets(runtime);
}

export function resolveProgramAssetSourceFor(runtime: Runtime, source: 'engine' | 'cart'): RawAssetSource {
	if (source === 'engine') {
		if (!runtime.engineAssetSource) {
			throw runtimeFault('engine asset source is not configured.');
		}
		return runtime.engineAssetSource;
	}
	if (!runtime.cartAssetSource) {
		throw runtimeFault('cart asset source is not configured.');
	}
	return runtime.cartAssetSource;
}

export function loadProgramAssetsForSource(runtime: Runtime, source: 'engine' | 'cart'): { program: ProgramAsset; symbols: ProgramSymbolsAsset | null } {
	const assetSource = resolveProgramAssetSourceFor(runtime, source);
	const programEntry = assetSource.getEntry(PROGRAM_ASSET_ID);
	if (!programEntry) {
		throw runtimeFault('program asset not found.');
	}
	const program = decodeProgramAsset(assetSource.getBytes(programEntry));
	const symbolsEntry = assetSource.getEntry(PROGRAM_SYMBOLS_ASSET_ID);
	const symbols = symbolsEntry ? decodeProgramSymbolsAsset(assetSource.getBytes(symbolsEntry)) : null;
	return { program, symbols };
}

export function loadProgramAssets(runtime: Runtime): { program: ProgramAsset; symbols: ProgramSymbolsAsset | null } {
	const source = runtime.isEngineProgramActive() ? 'engine' : 'cart';
	return loadProgramAssetsForSource(runtime, source);
}

export function buildModuleChunks(runtime: Runtime, entryPath: string, registries?: LuaSourceRegistry[]): { modules: Array<{ path: string; chunk: LuaChunk; source: string }>; modulePaths: string[] } {
	const entryAsset = resolveLuaSourceRecord(runtime, entryPath);
	const entryKey = entryAsset ? entryAsset.source_path : entryPath;
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	const modulePaths: string[] = [];
	const seen = new Set<string>();
	const resolvedRegistries = registries ?? resolveModuleRegistries(runtime);
	for (const registry of resolvedRegistries) {
		if (!registry) {
			continue;
		}
		const luaAssets = Object.values(registry.path2lua);
		for (const asset of luaAssets) {
			if (!asset || asset.type !== 'lua') {
				continue;
			}
			const key = asset.source_path;
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			modulePaths.push(key);
			if (key === entryKey) {
				continue;
			}
			const source = resourceSourceForChunk(runtime, key);
			const chunk = runtime.interpreter.compileChunk(source, key);
			modules.push({ path: key, chunk, source });
		}
	}
	return { modules, modulePaths };
}

export function buildModuleChunksForInterpreter(
	runtime: Runtime,
	entryPath: string,
	interpreter: LuaInterpreter,
	registries?: LuaSourceRegistry[],
): { modules: Array<{ path: string; chunk: LuaChunk; source: string }>; modulePaths: string[] } {
	const entryAsset = resolveLuaSourceRecord(runtime, entryPath);
	const entryKey = entryAsset ? entryAsset.source_path : entryPath;
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	const modulePaths: string[] = [];
	const seen = new Set<string>();
	const resolvedRegistries = registries ?? resolveModuleRegistries(runtime);
	for (const registry of resolvedRegistries) {
		if (!registry) {
			continue;
		}
		const luaAssets = Object.values(registry.path2lua);
		for (const asset of luaAssets) {
			if (!asset || asset.type !== 'lua') {
				continue;
			}
			const key = asset.source_path;
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			modulePaths.push(key);
			if (key === entryKey) {
				continue;
			}
			const source = resourceSourceForChunk(runtime, key);
			const chunk = interpreter.compileChunk(source, key);
			modules.push({ path: key, chunk, source });
		}
	}
	return { modules, modulePaths };
}

export function compileCartLuaProgramForBoot(runtime: Runtime): {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	moduleAliases: Array<{ alias: string; path: string }>;
	entryPath: string;
	canonicalization: CanonicalizationType;
} {
	const entryAsset = runtime.cartLuaSources.path2lua[runtime.cartLuaSources.entry_path];
	if (!entryAsset) {
		throw runtimeFault('cannot prepare cart boot: entry Lua source is missing.');
	}
	const entryPath = entryAsset.source_path;
	const entrySource = resourceSourceForChunk(runtime, entryPath);
	const interpreter = runtime.createLuaInterpreterForCanonicalization(runtime.cartCanonicalization);
	const entryChunk = interpreter.compileChunk(entrySource, entryPath);
	const { modules, modulePaths } = buildModuleChunksForInterpreter(runtime, entryPath, interpreter, [runtime.cartLuaSources, runtime.engineLuaSources]);
	const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, {
		canonicalization: runtime.cartCanonicalization,
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: entrySource,
	});
	return {
		program,
		metadata,
		entryProtoIndex,
		moduleProtoMap,
		moduleAliases: buildModuleAliasesFromPaths(modulePaths),
		entryPath,
		canonicalization: runtime.cartCanonicalization,
	};
}

export function bootProgramAsset(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const { program, symbols } = loadProgramAssets(runtime);
	const engineActive = runtime.isEngineProgramActive();
	const engineAssets = engineActive ? null : loadProgramAssetsForSource(runtime, 'engine');
	const linked = engineAssets ? linkProgramAssets(engineAssets.program, engineAssets.symbols, program, symbols) : null;
	const programAsset = linked ? linked.programAsset : program;
	const metadata = linked ? linked.metadata : (symbols ? symbols.metadata : null);
	runtime.cartEntryAvailable = true;
	resetLuaInteroperabilityState(runtime);
	const interpreter = runtime.createLuaInterpreter();
	runtime.assignInterpreter(interpreter);

	runtime._luaPath = $.lua_sources.entry_path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	const protoMap = buildModuleProtoMap(programAsset.moduleProtos);
	runtime.moduleProtos.clear();
	for (const [path, protoIndex] of protoMap.entries()) {
		runtime.moduleProtos.set(path, protoIndex);
	}
	const aliasMap = buildModuleAliasMap(programAsset.moduleAliases);
	runtime.moduleAliases.clear();
	for (const [alias, path] of aliasMap.entries()) {
		runtime.moduleAliases.set(alias, path);
	}
	runtime.moduleCache.clear();
	runtime.machine.vdp.resetIngressState();

	const inflated = inflateProgram(programAsset.program);
	try {
		runtime.machine.cpu.setProgram(inflated, metadata);
		runtime.programMetadata = metadata;
		applyEngineBuiltinGlobals(runtime);

		beginEntryExecution(runtime, programAsset.entryProtoIndex);
		runtime.luaInitialized = true;

		if (options?.runInit === false) {
			return true;
		}
		queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
		return true;
	} catch (error) {
		console.info('Program-asset boot failed.');
		logDebugState(runtime);
		throw error;
	}
}

export function bootPreparedCartProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const prepared = runtime.preparedCartProgram;
	runtime.cartEntryAvailable = true;
	resetLuaInteroperabilityState(runtime);
	const interpreter = runtime.createLuaInterpreterForCanonicalization(prepared.canonicalization);
	runtime.assignInterpreter(interpreter);

	runtime._luaPath = prepared.entryPath;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	runtime.moduleProtos.clear();
	for (const [modulePath, protoIndex] of prepared.moduleProtoMap.entries()) {
		runtime.moduleProtos.set(modulePath, protoIndex);
	}
	runtime.moduleAliases.clear();
	for (const entry of prepared.moduleAliases) {
		runtime.moduleAliases.set(entry.alias, entry.path);
	}
	runtime.moduleCache.clear();
	runtime.machine.vdp.resetIngressState();
	const prelude = runEngineBuiltinPrelude(runtime, prepared.program, prepared.metadata);
	runtime.programMetadata = prelude.metadata;
	beginEntryExecution(runtime, prepared.entryProtoIndex);
	runtime.luaInitialized = true;

	if (options?.runInit === false) {
		return true;
	}
	queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
	return true;
}

export function bootActiveProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const ok = shouldBootLuaProgramFromSources(runtime)
		? bootLuaProgram(runtime, { preserveState: options?.preserveState })
		: bootProgramAsset(runtime, options);
	return ok;
}

export function bootLuaProgram(runtime: Runtime, options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
	const entryAsset = $.lua_sources.path2lua[$.lua_sources.entry_path];
	runtime.cartEntryAvailable = !!entryAsset;

	resetLuaInteroperabilityState(runtime);
	const interpreter = runtime.createLuaInterpreter();
	runtime.assignInterpreter(interpreter);

	if (!entryAsset) {
		runtime._luaPath = null;
		return false;
	}
	const path = entryAsset.source_path;
	if (!path || path.length === 0) {
		throw runtimeFault('cannot boot Lua program: entry asset has no path name.');
	}

	runtime._luaPath = path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	try {
		const entryPath = options?.sourceOverride?.path ?? path;
		const entrySource = options?.sourceOverride?.source ?? resourceSourceForChunk(runtime, entryPath);
		const entryChunk = interpreter.compileChunk(entrySource, entryPath);
		const { modules, modulePaths } = buildModuleChunks(runtime, entryPath);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, {
			canonicalization: runtime.canonicalization,
			optLevel: getRealtimeOptLevel(runtime),
			entrySource: entrySource,
		});
		runtime.moduleProtos.clear();
		for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
			runtime.moduleProtos.set(modulePath, protoIndex);
		}
		runtime.moduleAliases.clear();
		for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
			runtime.moduleAliases.set(entry.alias, entry.path);
		}
		runtime.moduleCache.clear();
		runtime.machine.vdp.resetIngressState();
		const prelude = runEngineBuiltinPrelude(runtime, program, metadata);
		runtime.programMetadata = prelude.metadata;
		beginEntryExecution(runtime, entryProtoIndex);
		runtime.luaInitialized = true;
	}
	catch (error) {
		console.info(`Lua boot '${path}' failed.`);
		logDebugState(runtime);
		runtimeIde.handleLuaError(runtime, error);
		return false;
	}

	queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
	return true;
}

export async function reloadProgramAndResetWorld(runtime: Runtime, options?: { runInit?: boolean; }): Promise<void> {
	const gateToken = runtime.luaGate.begin({ blocking: true, tag: 'reload_and_reset' });
	try {
		const preservingSuspension = runtime.pauseCoordinator.hasSuspension();
		if (!preservingSuspension) {
			runtime.pauseCoordinator.clearSuspension();
			runtimeIde.setDebuggerPaused(runtime, false);
			runtimeIde.clearRuntimeFault(runtime);
		}
		runtime.luaInitialized = false;

		runtime.luaChunkEnvironmentsByPath.clear();
		runtime.luaGenericChunksExecuted.clear();

		const reloadPlan = buildRuntimeAssetReloadPlan(runtime);
		await runtime.buildAssetMemory({ mode: reloadPlan.mode });
		if (reloadPlan.sealSystemAssets) {
			runtime.machine.memory.sealEngineAssets();
		}
		await $.resetRuntime(reloadPlan.resetFreshWorldOptions);
		await $.refresh_audio_assets();
		try {
			runtime.activateCartProgramAssets();
			resetRuntimeState(runtime);
			if (shouldBootLuaProgramFromSources(runtime)) {
				if (runtime.preparedCartProgram) {
					bootPreparedCartProgram(runtime, { runInit: options?.runInit !== false });
					runtime.preparedCartProgram = null;
				} else {
					reloadLuaProgramState(runtime, { runInit: options?.runInit !== false });
				}
			} else {
				bootProgramAsset(runtime, { preserveState: true, runInit: options?.runInit });
			}
			const machine = resolveRuntimeMachineForPlan(runtime, reloadPlan);
			const perfSpecs = getMachinePerfSpecs(machine);
			applyUfpsScaled(perfSpecs.ufps);
			const cpuHz = resolveCpuHz(perfSpecs.cpu_freq_hz);
			runtime.setCpuHz(cpuHz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, runtime.timing.ufpsScaled);
			runtime.setCycleBudgetPerFrame(cycleBudgetPerFrame);
			const renderHeight = resolveRenderHeight(machine.render_size.height);
			runtime.setVblankCycles(resolveVblankCycles(cpuHz, runtime.timing.ufpsScaled, renderHeight));
			runtime.setTransferRatesFromManifest(perfSpecs);
		} catch (error) {
			runtimeIde.handleLuaError(runtime, error);
		}
	}
	finally {
		runtime.luaGate.end(gateToken);
	}
}

export function resourceSourceForChunk(runtime: Runtime, path: string): string {
	const binding = resolveLuaSourceRecord(runtime, path);
	if (!binding) {
		return null;
	}
	const cached = getWorkspaceCachedSource(binding.source_path);
	if (cached !== null) {
		return cached;
	}
	return binding.src;
}

export function listLuaSourceRegistries(runtime: Runtime): Array<{ registry: LuaSourceRegistry; readOnly: boolean }> {
	const registries: Array<{ registry: LuaSourceRegistry; readOnly: boolean }> = [];
	if (runtime.cartLuaSources) {
		registries.push({ registry: runtime.cartLuaSources, readOnly: false });
	}
	registries.push({ registry: runtime.engineLuaSources, readOnly: false });
	return registries;
}

export function resolveLuaSourceRecord(runtime: Runtime, path: string): LuaSourceRecord | null {
	return $.lua_sources.path2lua[path]
		?? runtime.cartLuaSources?.path2lua[path]
		?? runtime.engineLuaSources?.path2lua[path]
		?? null;
}

export function resolveModuleRegistries(runtime: Runtime): LuaSourceRegistry[] {
	const registries: LuaSourceRegistry[] = [];
	if ($.lua_sources) {
		registries.push($.lua_sources);
	}
	if (runtime.engineLuaSources && runtime.engineLuaSources !== $.lua_sources) {
		registries.push(runtime.engineLuaSources);
	}
	return registries;
}

export function refreshLuaHandlersForChunk(runtime: Runtime, path: string, sourceOverride?: string): void {
	runtime.luaGenericChunksExecuted.delete(path);
	reloadGenericLuaChunk(runtime, path, sourceOverride);
	clearNativeMemberCompletionCache();
	runtimeIde.clearEditorErrorOverlaysIfNoFault(runtime);
}

export function reloadGenericLuaChunk(runtime: Runtime, path: string, sourceOverride?: string): void {
	const source = sourceOverride ? sourceOverride : resourceSourceForChunk(runtime, path);
	runtime.interpreter.compileChunk(source, path);
	runtime.luaGenericChunksExecuted.add(path);
}

export function requireLuaModule(runtime: Runtime, interpreter: LuaInterpreter, moduleName: string): LuaValue {
	const canonicalName = runtime.canonicalizeIdentifier(moduleName);
	const path = runtime.moduleAliases.get(moduleName) ?? runtime.moduleAliases.get(canonicalName);
	if (!path) {
		throw interpreter.runtimeError(`require('${moduleName}') failed: module not found.`);
	}
	const loaded = interpreter.packageLoadedTable.get(path);
	if (loaded !== undefined && loaded !== null) {
		return loaded;
	}
	interpreter.packageLoadedTable.set(path, true);
	const source = resourceSourceForChunk(runtime, path);
	if (!source) {
		throw interpreter.runtimeError(`require('${moduleName}') failed: module source unavailable.`);
	}
	const chunk = interpreter.compileChunk(source, path);
	const results = interpreter.executeChunk(chunk);
	const value = results.length > 0 ? results[0] : null;
	const cachedValue = value === null ? true : value;
	interpreter.packageLoadedTable.set(path, cachedValue);
	return cachedValue;
}

export function requireModule(runtime: Runtime, moduleName: string): Value {
	const canonicalName = runtime.canonicalizeIdentifier(moduleName);
	const path = runtime.moduleAliases.get(moduleName) ?? runtime.moduleAliases.get(canonicalName);
	if (!path) {
		throw runtime.createApiRuntimeError(`require('${moduleName}') failed: module not found.`);
	}
	const cached = runtime.moduleCache.get(path);
	if (cached !== undefined) {
		return cached;
	}
	const protoIndex = runtime.moduleProtos.get(path);
	if (protoIndex === undefined) {
		throw runtime.createApiRuntimeError(`require('${moduleName}') failed: module not compiled.`);
	}
	runtime.moduleCache.set(path, true);
	const results = runtime.acquireValueScratch();
	let value: Value = null;
	try {
		runtime.callClosureInto({ protoIndex, upvalues: [] }, [], results);
		value = results.length > 0 ? results[0] : null;
	} finally {
		runtime.releaseValueScratch(results);
	}
	const cachedValue = value === null ? true : value;
	runtime.moduleCache.set(path, cachedValue);
	return cachedValue;
}

export function invalidateModuleAliases(runtime: Runtime): void {
	runtime.moduleAliases.clear();
	runtime.pathSemanticCache.clear();
}

export function buildConsoleMetadata(baseProgram: Program): ProgramMetadata {
	const instructionCount = Math.floor(baseProgram.code.length / INSTRUCTION_BYTES);
	const debugRanges: Array<ProgramMetadata['debugRanges'][number]> = new Array(instructionCount);
	for (let index = 0; index < debugRanges.length; index += 1) {
		debugRanges[index] = null;
	}
	const protoIds = new Array<string>(baseProgram.protos.length);
	const localSlotsByProto: Array<NonNullable<ProgramMetadata['localSlotsByProto']>[number]> = new Array(baseProgram.protos.length);
	for (let index = 0; index < protoIds.length; index += 1) {
		protoIds[index] = `proto:${index}`;
		localSlotsByProto[index] = [];
	}
	return { debugRanges, protoIds, localSlotsByProto, globalNames: [], systemGlobalNames: [] };
}

export function runConsoleChunk(runtime: Runtime, source: string): Value[] {
	const chunk = runtime.interpreter.compileChunk(source, 'console');
	const currentProgram = runtime.machine.cpu.getProgram();
	if (!currentProgram) {
		throw runtimeFault('console execution requires active program.');
	}
	const baseMetadata = runtime.programMetadata ?? runtime.consoleMetadata ?? buildConsoleMetadata(currentProgram);
	const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, {
		canonicalization: runtime.canonicalization,
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	if (runtime.programMetadata) {
		runtime.programMetadata = compiled.metadata;
	} else {
		runtime.consoleMetadata = compiled.metadata;
	}
	const results = runtime.acquireValueScratch();
	runtime.callClosureIntoWithScheduler({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, [], results);
	return results.slice();
}
