import { engineCore } from '../../core/engine';
import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { convertToError } from '../../lua/value';
import type { LuaValue } from '../../lua/value';
import { publishOverlayFrame } from '../../render/editor/overlay_queue';
import { ENGINE_LUA_BUILTIN_FUNCTIONS, ENGINE_LUA_BUILTIN_GLOBALS } from '../../machine/firmware/builtin_descriptors';
import { seedLuaGlobals } from '../../machine/firmware/globals';
import { ENGINE_SYSTEM_HELPER_NAMES } from '../../machine/firmware/system_globals';
import { compileLuaChunkToProgram, appendLuaChunkToProgram } from '../../machine/program/compiler';
import { linkProgramAssets } from '../../machine/program/linker';
import { getWorkspaceCachedSource } from '../workspace/cache';
import type { RuntimeResumeSnapshot, SymbolEntry, SymbolKind } from '../../machine/runtime/contracts';
import { resolveLuaSourceRecordFromRegistries, type LuaSourceRegistry } from '../../machine/program/sources';
import { logDebugState } from '../../machine/runtime/debug';
import { addTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import { applyGameViewStateToHost } from '../../machine/runtime/game/view_state';
import { syncRuntimeGameViewStateToTable } from '../../machine/runtime/game/table';
import { restoreRuntimeLuaSnapshot } from '../../machine/runtime/resume_snapshot';
import { applyRuntimeMachineState } from '../../machine/runtime/machine_state';
import { flushHostRuntimeAssetEdits } from '../../core/host_asset_sync';
import { runtimeFault } from '../../machine/runtime/runtime_fault';
import { applyRuntimeRenderState, resetRuntimeRenderState } from '../../render/runtime_state';
import { clearBackQueues } from '../../render/shared/queues';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import * as workbenchMode from '../workbench/mode';
import { calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from '../../machine/runtime/timing';
import { setFrameTiming, setTransferRatesFromManifest } from '../../machine/runtime/timing/config';
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
} from '../../machine/program/asset';
import { INSTRUCTION_BYTES } from '../../machine/cpu/instruction_format';
import {
	IRQ_NEWGAME,
	IRQ_REINIT,
} from '../../machine/bus/io';
import { getMachinePerfSpecs } from '../../rompack/format';
import type { RawAssetSource } from '../../rompack/source';
import { Table, type Closure, type Program, type ProgramMetadata, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { StringValue, isStringValue, stringValueToString } from '../../machine/memory/string/pool';
import { Runtime } from '../../machine/runtime/runtime';
import { raiseEngineIrq } from '../../machine/runtime/engine_irq';
import { callClosure, callClosureInto, callClosureIntoWithScheduler } from '../../machine/program/executor';

const ENGINE_BUILTIN_PRELUDE_PATH = 'bios/engine_builtin_prelude.lua';
const getRealtimeOptLevel = (runtime: Runtime): 0 | 1 | 2 | 3 =>
	runtime.realtimeCompileOptLevel;
const REQUIRED_ENGINE_SYSTEM_HELPERS: ReadonlyArray<string> = ['clock_now'];

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
	if (runtime.assets.cartLayer) {
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
		return runtime.assets.cartLayer.index.machine;
	}
	return runtime.assets.biosLayer.index.machine;
}

export async function resumeFromSnapshot(runtime: Runtime, state: RuntimeResumeSnapshot, preserveEngineModules?: boolean): Promise<void> {
	workbenchMode.clearActiveDebuggerPause(runtime);
	if (!state) {
		runtime.luaRuntimeFailed = false;
		throw runtimeFault('cannot resume from invalid state snapshot.');
	}
	const snapshot: RuntimeResumeSnapshot = { ...state, luaRuntimeFailed: false };
	runtime.interpreter.clearLastFaultEnvironment();
	workbenchMode.clearFaultSnapshot(runtime);

	workbenchMode.resetHandledLuaErrors(runtime);
	runtime.luaRuntimeFailed = false;
	publishOverlayFrame(null);
	applyRuntimeMachineState(runtime, snapshot.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	flushHostRuntimeAssetEdits(runtime.machine.memory, engineCore.texmanager, engineCore.sndmaster);
	runtime.storage.restore(snapshot.storageState);
	resumeLuaProgramState(runtime, snapshot, preserveEngineModules);
	applyRuntimeRenderState(snapshot.renderState);
	clearBackQueues();
	runtime.luaInitialized = true;
	syncRuntimeGameViewStateToTable(runtime);
	applyGameViewStateToHost(runtime.gameViewState, engineCore.view);
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
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: params.source,
	});
	replaceMapEntries(runtime.moduleProtos, moduleProtoMap);
	installModuleAliasEntries(runtime, buildModuleAliasesFromPaths(modulePaths));
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
	clearEditorCompletionCache(runtime);
	workbenchMode.clearEditorErrorOverlaysIfNoFault(runtime);
}

