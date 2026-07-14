import { machineManager } from '../../core/machine_manager';
import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { convertToError } from '../../lua/value';
import { getReservedLuaIdentifiers, registerLuaInterpreterBuiltins } from './lua_builtins';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../lua/compiler';
import { linkBootProgramImages } from '../../machine/program/linker';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { RuntimeSymbolEntry, RuntimeSymbolKind } from './symbols';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../lua/source_registry';
import { ROM_GENERATED_CONST_MODULE_PATHS } from '../../rompack/format';
import { logDebugState } from './debug_state';
import { PROGRAM_STATIC_RAM_BASE } from '../../machine/memory/map';
import { resetHandledLuaErrors } from './fault_state';
import {
	decodeProgramImage,
	decodeProgramSymbolsImage,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
	toLuaModulePath,
	type ProgramImage,
	type ProgramSymbolsImage,
} from '../../machine/program/loader';
import type { RawRomSource } from '../../rompack/source';
import { Table, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { asStringId, valueIsString } from '../../machine/cpu/cpu';
import { EMPTY_STATIC_MODULE_PATHS, type Runtime } from '../../machine/runtime/runtime';
import { runtimeSemanticCache } from '../editor/contrib/intellisense/semantic/workspace/runtime';
import { clearHostEvalMetadata } from './host_eval';
import { resolveRuntimeLuaSource } from './sources';

function installFreshLuaInterpreter(runtime: Runtime): LuaInterpreter {
	resetLuaInteroperabilityState();
	const bridge = machineManager.ideState.nativeBridge;
	const interpreter = new LuaInterpreter(bridge.luaJsBridge);
	bridge.luaInterpreter = interpreter;
	interpreter.attachDebugger(machineManager.ideState.debugger.controller);
	interpreter.clearLastFaultEnvironment();
	registerLuaInterpreterBuiltins(interpreter);
	interpreter.setReservedIdentifiers(getReservedLuaIdentifiers());
	runtime.pendingCall = null;
	runtime.luaRuntimeFailed = false;
	runtime.luaInitialized = false;
	runtime.machine.inputController.cancelSampleArm();
	runtime.machine.cpu.clearHaltUntilIrq();
	return interpreter;
}

export function markSourceChunkAsDirty(path: string): void {
	machineManager.sourceState.luaGenericChunksExecuted.delete(path);
}

function resetLuaInteroperabilityState(): void {
	clearHostEvalMetadata();
	machineManager.sourceState.luaGenericChunksExecuted.clear();
	resetHandledLuaErrors();
	machineManager.ideState.nativeBridge.luaFunctionRedirectCache.clear();
}

function describeSymbolValue(value: Value): { kind: RuntimeSymbolKind; valueType: string } {
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

function collectHiddenSymbolPrefixes(): Set<string> {
	const prefixes = new Set<string>();
	const sources = machineManager.sourceState;
	for (let registryIndex = 0; registryIndex < sources.luaSourceRegistries.length; registryIndex += 1) {
		const registry = sources.luaSourceRegistries[registryIndex];
		for (let assetIndex = 0; assetIndex < registry.records.length; assetIndex += 1) {
			prefixes.add(buildSymbolModuleSlotPrefix(registry.records[assetIndex].source_path));
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

export function listSymbols(runtime: Runtime): RuntimeSymbolEntry[] {
	runtime.machine.cpu.syncGlobalSlotsToTable();
	const hiddenPrefixes = collectHiddenSymbolPrefixes();
	const symbolsByName = new Map<string, RuntimeSymbolEntry>();
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

function resolveProgramImageSourceFor(source: 'system' | 'cart'): RawRomSource {
	const sources = machineManager.sourceState;
	if (source === 'system') {
		return sources.systemRomSource;
	}
	if (!sources.cartRomSource) {
		throw new Error('cart ROM source is not configured.');
	}
	return sources.cartRomSource;
}

function loadProgramImagesForSource(source: 'system' | 'cart'): { program: ProgramImage; symbols: ProgramSymbolsImage | null } {
	const romSource = resolveProgramImageSourceFor(source);
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
	entryModulePath: string,
	registries: LuaSourceRegistry[] = machineManager.sourceState.moduleCompileLuaSources,
	interpreter: LuaInterpreter = machineManager.ideState.nativeBridge.luaInterpreter,
): { modules: Array<{ path: string; chunk: LuaChunk; source: string }> } {
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	const seen = new Set<string>();
	for (const registry of registries) {
		for (const asset of registry.records) {
			const key = asset.module_path;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			if (key === entryModulePath) {
				continue;
			}
			const source = readWorkspaceLuaSourceText(registry, asset);
			const chunk = interpreter.compileChunk(source, key);
			modules.push({ path: key, chunk, source });
		}
	}
	return { modules };
}

function compileRegistryProgramImage(
	registry: LuaSourceRegistry,
	interpreter: LuaInterpreter,
	externalModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }> = [],
): { image: ProgramImage; symbols: ProgramSymbolsImage; entryPath: string; modules: Array<{ path: string; chunk: LuaChunk; source: string }> } {
	const entryRecord = resolveLuaSourceRecord(registry, registry.entry_path);
	if (entryRecord === null) {
		throw new Error(`cannot compile boot program: entry Lua source '${registry.entry_path}' is missing.`);
	}
	const entryPath = entryRecord.module_path;
	const entrySource = readWorkspaceLuaSourceText(registry, entryRecord);
	const entryChunk = interpreter.compileChunk(entrySource, entryPath);
	const { modules } = buildModuleChunks(entryPath, [registry], interpreter);
	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel: machineManager.sourceState.realtimeCompileOptLevel,
		entrySource,
		externalModules,
		constModulePaths: ROM_GENERATED_CONST_MODULE_PATHS,
	});
	return {
		image: encodeCompiledProgramImage(compiled),
		symbols: compiled.metadata,
		entryPath,
		modules,
	};
}

function bootSystemSourceProgram(runtime: Runtime, interpreter: LuaInterpreter, preserveState = false): boolean {
	const sources = machineManager.sourceState;
	const system = compileRegistryProgramImage(sources.systemLuaSources, interpreter);
	runtime.clearLinkedCartProgram(system.image.sections.data.bytes.byteLength);
	let cartProgramImage: ProgramImage | null = null;
	let cartSymbols: ProgramSymbolsImage | null = null;
	if (sources.cartLuaSources?.can_boot_from_source) {
		const cart = compileRegistryProgramImage(sources.cartLuaSources, interpreter, system.modules);
		cartProgramImage = cart.image;
		cartSymbols = cart.symbols;
	} else if (sources.cartRomSource && sources.cartRomSource.getEntry(PROGRAM_IMAGE_ID)) {
		const cart = loadProgramImagesForSource('cart');
		cartProgramImage = cart.program;
		cartSymbols = cart.symbols;
	}
	machineManager.sourceState.currentPath = system.entryPath;
	if (!preserveState) {
		runtime.resetRuntimeForProgramReload();
	}
	runtime.moduleCache.clear();
	runtime.cartEntryAvailable = cartProgramImage !== null;
	if (cartProgramImage) {
		runtime.bootLinkedProgramImage(linkBootProgramImages(system.image, system.symbols, cartProgramImage, cartSymbols, 'system'));
		return true;
	}
	runtime.boot(system.image, system.symbols, system.image.vectors, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + system.image.sections.data.bytes.byteLength, system.image.sections.rodata.staticModulePaths, EMPTY_STATIC_MODULE_PATHS);
	return true;
}

function bootProgramImage(runtime: Runtime, preserveState = false): boolean {
	const bootingCart = runtime.cartProgramStarted;
	const systemImages = loadProgramImagesForSource('system');
	runtime.clearLinkedCartProgram(systemImages.program.sections.data.bytes.byteLength);
	installFreshLuaInterpreter(runtime);

	machineManager.sourceState.currentPath = machineManager.sourceState.activeLuaSources.entry_path;
	if (!preserveState) {
		runtime.resetRuntimeForProgramReload();
	}

	runtime.moduleCache.clear();

	try {
		const sources = machineManager.sourceState;
		if (sources.cartRomSource) {
			const cartEntry = sources.cartRomSource.getEntry(PROGRAM_IMAGE_ID);
			if (cartEntry) {
				const cartImages = loadProgramImagesForSource('cart');
				runtime.bootLinkedProgramImage(linkBootProgramImages(systemImages.program, systemImages.symbols, cartImages.program, cartImages.symbols, bootingCart ? 'cart' : 'system'));
				return true;
			}
		}
		runtime.cartEntryAvailable = false;
		runtime.boot(systemImages.program, systemImages.symbols, systemImages.program.vectors, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + systemImages.program.sections.data.bytes.byteLength, systemImages.program.sections.rodata.staticModulePaths, EMPTY_STATIC_MODULE_PATHS);
		return true;
	} catch (error) {
		console.info('Program-image boot failed.');
		logDebugState(runtime);
		throw error;
	}
}

export function bootActiveProgram(runtime: Runtime, preserveState = false): boolean {
	return machineManager.sourceState.activeLuaSources.can_boot_from_source
		? bootLuaProgram(runtime, { preserveState })
		: bootProgramImage(runtime, preserveState);
}

function bootLuaProgram(runtime: Runtime, options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
	const sources = machineManager.sourceState;
	const entryRecord = resolveLuaSourceRecord(sources.activeLuaSources, sources.activeLuaSources.entry_path);

	const interpreter = installFreshLuaInterpreter(runtime);
	if (sources.activeLuaSources === sources.systemLuaSources && !options?.sourceOverride) {
		return bootSystemSourceProgram(runtime, interpreter, !!options?.preserveState);
	}

	if (entryRecord === null) {
		runtime.cartEntryAvailable = false;
		machineManager.sourceState.currentPath = sources.activeLuaSources.entry_path;
		return false;
	}
	const path = entryRecord.module_path;
	if (!path || path.length === 0) {
		throw new Error('cannot boot Lua program: entry ROM entry has no path name.');
	}

	machineManager.sourceState.currentPath = path;
	if (!options?.preserveState) {
		runtime.resetRuntimeForProgramReload();
	}
	runtime.cartEntryAvailable = true;

	try {
		const entryPath = options?.sourceOverride?.path ?? path;
		const entrySource = options?.sourceOverride?.source ?? readWorkspaceLuaSourceText(sources.activeLuaSources, entryRecord);
		const entryModulePath = options?.sourceOverride ? toLuaModulePath(entryPath) : path;
		const entryChunk = interpreter.compileChunk(entrySource, entryPath);
		const { modules } = buildModuleChunks(entryModulePath);
		const compiled = compileLuaChunkToProgram(entryChunk, modules, {
			optLevel: machineManager.sourceState.realtimeCompileOptLevel,
			entrySource,
			constModulePaths: ROM_GENERATED_CONST_MODULE_PATHS,
		});
		const programImage = encodeCompiledProgramImage(compiled);
		runtime.moduleCache.clear();
		runtime.boot(programImage, compiled.metadata, programImage.vectors, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + programImage.sections.data.bytes.byteLength, EMPTY_STATIC_MODULE_PATHS, programImage.sections.rodata.staticModulePaths);
		return true;
	} catch (error) {
		logDebugState(runtime);
		throw convertToError(error);
	}
}

export function resourceSourceForChunk(path: string): string {
	const luaSource = resolveRuntimeLuaSource(machineManager.sourceState, path);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}

export function refreshLuaHandlersForChunk(path: string, sourceOverride?: string): void {
	machineManager.sourceState.luaGenericChunksExecuted.delete(path);
	reloadGenericLuaChunk(path, sourceOverride);
	machineManager.ideState.editor.clearNativeMemberCompletionCache();
}

function reloadGenericLuaChunk(path: string, sourceOverride?: string): void {
	const source = sourceOverride ?? resourceSourceForChunk(path);
	machineManager.ideState.nativeBridge.luaInterpreter.compileChunk(source, path);
	machineManager.sourceState.luaGenericChunksExecuted.add(path);
}


export function invalidateModuleLookups(): void {
	runtimeSemanticCache.clear();
}
