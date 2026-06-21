import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { convertToError } from '../../lua/value';
import type { LuaValue } from '../../lua/value';
import { seedLuaGlobals } from '../../machine/firmware/globals';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/program/compiler';
import { inflateExecutableProgramImage, linkBootProgramImages } from '../../machine/program/linker';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import { SymbolEntry, SymbolKind } from '../../machine/runtime/contracts';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../machine/program/sources';
import { ROM_ASSET_SYMBOL_MODULE_PATH } from '../../rompack/asset_symbols';
import { logDebugState } from '../../machine/runtime/debug';
import { addTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import { PROGRAM_BSS_BASE } from '../../machine/memory/map';
import { resetHandledLuaErrors } from './fault_state';
import {
	buildModuleProtoMap,
	decodeProgramImage,
	decodeProgramSymbolsImage,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
	toLuaModulePath,
	type ProgramImage,
	type ProgramSymbolsImage,
} from '../../machine/program/loader';
import type { RawRomSource } from '../../rompack/source';
import { Table, type ProgramMetadata, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { asStringId, valueIsString } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';

export function replaceMapEntries<TKey, TValue>(target: Map<TKey, TValue>, entries: Iterable<[TKey, TValue]>): void {
	target.clear();
	for (const [key, value] of entries) {
		target.set(key, value);
	}
}

function installFreshLuaInterpreter(runtime: Runtime): LuaInterpreter {
	resetLuaInteroperabilityState(runtime);
	const interpreter = runtime.createLuaInterpreter();
	runtime.assignInterpreter(interpreter);
	return interpreter;
}

function installProgramModules(runtime: Runtime, moduleProtos: Iterable<[string, number]>): void {
	replaceMapEntries(runtime.moduleProtos, moduleProtos);
	runtime.moduleCache.clear();
	runtime.machine.vdp.resetIngressState();
}

export function clearEditorCompletionCache(runtime: Runtime): void {
	const editor = runtime.editor;
	if (!editor) {
		return;
	}
	editor.clearNativeMemberCompletionCache();
}

export function markSourceChunkAsDirty(runtime: Runtime, path: string): void {
	runtime.luaGenericChunksExecuted.delete(path);
}

function resetLuaInteroperabilityState(runtime: Runtime): void {
	runtime.luaGenericChunksExecuted.clear();
	resetHandledLuaErrors(runtime);
	runtime.luaFunctionRedirectCache.clear();
}

export function resetRuntimeState(runtime: Runtime): void {
	runtime.frameLoop.resetFrameState();
	runtime.pendingCall = null;
	runtime.cartBoot.reset();
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

export function resetHardwareState(runtime: Runtime): void {
	runtime.machine.resetDevices();
	runtime.vblank.reset();
}

function describeSymbolValue(value: Value): { kind: SymbolKind; valueType: string } {
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

function resolveProgramImageSourceFor(runtime: Runtime, source: 'system' | 'cart'): RawRomSource {
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

function loadProgramImagesForSource(runtime: Runtime, source: 'system' | 'cart'): { program: ProgramImage; symbols: ProgramSymbolsImage | null } {
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
	entryModulePath: string,
	registries?: LuaSourceRegistry[],
	interpreter: LuaInterpreter = runtime.interpreter,
): { modules: Array<{ path: string; chunk: LuaChunk; source: string }> } {
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
	runtime: Runtime,
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
	const { modules } = buildModuleChunks(runtime, entryPath, [registry], interpreter);
	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource,
		externalModules,
		constModulePaths: [ROM_ASSET_SYMBOL_MODULE_PATH],
	});
	return {
		image: encodeCompiledProgramImage(compiled),
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
	let sectionInitProtoIndex = system.image.sectionInitProtoIndex;
	let staticModulePaths: ReadonlyArray<string> = system.image.sections.rodata.staticModulePaths;
	runtime.cartEntryProtoIndex = null;
	runtime.cartSectionInitProtoIndex = null;
	runtime.cartBssBaseAddress = null;
	runtime.programBssBaseAddress = PROGRAM_BSS_BASE;
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
		const linked = linkBootProgramImages(system.image, system.symbols, cartProgramImage, cartSymbols, 'system');
		programImage = linked.programImage;
		metadata = linked.metadata;
		entryProtoIndex = linked.entryProtoIndex;
		sectionInitProtoIndex = linked.sectionInitProtoIndex;
		staticModulePaths = linked.staticModulePaths;
		runtime.programBssBaseAddress = linked.bssBaseAddress;
		runtime.setLinkedCartEntry(linked.cartEntryProtoIndex, linked.cartSectionInitProtoIndex, linked.cartBssBaseAddress, linked.cartStaticModulePaths);
	}
	runtime.cartEntryAvailable = true;
	runtime._luaPath = system.entryPath;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}
	installProgramModules(runtime, buildModuleProtoMap(programImage.sections.rodata.moduleProtos));
	const program = inflateExecutableProgramImage(programImage, metadata, runtime.programBssBaseAddress);
	runtime.machine.cpu.setProgram(program, metadata);
	runtime.programMetadata = metadata;
	runtime.startLoadedProgram(entryProtoIndex, sectionInitProtoIndex, staticModulePaths, options?.runInit !== false, true);
	return true;
}

function bootProgramImage(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	const bootingCart = runtime.cartProgramStarted;
	const systemImages = loadProgramImagesForSource(runtime, 'system');
	let programImage = systemImages.program;
	let metadata: ProgramMetadata | null = systemImages.symbols;
	let entryProtoIndex = systemImages.program.entryProtoIndex;
	let sectionInitProtoIndex = systemImages.program.sectionInitProtoIndex;
	let staticModulePaths: ReadonlyArray<string> = systemImages.program.sections.rodata.staticModulePaths;
	runtime.cartEntryProtoIndex = null;
	runtime.cartSectionInitProtoIndex = null;
	runtime.cartBssBaseAddress = null;
	runtime.programBssBaseAddress = PROGRAM_BSS_BASE;
	runtime.cartStaticModulePaths = [];
	if (runtime.cartRomSource) {
		const cartEntry = runtime.cartRomSource.getEntry(PROGRAM_IMAGE_ID);
		if (cartEntry) {
			const cartImages = loadProgramImagesForSource(runtime, 'cart');
			const linked = linkBootProgramImages(systemImages.program, systemImages.symbols, cartImages.program, cartImages.symbols, bootingCart ? 'cart' : 'system');
			programImage = linked.programImage;
			metadata = linked.metadata;
			entryProtoIndex = linked.entryProtoIndex;
			sectionInitProtoIndex = linked.sectionInitProtoIndex;
			staticModulePaths = linked.staticModulePaths;
			runtime.programBssBaseAddress = linked.bssBaseAddress;
			runtime.setLinkedCartEntry(linked.cartEntryProtoIndex, linked.cartSectionInitProtoIndex, linked.cartBssBaseAddress, linked.cartStaticModulePaths);
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

	const inflated = inflateExecutableProgramImage(programImage, metadata, runtime.programBssBaseAddress);
	try {
		runtime.machine.cpu.setProgram(inflated, metadata);
		runtime.programMetadata = metadata;
		runtime.startLoadedProgram(entryProtoIndex, sectionInitProtoIndex, staticModulePaths, options?.runInit !== false, true);
		return true;
	} catch (error) {
		console.info('Program-image boot failed.');
		logDebugState(runtime);
		throw error;
	}
}

export function bootActiveProgram(runtime: Runtime, options?: { preserveState?: boolean; runInit?: boolean }): boolean {
	return runtime.activeLuaSources.can_boot_from_source
		? bootLuaProgram(runtime, { preserveState: options?.preserveState })
		: bootProgramImage(runtime, options);
}

function bootLuaProgram(runtime: Runtime, options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
	const entryRecord = resolveLuaSourceRecord(runtime.activeLuaSources, runtime.activeLuaSources.entry_path);
	runtime.cartEntryAvailable = entryRecord !== null;

	const interpreter = installFreshLuaInterpreter(runtime);
	if (runtime.activeLuaSources === runtime.systemLuaSources && !options?.sourceOverride) {
		return bootSystemSourceProgram(runtime, interpreter, options);
	}

	if (entryRecord === null) {
		runtime._luaPath = null;
		return false;
	}
	const path = entryRecord.module_path;
	if (!path || path.length === 0) {
		throw new Error('cannot boot Lua program: entry ROM entry has no path name.');
	}

	runtime._luaPath = path;
	if (!options?.preserveState) {
		resetRuntimeState(runtime);
	}

	try {
		const entryPath = options?.sourceOverride?.path ?? path;
		const entrySource = options?.sourceOverride?.source ?? readWorkspaceLuaSourceText(runtime.activeLuaSources, entryRecord);
		const entryModulePath = options?.sourceOverride ? toLuaModulePath(entryPath) : path;
		const entryChunk = interpreter.compileChunk(entrySource, entryPath);
		const { modules } = buildModuleChunks(runtime, entryModulePath);
		const compiled = compileLuaChunkToProgram(entryChunk, modules, {
			optLevel: runtime.realtimeCompileOptLevel,
			entrySource,
			constModulePaths: [ROM_ASSET_SYMBOL_MODULE_PATH],
		});
		const programImage = encodeCompiledProgramImage(compiled);
		runtime.programBssBaseAddress = PROGRAM_BSS_BASE;
		const program = inflateExecutableProgramImage(programImage, compiled.metadata, runtime.programBssBaseAddress);
		installProgramModules(runtime, buildModuleProtoMap(programImage.sections.rodata.moduleProtos));
		runtime.machine.cpu.setProgram(program, compiled.metadata);
		runtime.programMetadata = compiled.metadata;
		runtime.startLoadedProgram(programImage.entryProtoIndex, programImage.sectionInitProtoIndex, programImage.sections.rodata.staticModulePaths, true, true);
		return true;
	}
	catch (error) {
		console.error(`Lua boot '${path}' failed.`);
		logDebugState(runtime);
		throw convertToError(error);
	}
}

export function resourceSourceForChunk(runtime: Runtime, path: string): string {
	const luaSource = runtime.resolveLuaSource(path);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}

export function listLuaSourceRegistries(runtime: Runtime): LuaSourceRegistry[] {
	const registries: LuaSourceRegistry[] = [];
	if (runtime.cartLuaSources) {
		registries.push(runtime.cartLuaSources);
	}
	registries.push(runtime.systemLuaSources);
	return registries;
}

function resolveModuleRegistries(runtime: Runtime): LuaSourceRegistry[] {
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
}

function reloadGenericLuaChunk(runtime: Runtime, path: string, sourceOverride?: string): void {
	const source = sourceOverride ?? resourceSourceForChunk(runtime, path);
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
	const chunk = interpreter.compileChunk(source, moduleName);
	const results = interpreter.executeChunk(chunk);
	const value = results.length > 0 ? results[0] : null;
	const cachedValue = value === null ? true : value;
	interpreter.packageLoadedTable.set(moduleName, cachedValue);
	return cachedValue;
}

export function invalidateModuleLookups(runtime: Runtime): void {
	runtime.pathSemanticCache.clear();
}