export function clearCartModuleCacheForHotResume(runtime: Runtime): void {
	for (const path of Array.from(runtime.moduleCache.keys())) {
		if (!runtime.engineLuaSources.path2lua[path]) {
			runtime.moduleCache.delete(path);
		}
	}
}

function replaceMapEntries<TKey, TValue>(target: Map<TKey, TValue>, entries: Iterable<[TKey, TValue]>): void {
	target.clear();
	for (const [key, value] of entries) {
		target.set(key, value);
	}
}

function installModuleAliasEntries(runtime: Runtime, aliases: Iterable<{ alias: string; path: string }>): void {
	runtime.moduleAliases.clear();
	for (const entry of aliases) {
		runtime.moduleAliases.set(entry.alias, entry.path);
	}
}

function finishProgramModuleInstall(runtime: Runtime): void {
	runtime.moduleCache.clear();
	runtime.machine.vdp.resetIngressState();
}

function installFreshLuaInterpreter(runtime: Runtime): LuaInterpreter {
	resetLuaInteroperabilityState(runtime);
	const interpreter = runtime.createLuaInterpreter();
	runtime.assignInterpreter(interpreter);
	return interpreter;
}

function installProgramModuleAliases(runtime: Runtime, moduleProtos: Iterable<[string, number]>, aliases: Iterable<{ alias: string; path: string }>): void {
	replaceMapEntries(runtime.moduleProtos, moduleProtos);
	installModuleAliasEntries(runtime, aliases);
	finishProgramModuleInstall(runtime);
}

function installProgramModuleMaps(runtime: Runtime, moduleProtos: Iterable<[string, number]>, aliases: Iterable<[string, string]>): void {
	replaceMapEntries(runtime.moduleProtos, moduleProtos);
	replaceMapEntries(runtime.moduleAliases, aliases);
	finishProgramModuleInstall(runtime);
}

function editorSourceForChunk(runtime: Runtime, path: string): string {
	return runtime.editor !== null ? runtime.editor.getSourceForChunk(path) : resourceSourceForChunk(runtime, path);
}

function clearEditorCompletionCache(runtime: Runtime): void {
	if (runtime.editor !== null) {
		runtime.editor.clearNativeMemberCompletionCache();
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
		raiseEngineIrq(runtime, irqMask);
	}
}

function finishEntryBoot(runtime: Runtime, runInit: boolean | undefined): boolean {
	runtime.luaInitialized = true;
	if (runInit === false) {
		return true;
	}
	queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
	return true;
}

export function reloadLuaProgramState(runtime: Runtime, runInit = true): void {
	const binding = runtime.activeLuaSources.path2lua[runtime.activeLuaSources.entry_path];
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
		hotResumeProgramEntry(runtime, { source: editorSourceForChunk(runtime, binding.source_path), path: binding.source_path });
		if (runInit) {
			queueLifecycleHandlers(runtime, { runInit: true, runNewGame: true });
		}
	}
	runtime.luaInitialized = true;
}

export function resumeLuaProgramState(runtime: Runtime, snapshot: RuntimeResumeSnapshot, preserveEngineModules?: boolean): void {
	const savedRuntimeFailed = !!snapshot.luaRuntimeFailed;
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
		const shouldPreserveEngineModules = preserveEngineModules ?? runtime.activeProgramSource !== 'engine';
		hotResumeProgramEntry(runtime, { source, path: binding, preserveEngineModules: shouldPreserveEngineModules });
	}
	catch (error) {
		workbenchMode.handleLuaError(runtime, error);
		throw convertToError(error);
	}
	refreshLuaModulesOnResume(runtime, binding);
	clearEditorCompletionCache(runtime);
	queueLifecycleHandlers(runtime, { runInit: true, runNewGame: false });
	restoreRuntimeLuaSnapshot(runtime, snapshot);
	if (savedRuntimeFailed) {
		runtime.luaRuntimeFailed = true;
	}
}

