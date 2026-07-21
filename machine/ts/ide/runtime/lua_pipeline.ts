import { machineManager } from '../../core/machine_manager';
import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { getReservedLuaIdentifiers, registerLuaInterpreterBuiltins } from './lua_builtins';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type ProgramCompileDomain } from '../../lua/compiler';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { RuntimeSymbolEntry, RuntimeSymbolKind } from './symbols';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../lua/source_registry';
import { logDebugState } from './debug_state';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/memory/map';
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
import { Table, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import { asStringId, valueIsNumber, valueIsString } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';
import { installRuntimeRomLayers, resolveRuntimeLuaSource } from './sources';
import { LogLevel } from '../../platform/platform';
import { linkCartProgramImage, linkSystemProgramImage } from '../../rompack/tooling/program_linker';
import { buildProgramTail } from '../../rompack/tooling/program_tail';
import type { RomSourceLayer } from '../../rompack/source';

export type RebuiltProgram = {
	object: ReturnType<typeof encodeCompiledProgramObject>;
	objectMetadata: ProgramSymbolsImage;
	image: ProgramImage;
	mediaMetadata: ProgramSymbolsImage;
	programAddress: number;
	sources: ReadonlyMap<string, string>;
};

export type RebuiltProgramMedia = {
	system: RebuiltProgram | null;
	cart: RebuiltProgram | null;
};

function installFreshLuaInterpreter(runtime: Runtime): LuaInterpreter {
	resetHandledLuaErrors();
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

function describeSymbolValue(value: Value): { kind: RuntimeSymbolKind; valueType: string } {
	switch (value) {
		case null:
			return { kind: 'constant', valueType: 'nil' };
		case false:
		case true:
			return { kind: 'constant', valueType: 'boolean' };
	}
	if (valueIsNumber(value)) {
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

function shouldHideGeneratedModuleSymbolName(name: string, hiddenPrefixes: ReadonlySet<string>): boolean {
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
		if (shouldHideGeneratedModuleSymbolName(name, hiddenPrefixes) || symbolsByName.has(name)) {
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

export function loadProgramImagesForSource(source: 'system' | 'cart'): { program: ProgramImage; symbols: ProgramSymbolsImage | null } {
	const sources = machineManager.sourceState;
	const romSource = source === 'system' ? sources.systemRomSource : sources.cartRomSource!;
	const programEntry = romSource.getEntry(PROGRAM_IMAGE_ID)!;
	const program = decodeProgramImage(
		romSource.getBytesView(programEntry),
		romSource.getCompiledBytesView(programEntry),
	);
	const symbolsEntry = romSource.getEntry(PROGRAM_SYMBOLS_IMAGE_ID);
	let symbols: ProgramSymbolsImage | null = null;
	if (symbolsEntry) {
		symbols = decodeProgramSymbolsImage(romSource.getBytesView(symbolsEntry));
	}
	return { program, symbols };
}

function buildModuleChunks(
	entryModulePath: string,
	registries: LuaSourceRegistry[],
	interpreter: LuaInterpreter,
): Array<{ path: string; chunk: LuaChunk; source: string }> {
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
	return modules;
}

function compileRegistryProgramObject(
	registry: LuaSourceRegistry,
	interpreter: LuaInterpreter,
	programDomain: ProgramCompileDomain,
	externalModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }>,
): { object: ReturnType<typeof encodeCompiledProgramObject>; metadata: ProgramSymbolsImage; modules: Array<{ path: string; chunk: LuaChunk; source: string }>; sources: ReadonlyMap<string, string> } {
	const entryRecord = resolveLuaSourceRecord(registry, registry.entry_path);
	if (entryRecord === null) {
		throw new Error(`cannot compile boot program: entry Lua source '${registry.entry_path}' is missing.`);
	}
	const entryPath = entryRecord.module_path;
	const entrySource = readWorkspaceLuaSourceText(registry, entryRecord);
	const entryChunk = interpreter.compileChunk(entrySource, entryPath);
	const modules = buildModuleChunks(entryPath, [registry], interpreter);
	const sources = new Map<string, string>();
	sources.set(entryPath, entrySource);
	for (let index = 0; index < modules.length; index += 1) {
		sources.set(modules[index].path, modules[index].source);
	}
	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel: machineManager.sourceState.realtimeCompileOptLevel,
		entrySource,
		externalModules,
		programDomain,
	});
	return {
		object: encodeCompiledProgramObject(compiled),
		metadata: compiled.metadata,
		modules,
		sources,
	};
}

export function buildProgramMedia(
	interpreter: LuaInterpreter,
	rebuildSystem: boolean,
	rebuildCart: boolean,
): RebuiltProgramMedia {
	const sources = machineManager.sourceState;
	const systemRegistry = sources.systemLuaSources;
	const cartRegistry = sources.cartLuaSources;
	const cartRegistryToBuild = rebuildSystem || rebuildCart ? cartRegistry : null;
	let system: ReturnType<typeof loadProgramImagesForSource>;
	let rebuiltSystem: RebuiltProgramMedia['system'] = null;
	let rebuiltCart: RebuiltProgramMedia['cart'] = null;
	let systemModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }> = [];
	if (rebuildSystem) {
		const compiledSystem = compileRegistryProgramObject(systemRegistry, interpreter, 'system', []);
		const systemProgramEntry = sources.systemRomSource.getEntry(PROGRAM_IMAGE_ID)!;
		const programAddress = SYSTEM_ROM_BASE + systemProgramEntry.start!;
		const linkedSystem = linkSystemProgramImage(
			compiledSystem.object,
			compiledSystem.metadata,
			programAddress,
		);
		system = { program: linkedSystem.image, symbols: linkedSystem.metadata };
		rebuiltSystem = {
			object: compiledSystem.object,
			objectMetadata: compiledSystem.metadata,
			image: linkedSystem.image,
			mediaMetadata: linkedSystem.metadata!,
			programAddress,
			sources: compiledSystem.sources,
		};
		systemModules = compiledSystem.modules;
	} else {
		system = loadProgramImagesForSource('system');
		if (cartRegistryToBuild !== null) {
			const systemEntry = resolveLuaSourceRecord(systemRegistry, systemRegistry.entry_path)!;
			systemModules = buildModuleChunks(systemEntry.module_path, [systemRegistry], interpreter);
		}
	}

	if (cartRegistryToBuild !== null) {
		const compiledCart = compileRegistryProgramObject(cartRegistryToBuild, interpreter, 'cart', systemModules);
		const cartProgramEntry = sources.cartRomSource!.getEntry(PROGRAM_IMAGE_ID)!;
		const programAddress = CART_ROM_BASE + cartProgramEntry.start!;
		const linkedCart = linkCartProgramImage(
			system.program,
			system.symbols,
			compiledCart.object,
			compiledCart.metadata,
			programAddress,
		);
		rebuiltCart = {
			object: compiledCart.object,
			objectMetadata: compiledCart.metadata,
			image: linkedCart.image,
			mediaMetadata: linkedCart.metadata!,
			programAddress,
			sources: compiledCart.sources,
		};
	}
	return { system: rebuiltSystem, cart: rebuiltCart };
}

export function installProgramMedia(runtime: Runtime, rebuilt: RebuiltProgramMedia): void {
	const sources = machineManager.sourceState;
	let systemLayer: RomSourceLayer | null = null;
	let cartLayer: RomSourceLayer | null = null;
	if (rebuilt.system !== null) {
		systemLayer = buildProgramTail(sources.systemRom, rebuilt.system.image, rebuilt.system.mediaMetadata);
	}
	if (rebuilt.cart !== null) {
		cartLayer = buildProgramTail(sources.cartRom!, rebuilt.cart.image, rebuilt.cart.mediaMetadata);
	}
	installRuntimeRomLayers(
		sources,
		systemLayer,
		cartLayer,
	);
	if (systemLayer !== null) {
		runtime.machine.memory.systemRom = systemLayer.payload;
		sources.systemProgramSources = rebuilt.system!.sources;
		sources.systemProgramMediaDirty = false;
	}
	if (cartLayer !== null) {
		runtime.machine.memory.cartRom = cartLayer.payload;
		sources.cartProgramSources = rebuilt.cart!.sources;
		sources.cartProgramMediaDirty = false;
	}
}

function bootProgramImages(runtime: Runtime): boolean {
	const system = loadProgramImagesForSource('system');
	let cartProgram: ProgramImage | null = null;
	let cartSymbols: ProgramSymbolsImage | null = null;
	const sources = machineManager.sourceState;
	if (sources.cartRomSource?.getEntry(PROGRAM_IMAGE_ID)) {
		const cart = loadProgramImagesForSource('cart');
		cartProgram = cart.program;
		cartSymbols = cart.symbols;
	}
	sources.currentPath = sources.activeLuaSources.entry_path;
	runtime.resetRuntimeForProgramReload();
	try {
		runtime.boot(
			system.program,
			system.symbols,
			cartProgram,
			cartSymbols,
			'system',
		);
		return true;
	} catch (error) {
		machineManager.platform.log(LogLevel.Error, 'Program-image boot failed.');
		logDebugState(runtime, machineManager.platform);
		throw error;
	}
}

export function bootActiveProgram(runtime: Runtime, rebuildProgramMedia: boolean): boolean {
	const interpreter = installFreshLuaInterpreter(runtime);
	if (rebuildProgramMedia) {
		const sources = machineManager.sourceState;
		installProgramMedia(runtime, buildProgramMedia(
			interpreter,
			sources.systemProgramMediaDirty,
			sources.cartProgramMediaDirty,
		));
	}
	return bootProgramImages(runtime);
}

export function resourceSourceForChunk(path: string): string {
	const luaSource = resolveRuntimeLuaSource(machineManager.sourceState, path);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
