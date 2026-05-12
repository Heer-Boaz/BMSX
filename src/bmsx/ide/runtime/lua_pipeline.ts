import { consoleCore } from '../../core/console';
import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { convertToError } from '../../lua/value';
import type { LuaValue } from '../../lua/value';
import { clearOverlayFrame } from '../../render/host_overlay/overlay_queue';
import { SYSTEM_LUA_BUILTIN_FUNCTIONS, SYSTEM_LUA_BUILTIN_GLOBALS } from '../../machine/firmware/builtin_descriptors';
import { seedLuaGlobals } from '../../machine/firmware/globals';
import { SYSTEM_ROM_HELPER_NAMES } from '../../machine/firmware/system_globals';
import { compileLuaChunkToProgram, appendLuaChunkToProgram, type CompiledProgram } from '../../machine/program/compiler';
import { linkProgramImages } from '../../machine/program/linker';
import { workspaceSourceCache } from '../workspace/cache';
import { RuntimeResumeSnapshot, SymbolEntry, SymbolKind } from '../../machine/runtime/contracts';
import { resolveLuaSourceRecordFromRegistries, type LuaSourceRegistry } from '../../machine/program/sources';
import { logDebugState } from '../../machine/runtime/debug';
import { addTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import { restoreRuntimeLuaSnapshot } from '../../machine/runtime/resume_snapshot';
import { applyRuntimeMachineState } from '../../machine/runtime/machine_state';
import { resetHardwareCameraBank0 } from '../../render/shared/hardware/camera';
import { clearHardwareLighting } from '../../render/shared/hardware/lighting';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import * as workbenchMode from '../workbench/mode';
import { calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from '../../machine/runtime/timing';
import { setFrameTiming, setTransferRatesFromManifest } from '../../machine/runtime/timing/config';
import {
	buildModuleProtoMap,
	decodeProgramImage,
	decodeProgramSymbolsImage,
	encodeProgramObjectSections,
	inflateProgram,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
	toLuaModulePath,
	type ProgramImage,
	type ProgramSymbolsImage,
} from '../../machine/program/loader';
import {
	IRQ_NEWGAME,
	IRQ_REINIT,
} from '../../machine/bus/io';
import { getMachinePerfSpecs } from '../../rompack/format';
import type { RawRomSource } from '../../rompack/source';
import { Table, type Closure, type Program, type ProgramMetadata, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { asStringId, valueIsString } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';
import { raiseSystemIrq } from '../../machine/runtime/system_irq';
import { callClosure, callClosureInto } from '../../machine/program/executor';

const SYSTEM_BUILTIN_PRELUDE_PATH = 'bios/system_builtin_prelude.lua';
const REQUIRED_SYSTEM_ROM_HELPERS: ReadonlyArray<string> = ['clock_now'];

function applyUfpsScaled(runtime: Runtime, ufps: number): number {
	const ufpsScaled = resolveUfpsScaled(ufps);
	runtime.timing.applyUfpsScaled(ufpsScaled);
	return ufpsScaled;
}

type RuntimeMachineSource = 'system' | 'cart';

interface RuntimeReloadPlan {
	machineSource: RuntimeMachineSource;
	resetFreshWorldOptions: { preserve_textures: boolean };
}

function buildRuntimeReloadPlan(runtime: Runtime): RuntimeReloadPlan {
	if (runtime.cartRom) {
		return {
			machineSource: 'cart',
			resetFreshWorldOptions: { preserve_textures: true },
		};
	}
	return {
		machineSource: 'system',
		resetFreshWorldOptions: { preserve_textures: false },
	};
}

function resolveRuntimeMachineForPlan(runtime: Runtime, plan: RuntimeReloadPlan) {
	if (plan.machineSource === 'cart') {
		return runtime.cartRom.index.machine;
	}
	return runtime.systemRom.index.machine;
}

export async function resumeFromSnapshot(runtime: Runtime, state: RuntimeResumeSnapshot, preserveSystemModules?: boolean): Promise<void> {
	workbenchMode.clearActiveDebuggerPause(runtime);
	if (!state) {
		runtime.luaRuntimeFailed = false;
		throw new Error('cannot resume from invalid state snapshot.');
	}
	const snapshot: RuntimeResumeSnapshot = { ...state, luaRuntimeFailed: false };
	runtime.interpreter.clearLastFaultEnvironment();
	workbenchMode.clearFaultSnapshot(runtime);

	workbenchMode.resetHandledLuaErrors(runtime);
	runtime.luaRuntimeFailed = false;
	clearOverlayFrame();
	applyRuntimeMachineState(runtime, snapshot.machineState);
	restoreVdpContextState(runtime.machine.vdp, consoleCore.view);
	resumeLuaProgramState(runtime, snapshot, preserveSystemModules);
	runtime.luaInitialized = true;
}

export function hotResumeProgramEntry(runtime: Runtime, params: { path: string; source: string; preserveSystemModules?: boolean }): void {
	const preserveRuntimeFailure = runtime.luaRuntimeFailed || (runtime.pauseCoordinator.hasSuspension() && runtime.pauseCoordinator.getPendingException() !== null);
	const binding = params.path;
	const baseMetadata = runtime.programMetadata;
	if (!baseMetadata) {
		throw new Error('hot reload requires program symbols.');
	}
	const interpreter = runtime.interpreter;
	interpreter.clearLastFaultEnvironment();
	const chunk = interpreter.compileChunk(params.source, binding);
	const { modules } = buildModuleChunks(runtime, binding);
	const baseProgram = runtime.machine.cpu.program;
	if (!baseProgram) {
		throw new Error('hot reload requires active program.');
	}
	const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, {
		baseProgram,
		baseMetadata,
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: params.source,
	});
	replaceMapEntries(runtime.moduleProtos, moduleProtoMap);
	if (params.preserveSystemModules) {
		clearCartModuleCacheForHotResume(runtime);
	} else {
		runtime.moduleCache.clear();
	}
	runtime.machine.vdp.resetIngressState();
	const prelude = runSystemBuiltinPrelude(runtime, program, metadata);
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
		if (!runtime.systemLuaSources.path2lua[path]) {
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

function installProgramModules(runtime: Runtime, moduleProtos: Iterable<[string, number]>): void {
	replaceMapEntries(runtime.moduleProtos, moduleProtos);
	finishProgramModuleInstall(runtime);
}

function editorSourceForChunk(runtime: Runtime, path: string): string {
	return runtime.editor ? runtime.editor.getSourceForChunk(path) : resourceSourceForChunk(runtime, path);
}

function clearEditorCompletionCache(runtime: Runtime): void {
	const editor = runtime.editor;
	if (!editor) {
		return;
	}
	editor.clearNativeMemberCompletionCache();
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
		raiseSystemIrq(runtime, irqMask);
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
	const binding = resolveLuaSourceRecordFromRegistries(runtime.activeLuaSources.entry_path, [runtime.activeLuaSources]);
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

export function resumeLuaProgramState(runtime: Runtime, snapshot: RuntimeResumeSnapshot, preserveSystemModules?: boolean): void {
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
		const shouldPreserveSystemModules = preserveSystemModules ?? runtime.cartProgramStarted;
		hotResumeProgramEntry(runtime, { source, path: binding, preserveSystemModules: shouldPreserveSystemModules });
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
	seedLuaGlobals(runtime);
}

export function resetFrameState(runtime: Runtime): void {
	runtime.frameLoop.abandonFrameState();
	runtime.frameLoop.drawFrameState = null;
	runtime.machine.cpu.clearHaltUntilIrq();
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.screen.reset();
	runtime.frameScheduler.resetTickTelemetry();
}

export function resetHardwareState(runtime: Runtime): void {
	runtime.machine.resetDevices();
	runtime.vblank.reset();
	resetHardwareCameraBank0();
	clearHardwareLighting();
}

export function registerGlobal(runtime: Runtime, name: string, value: Value): void {
	runtime.machine.cpu.setGlobalByKey(runtime.internString(name), value);
}

export function buildSystemBuiltinPreludeSource(): string {
	const lines: string[] = [
		'local system<const> = require("bios/system")',
	];
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		lines.push(`${name} = system.${name}`);
	}
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_GLOBALS[index].name;
		lines.push(`${name} = system.${name}`);
	}
	return lines.join('\n');
}

export function runSystemBuiltinPrelude(runtime: Runtime, program: Program, metadata: ProgramMetadata, staticModulePaths: ReadonlyArray<string> = []): { program: Program; metadata: ProgramMetadata } {
	const source = buildSystemBuiltinPreludeSource();
	const interpreter = runtime.interpreter;
	interpreter.setReservedIdentifiers([]);
	const chunk = interpreter.compileChunk(source, SYSTEM_BUILTIN_PRELUDE_PATH);
	interpreter.setReservedIdentifiers(runtime.getReservedLuaIdentifiers());
	const compiled = appendLuaChunkToProgram(program, metadata, chunk, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	runtime.programMetadata = compiled.metadata;
	callClosure(runtime, { protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
	applySystemBuiltinGlobals(runtime);
	runStaticModuleInitializers(runtime, staticModulePaths);
	return { program: compiled.program, metadata: compiled.metadata };
}

export function applySystemBuiltinGlobals(runtime: Runtime): void {
	const helperCount = SYSTEM_ROM_HELPER_NAMES.length;
	for (let index = 0; index < REQUIRED_SYSTEM_ROM_HELPERS.length; index += 1) {
		const name = REQUIRED_SYSTEM_ROM_HELPERS[index];
		const key = runtime.internString(name);
		if (runtime.machine.cpu.globals.get(key) === null) {
			seedLuaGlobals(runtime);
			break;
		}
	}
	const system = requireModule(runtime, 'bios/system') as Table;
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		const member = system.get(runtime.internString(name)) as Closure;
		registerGlobal(runtime, name, member);
	}
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_GLOBALS[index].name;
		registerGlobal(runtime, name, system.get(runtime.internString(name)));
	}
	for (let index = 0; index < helperCount; index += 1) {
		const name = SYSTEM_ROM_HELPER_NAMES[index];
		const key = runtime.internString(name);
		const value = runtime.machine.cpu.globals.get(key);
		if (value !== null) {
			registerGlobal(runtime, name, value);
		}
	}
}

function runStaticModuleInitializers(runtime: Runtime, paths: ReadonlyArray<string>): void {
	for (let index = 0; index < paths.length; index += 1) {
		runStaticModuleInitializer(runtime, paths[index]);
	}
	runtime.machine.cpu.syncGlobalSlotsToTable();
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
	if (valueIsString(value)) {
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

function buildSymbolModuleSlotPrefix(modulePath: string): string {
	const compactPath = toLuaModulePath(modulePath);
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
	const registries = [runtime.systemLuaSources, runtime.cartLuaSources];
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
		if (!valueIsString(key)) {
			return;
		}
		const name = runtime.machine.cpu.stringPool.toString(asStringId(key));
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

export function shouldBootLuaProgramFromSources(runtime: Runtime): boolean {
	return runtime.activeLuaSources.can_boot_from_source;
}

export function resolveProgramImageSourceFor(runtime: Runtime, source: 'system' | 'cart'): RawRomSource {
	if (source === 'system') {
		if (!runtime.systemRomSource) {
			throw new Error('system ROM source is not configured.');
		}
		return runtime.systemRomSource;
	}
	if (!runtime.cartRomSource) {
		throw new Error('cart ROM source is not configured.');
	}
	return runtime.cartRomSource;
}

export function loadProgramImagesForSource(runtime: Runtime, source: 'system' | 'cart'): { program: ProgramImage; symbols: ProgramSymbolsImage | null } {
	const romSource = resolveProgramImageSourceFor(runtime, source);
	const programEntry = romSource.getEntry(PROGRAM_IMAGE_ID);
	if (!programEntry) {
		throw new Error('program image not found.');
	}
	const program = decodeProgramImage(romSource.getBytes(programEntry));
	const symbolsEntry = romSource.getEntry(PROGRAM_SYMBOLS_IMAGE_ID);
	let symbols: ProgramSymbolsImage | null = null;
	if (symbolsEntry) {
		symbols = decodeProgramSymbolsImage(romSource.getBytes(symbolsEntry));
	}
	return { program, symbols };
}

export function buildModuleChunks(
	runtime: Runtime,
	entryPath: string,
	registries?: LuaSourceRegistry[],
	interpreter: LuaInterpreter = runtime.interpreter,
): { modules: Array<{ path: string; chunk: LuaChunk; source: string }> } {
	const entryAsset = resolveLuaSourceRecordFromRegistries(entryPath, [
		runtime.activeLuaSources,
		runtime.cartLuaSources,
		runtime.systemLuaSources,
	]);
	const entryKey = entryAsset ? entryAsset.module_path : toLuaModulePath(entryPath);
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
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
			const key = asset.module_path;
				if (!key || seen.has(key)) {
					continue;
				}
				seen.add(key);
				if (key === entryKey) {
					continue;
				}
			const source = resourceSourceForChunk(runtime, key);
			const chunk = interpreter.compileChunk(source, key);
			modules.push({ path: key, chunk, source });
		}
	}
	return { modules };
}

function programImageFromCompiled(compiled: CompiledProgram): ProgramImage {
	return {
		entryProtoIndex: compiled.entryProtoIndex,
		sections: encodeProgramObjectSections(
			compiled.program,
			Array.from(compiled.moduleProtoMap, ([path, protoIndex]) => ({ path, protoIndex })),
			compiled.staticModulePaths,
		),
		link: { constRelocs: compiled.constRelocs },
	};
}

function compileRegistryProgramImage(
	runtime: Runtime,
	registry: LuaSourceRegistry,
	interpreter: LuaInterpreter,
	externalModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }> = [],
): { image: ProgramImage; symbols: ProgramSymbolsImage; entryPath: string; modules: Array<{ path: string; chunk: LuaChunk; source: string }> } {
	const entryAsset = resolveLuaSourceRecordFromRegistries(registry.entry_path, [registry]);
	if (!entryAsset) {
		throw new Error(`cannot compile boot program: entry Lua source '${registry.entry_path}' is missing.`);
	}
	const entryPath = entryAsset.module_path;
	const entrySource = resourceSourceForChunk(runtime, entryPath);
	const entryChunk = interpreter.compileChunk(entrySource, entryPath);
	const { modules } = buildModuleChunks(runtime, entryPath, [registry], interpreter);
	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource,
		externalModules,
	});
	return {
		image: programImageFromCompiled(compiled),
		symbols: compiled.metadata,
		entryPath,
		modules,
	};
}

function bootSystemSourceProgram(runtime: Runtime, interpreter: LuaInterpreter, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const system = compileRegistryProgramImage(runtime, runtime.systemLuaSources, interpreter);
	let programImage = system.image;
	let metadata: ProgramMetadata = system.symbols;
	let entryProtoIndex = system.image.entryProtoIndex;
	let staticModulePaths: ReadonlyArray<string> = system.image.sections.rodata.staticModulePaths;
	runtime.cartEntryProtoIndex = null;
	runtime.cartStaticModulePaths = [];
	let cartProgramImage: ProgramImage | null = null;
	let cartSymbols: ProgramSymbolsImage | null = null;
	if (runtime.cartLuaSources?.can_boot_from_source) {
		const cart = compileRegistryProgramImage(runtime, runtime.cartLuaSources, interpreter, system.modules);
		cartProgramImage = cart.image;
		cartSymbols = cart.symbols;
	} else if (runtime.cartRomSource && runtime.cartRomSource.getEntry(PROGRAM_IMAGE_ID)) {
		const cart = loadProgramImagesForSource(runtime, 'cart');
		cartProgramImage = cart.program;
		cartSymbols = cart.symbols;
	}
	if (cartProgramImage) {
		const linked = linkProgramImages(system.image, system.symbols, cartProgramImage, cartSymbols);
		programImage = linked.programImage;
		metadata = linked.metadata;
		entryProtoIndex = linked.systemEntryProtoIndex;
		staticModulePaths = linked.systemStaticModulePaths;
		runtime.setLinkedCartEntry(linked.cartEntryProtoIndex, linked.cartStaticModulePaths);
	}
	runtime.cartEntryAvailable = true;
	runtime._luaPath = system.entryPath;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}
	installProgramModules(runtime, buildModuleProtoMap(programImage.sections.rodata.moduleProtos));
	const prelude = runSystemBuiltinPrelude(runtime, inflateProgram(programImage.sections), metadata, staticModulePaths);
	runtime.programMetadata = prelude.metadata;
	beginEntryExecution(runtime, entryProtoIndex);
	return finishEntryBoot(runtime, options?.runInit);
}

export function bootProgramImage(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const bootingCart = runtime.cartProgramStarted;
	const systemImages = loadProgramImagesForSource(runtime, 'system');
	let programImage = systemImages.program;
	let metadata: ProgramMetadata | null = null;
	if (systemImages.symbols) {
		metadata = systemImages.symbols;
	}
	let entryProtoIndex = systemImages.program.entryProtoIndex;
	let staticModulePaths: ReadonlyArray<string> = systemImages.program.sections.rodata.staticModulePaths;
	runtime.cartEntryProtoIndex = null;
	runtime.cartStaticModulePaths = [];
	if (runtime.cartRomSource) {
		const cartEntry = runtime.cartRomSource.getEntry(PROGRAM_IMAGE_ID);
		if (cartEntry) {
			const cartImages = loadProgramImagesForSource(runtime, 'cart');
			const linked = linkProgramImages(systemImages.program, systemImages.symbols, cartImages.program, cartImages.symbols);
			programImage = linked.programImage;
			metadata = linked.metadata;
			runtime.setLinkedCartEntry(linked.cartEntryProtoIndex, linked.cartStaticModulePaths);
			if (bootingCart) {
				entryProtoIndex = linked.cartEntryProtoIndex;
				staticModulePaths = programImage.sections.rodata.staticModulePaths;
			} else {
				entryProtoIndex = linked.systemEntryProtoIndex;
				staticModulePaths = linked.systemStaticModulePaths;
			}
		}
	}
	runtime.cartEntryAvailable = true;
	installFreshLuaInterpreter(runtime);

	runtime._luaPath = runtime.activeLuaSources.entry_path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	const protoMap = buildModuleProtoMap(programImage.sections.rodata.moduleProtos);
	installProgramModules(runtime, protoMap);

	const inflated = inflateProgram(programImage.sections);
	try {
		runtime.machine.cpu.setProgram(inflated, metadata);
		runtime.programMetadata = metadata;
		applySystemBuiltinGlobals(runtime);
		runStaticModuleInitializers(runtime, staticModulePaths);

		beginEntryExecution(runtime, entryProtoIndex);
		return finishEntryBoot(runtime, options?.runInit);
	} catch (error) {
		console.info('Program-image boot failed.');
		logDebugState(runtime);
		throw error;
	}
}

export function startCartProgram(runtime: Runtime, runInit?: boolean): boolean {
	const entryProtoIndex = runtime.cartEntryProtoIndex;
	if (entryProtoIndex === null) {
		return false;
	}
	runtime.enterCartProgram();
	runtime._luaPath = runtime.activeLuaSources.entry_path;
	runStaticModuleInitializers(runtime, runtime.cartStaticModulePaths);
	beginEntryExecution(runtime, entryProtoIndex);
	return finishEntryBoot(runtime, runInit);
}

export function bootActiveProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const ok = shouldBootLuaProgramFromSources(runtime)
		? bootLuaProgram(runtime, { preserveState: options?.preserveState })
		: bootProgramImage(runtime, options);
	return ok;
}