export function refreshLuaModulesOnResume(runtime: Runtime, resumeModuleId: string): void {
	const paths = Object.keys(runtime.activeLuaSources.path2lua);
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

export function resetLuaInteroperabilityState(runtime: Runtime): void {
	runtime.luaGenericChunksExecuted.clear();
	workbenchMode.resetHandledLuaErrors(runtime);
	runtime.luaFunctionRedirectCache.clear();
}

export function resetRuntimeState(runtime: Runtime): void {
	resetFrameState(runtime);
	runtime.pendingCall = null;
	runtime.cartBoot.pending = false;
	resetHardwareState(runtime);
	const cpu = runtime.machine.cpu;
	cpu.globals.clear();
	cpu.clearGlobalSlots();
	resetTrackedLuaHeapBytes();
	addTrackedLuaHeapBytes(cpu.globals.getTrackedHeapBytes());
	runtime.moduleCache.clear();
	runtime.moduleProtos.clear();
	seedGlobals(runtime);
}

export function resetFrameState(runtime: Runtime): void {
	runtime.frameLoop.abandonFrameState(runtime);
	runtime.frameLoop.drawFrameState = null;
	runtime.vblank.clearHaltUntilIrq(runtime);
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.screen.reset();
	runtime.frameScheduler.resetTickTelemetry();
}

export function resetHardwareState(runtime: Runtime): void {
	runtime.machine.resetDevices();
	runtime.vblank.reset(runtime);
	resetRuntimeRenderState();
	clearBackQueues();
}

export function registerGlobal(runtime: Runtime, name: string, value: Value): void {
	runtime.machine.cpu.setGlobalByKey(runtime.luaKey(name), value);
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
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	runtime.programMetadata = compiled.metadata;
	callClosure(runtime, { protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
	applyEngineBuiltinGlobals(runtime);
	return { program: compiled.program, metadata: compiled.metadata };
}

export function applyEngineBuiltinGlobals(runtime: Runtime): void {
	const helperCount = ENGINE_SYSTEM_HELPER_NAMES.length;
	for (let index = 0; index < REQUIRED_ENGINE_SYSTEM_HELPERS.length; index += 1) {
		const name = REQUIRED_ENGINE_SYSTEM_HELPERS[index];
		const key = runtime.luaKey(name);
		if (runtime.machine.cpu.globals.get(key) === null) {
			seedLuaGlobals(runtime);
			break;
		}
	}
	const engine = requireModule(runtime, 'engine') as Table;
	for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
		const member = engine.get(runtime.luaKey(name)) as Closure;
		registerGlobal(runtime, name, member);
	}
	for (let index = 0; index < ENGINE_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_GLOBALS[index].name;
		registerGlobal(runtime, name, engine.get(runtime.luaKey(name)));
	}
	for (let index = 0; index < helperCount; index += 1) {
		const name = ENGINE_SYSTEM_HELPER_NAMES[index];
		const key = runtime.luaKey(name);
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

function buildSymbolModuleSlotPrefix(modulePath: string): string {
	const compactPath = stripSymbolModuleSourcePrefix(modulePath);
	const parts = compactPath.split('/').filter(part => part.length > 0);
	const normalizedParts = parts.length > 0 ? parts : [compactPath];
	let prefix = '';
	for (let index = 0; index < normalizedParts.length; index += 1) {
		if (index > 0) {
			prefix += '__';
		}
		prefix += normalizedParts[index].replace(/[^A-Za-z0-9_]/g, '_');
	}
	return prefix;
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
			prefixes.add(buildSymbolModuleSlotPrefix(luaAssets[assetIndex].source_path));
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
	const hiddenPrefixes = collectHiddenSymbolPrefixes(runtime);
	const symbolsByName = new Map<string, SymbolEntry>();
	runtime.machine.cpu.globals.forEachEntry((key, value) => {
		if (!isStringValue(key)) {
			return;
		}
		const name = stringValueToString(key);
		if (shouldHideTerminalSymbolName(name, hiddenPrefixes) || symbolsByName.has(name)) {
			return;
		}
		const classification = describeSymbolValue(value);
		symbolsByName.set(name, {
			name,
			kind: classification.kind,
			valueType: classification.valueType,
			origin: 'global',
		});
	});
	return Array.from(symbolsByName.values());
}

export function requireString(value: Value): string {
	return stringValueToString(value as StringValue);
}

export function hasLuaAssets(runtime: Runtime): boolean {
	return runtime.activeLuaSources.can_boot_from_source;
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
	return loadProgramAssetsForSource(runtime, runtime.activeProgramSource);
}

export function buildModuleChunks(
	runtime: Runtime,
	entryPath: string,
	registries?: LuaSourceRegistry[],
	interpreter: LuaInterpreter = runtime.interpreter,
): { modules: Array<{ path: string; chunk: LuaChunk; source: string }>; modulePaths: string[] } {
	const entryAsset = resolveLuaSourceRecordFromRegistries(entryPath, [
		runtime.activeLuaSources,
		runtime.cartLuaSources,
		runtime.engineLuaSources,
	]);
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
} {
	const entryAsset = runtime.cartLuaSources.path2lua[runtime.cartLuaSources.entry_path];
	if (!entryAsset) {
		throw runtimeFault('cannot prepare cart boot: entry Lua source is missing.');
	}
	const entryPath = entryAsset.source_path;
	const entrySource = resourceSourceForChunk(runtime, entryPath);
	const interpreter = runtime.createLuaInterpreter();
	const entryChunk = interpreter.compileChunk(entrySource, entryPath);
	const { modules, modulePaths } = buildModuleChunks(runtime, entryPath, [runtime.cartLuaSources, runtime.engineLuaSources], interpreter);
	const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, {
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
	};
}

export function bootProgramAsset(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const { program, symbols } = loadProgramAssets(runtime);
	const engineActive = runtime.activeProgramSource === 'engine';
	const engineAssets = engineActive ? null : loadProgramAssetsForSource(runtime, 'engine');
	const linked = engineAssets ? linkProgramAssets(engineAssets.program, engineAssets.symbols, program, symbols) : null;
	const programAsset = linked ? linked.programAsset : program;
	let metadata: ProgramMetadata = null;
	if (linked) {
		metadata = linked.metadata;
	} else if (symbols) {
		metadata = symbols.metadata;
	}
	runtime.cartEntryAvailable = true;
	installFreshLuaInterpreter(runtime);

	runtime._luaPath = runtime.activeLuaSources.entry_path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	const protoMap = buildModuleProtoMap(programAsset.moduleProtos);
	installProgramModuleMaps(runtime, protoMap, buildModuleAliasMap(programAsset.moduleAliases));

	const inflated = inflateProgram(programAsset.program);
	try {
		runtime.machine.cpu.setProgram(inflated, metadata);
		runtime.programMetadata = metadata;
		applyEngineBuiltinGlobals(runtime);

		beginEntryExecution(runtime, programAsset.entryProtoIndex);
		return finishEntryBoot(runtime, options?.runInit);
	} catch (error) {
		console.info('Program-asset boot failed.');
		logDebugState(runtime);
		throw error;
	}
}

export function bootPreparedCartProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const prepared = runtime.cartBoot.preparedProgram;
	runtime.cartEntryAvailable = true;
	installFreshLuaInterpreter(runtime);

	runtime._luaPath = prepared.entryPath;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	installProgramModuleAliases(runtime, prepared.moduleProtoMap, prepared.moduleAliases);
	const prelude = runEngineBuiltinPrelude(runtime, prepared.program, prepared.metadata);
	runtime.programMetadata = prelude.metadata;
	beginEntryExecution(runtime, prepared.entryProtoIndex);
	return finishEntryBoot(runtime, options?.runInit);
}

export function bootActiveProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const ok = shouldBootLuaProgramFromSources(runtime)
		? bootLuaProgram(runtime, { preserveState: options?.preserveState })
		: bootProgramAsset(runtime, options);
	return ok;
}

export function bootLuaProgram(runtime: Runtime, options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
	const entryAsset = runtime.activeLuaSources.path2lua[runtime.activeLuaSources.entry_path];
	runtime.cartEntryAvailable = !!entryAsset;

	const interpreter = installFreshLuaInterpreter(runtime);

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
			optLevel: getRealtimeOptLevel(runtime),
			entrySource: entrySource,
		});
		installProgramModuleAliases(runtime, moduleProtoMap, buildModuleAliasesFromPaths(modulePaths));
		const prelude = runEngineBuiltinPrelude(runtime, program, metadata);
		runtime.programMetadata = prelude.metadata;
		beginEntryExecution(runtime, entryProtoIndex);
		return finishEntryBoot(runtime, true);
	}
	catch (error) {
		console.info(`Lua boot '${path}' failed.`);
		logDebugState(runtime);
		workbenchMode.handleLuaError(runtime, error);
		throw convertToError(error);
	}
}

export async function reloadProgramAndResetWorld(runtime: Runtime, runInit = true): Promise<void> {
	const gateToken = runtime.luaGate.begin({ blocking: true, tag: 'reload_and_reset' });
	try {
		const preservingSuspension = runtime.pauseCoordinator.hasSuspension();
		if (!preservingSuspension) {
			runtime.pauseCoordinator.clearSuspension();
			workbenchMode.setDebuggerPaused(runtime, false);
			workbenchMode.clearRuntimeFault(runtime);
		}
		runtime.luaInitialized = false;

		runtime.luaChunkEnvironmentsByPath.clear();
		runtime.luaGenericChunksExecuted.clear();

		const reloadPlan = buildRuntimeAssetReloadPlan(runtime);
		await runtime.assets.buildMemory(runtime, { mode: reloadPlan.mode });
		if (reloadPlan.sealSystemAssets) {
			runtime.machine.memory.sealEngineAssets();
		}
		await engineCore.resetRuntime(reloadPlan.resetFreshWorldOptions.preserve_textures);
		await engineCore.refresh_audio_assets();
		try {
			runtime.activateCartProgramAssets();
			resetRuntimeState(runtime);
			if (shouldBootLuaProgramFromSources(runtime)) {
					if (runtime.cartBoot.preparedProgram) {
						bootPreparedCartProgram(runtime, { runInit });
						runtime.cartBoot.preparedProgram = null;
					} else {
						reloadLuaProgramState(runtime, runInit);
					}
				} else {
					bootProgramAsset(runtime, { preserveState: true, runInit });
				}
			const machine = resolveRuntimeMachineForPlan(runtime, reloadPlan);
			const perfSpecs = getMachinePerfSpecs(machine);
			applyUfpsScaled(perfSpecs.ufps);
			const cpuHz = resolveCpuHz(perfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, runtime.timing.ufpsScaled);
			const renderHeight = resolveRenderHeight(machine.render_size.height);
			const vblankCycles = resolveVblankCycles(cpuHz, runtime.timing.ufpsScaled, renderHeight);
			setFrameTiming(runtime, cpuHz, cycleBudgetPerFrame, vblankCycles);
			setTransferRatesFromManifest(runtime, perfSpecs);
		} catch (error) {
			workbenchMode.handleLuaError(runtime, error);
		}
	}
	finally {
		runtime.luaGate.end(gateToken);
	}
}