export function bootLuaProgram(runtime: Runtime, options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
	const entryAsset = resolveLuaSourceRecordFromRegistries(runtime.activeLuaSources.entry_path, [runtime.activeLuaSources]);
	runtime.cartEntryAvailable = !!entryAsset;

	const interpreter = installFreshLuaInterpreter(runtime);
	if (runtime.activeLuaSources === runtime.systemLuaSources && !options?.sourceOverride) {
		return bootSystemSourceProgram(runtime, interpreter, options);
	}

	if (!entryAsset) {
		runtime._luaPath = null;
		return false;
	}
	const path = entryAsset.module_path;
	if (!path || path.length === 0) {
		throw new Error('cannot boot Lua program: entry ROM entry has no path name.');
	}

	runtime._luaPath = path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	try {
		const entryPath = options?.sourceOverride?.path ?? path;
		const entrySource = options?.sourceOverride?.source ?? resourceSourceForChunk(runtime, entryPath);
		const entryChunk = interpreter.compileChunk(entrySource, entryPath);
			const { modules } = buildModuleChunks(runtime, entryPath);
		const { program, metadata, entryProtoIndex, moduleProtoMap, staticModulePaths } = compileLuaChunkToProgram(entryChunk, modules, {
			optLevel: runtime.realtimeCompileOptLevel,
			entrySource: entrySource,
		});
		installProgramModules(runtime, moduleProtoMap);
		const prelude = runSystemBuiltinPrelude(runtime, program, metadata, staticModulePaths);
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

		const reloadPlan = buildRuntimeReloadPlan(runtime);
		await consoleCore.resetRuntime(reloadPlan.resetFreshWorldOptions.preserve_textures);
		consoleCore.bootstrapStartupAudio();
		try {
			runtime.enterCartProgram();
			resetRuntimeState(runtime);
			if (shouldBootLuaProgramFromSources(runtime)) {
				reloadLuaProgramState(runtime, runInit);
			} else {
				bootProgramImage(runtime, { preserveState: true, runInit });
			}
			runtime.applyCartProgramTiming();
			const machine = resolveRuntimeMachineForPlan(runtime, reloadPlan);
			const perfSpecs = getMachinePerfSpecs(machine);
			applyUfpsScaled(runtime, perfSpecs.ufps);
			const cpuHz = perfSpecs.cpu_freq_hz;
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, runtime.timing.ufpsScaled);
			const renderHeight = machine.render_size.height;
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
		runtime.systemLuaSources,
	]);
	if (!binding) {
		return null;
	}
	const cached = workspaceSourceCache.get(binding.source_path);
	if (cached !== undefined) {
		return cached;
	}
	return binding.src;
}

export function listLuaSourceRegistries(runtime: Runtime): Array<{ registry: LuaSourceRegistry; readOnly: boolean }> {
	const registries: Array<{ registry: LuaSourceRegistry; readOnly: boolean }> = [];
	if (runtime.cartLuaSources) {
		registries.push({ registry: runtime.cartLuaSources, readOnly: false });
	}
	registries.push({ registry: runtime.systemLuaSources, readOnly: false });
	return registries;
}

export function resolveModuleRegistries(runtime: Runtime): LuaSourceRegistry[] {
	const registries: LuaSourceRegistry[] = [];
	if (runtime.activeLuaSources) {
		registries.push(runtime.activeLuaSources);
	}
	if (runtime.systemLuaSources && runtime.systemLuaSources !== runtime.activeLuaSources) {
		registries.push(runtime.systemLuaSources);
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
	if (!runtime.moduleProtos.has(moduleName)) {
		throw interpreter.runtimeError(`require('${moduleName}') failed: module not found.`);
	}
	const loaded = interpreter.packageLoadedTable.get(moduleName);
	if (loaded !== undefined && loaded !== null) {
		return loaded;
	}
	interpreter.packageLoadedTable.set(moduleName, true);
	const source = resourceSourceForChunk(runtime, moduleName);
	if (!source) {
		throw interpreter.runtimeError(`require('${moduleName}') failed: module source unavailable.`);
	}
	const chunk = interpreter.compileChunk(source, moduleName);
	const results = interpreter.executeChunk(chunk);
	const value = results.length > 0 ? results[0] : null;
	const cachedValue = value === null ? true : value;
	interpreter.packageLoadedTable.set(moduleName, cachedValue);
	return cachedValue;
}

export function requireModule(runtime: Runtime, moduleName: string): Value {
	const cached = runtime.moduleCache.get(moduleName);
	if (cached !== undefined) {
		return cached;
	}
	const protoIndex = runtime.moduleProtos.get(moduleName);
	if (protoIndex === undefined) {
		throw runtime.createApiRuntimeError(`require('${moduleName}') failed: module not compiled.`);
	}
	runtime.moduleCache.set(moduleName, true);
	const results = runtime.luaScratch.values.acquire();
	let value: Value = null;
	try {
		callClosureInto(runtime, { protoIndex, upvalues: [] }, [], results);
		value = results.length > 0 ? results[0] : null;
	} finally {
		runtime.luaScratch.values.release(results);
	}
	const cachedValue = value === null ? true : value;
	runtime.moduleCache.set(moduleName, cachedValue);
	return cachedValue;
}

function runStaticModuleInitializer(runtime: Runtime, path: string): void {
	if (runtime.moduleCache.has(path)) {
		return;
	}
	const protoIndex = runtime.moduleProtos.get(path);
	if (protoIndex === undefined) {
		throw runtime.createApiRuntimeError(`static module init failed: module '${path}' is not compiled.`);
	}
	runtime.moduleCache.set(path, true);
	const results = runtime.luaScratch.values.acquire();
	try {
		callClosureInto(runtime, { protoIndex, upvalues: [] }, [], results);
	} catch (error) {
		runtime.moduleCache.delete(path);
		throw error;
	} finally {
		runtime.luaScratch.values.release(results);
	}
	runtime.moduleCache.delete(path);
}

export function invalidateModuleLookups(runtime: Runtime): void {
	runtime.pathSemanticCache.clear();
}