export function resourceSourceForChunk(runtime: Runtime, path: string): string {
	const binding = resolveLuaSourceRecordFromRegistries(path, [
		runtime.activeLuaSources,
		runtime.cartLuaSources,
		runtime.engineLuaSources,
	]);
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

export function resolveModuleRegistries(runtime: Runtime): LuaSourceRegistry[] {
	const registries: LuaSourceRegistry[] = [];
	if (runtime.activeLuaSources) {
		registries.push(runtime.activeLuaSources);
	}
	if (runtime.engineLuaSources && runtime.engineLuaSources !== runtime.activeLuaSources) {
		registries.push(runtime.engineLuaSources);
	}
	return registries;
}

export function refreshLuaHandlersForChunk(runtime: Runtime, path: string, sourceOverride?: string): void {
	runtime.luaGenericChunksExecuted.delete(path);
	reloadGenericLuaChunk(runtime, path, sourceOverride);
	clearEditorCompletionCache(runtime);
	workbenchMode.clearEditorErrorOverlaysIfNoFault(runtime);
}

export function reloadGenericLuaChunk(runtime: Runtime, path: string, sourceOverride?: string): void {
	const source = sourceOverride ? sourceOverride : resourceSourceForChunk(runtime, path);
	runtime.interpreter.compileChunk(source, path);
	runtime.luaGenericChunksExecuted.add(path);
}

export function requireLuaModule(runtime: Runtime, interpreter: LuaInterpreter, moduleName: string): LuaValue {
	const path = runtime.moduleAliases.get(moduleName);
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
	const path = runtime.moduleAliases.get(moduleName);
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
	const results = runtime.luaScratch.acquireValue();
	let value: Value = null;
	try {
		callClosureInto(runtime, { protoIndex, upvalues: [] }, [], results);
		value = results.length > 0 ? results[0] : null;
	} finally {
		runtime.luaScratch.releaseValue(results);
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
		optLevel: getRealtimeOptLevel(runtime),
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	if (runtime.programMetadata) {
		runtime.programMetadata = compiled.metadata;
	} else {
		runtime.consoleMetadata = compiled.metadata;
	}
	const results = runtime.luaScratch.acquireValue();
	try {
		callClosureIntoWithScheduler(runtime, { protoIndex: compiled.entryProtoIndex, upvalues: [] }, [], results);
		return results.slice();
	} finally {
		runtime.luaScratch.releaseValue(results);
	}
}
