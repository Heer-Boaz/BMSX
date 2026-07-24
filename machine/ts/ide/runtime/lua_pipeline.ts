import { machineManager } from '../../core/machine_manager';
import type { LuaChunk } from '../../lua/syntax/ast';
import { LuaInterpreter } from '../../lua/runtime';
import { getReservedLuaIdentifiers, registerLuaInterpreterBuiltins } from './lua_builtins';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type ProgramCompileDomain } from '../../lua/compiler';
import type { ProgramMetadata } from '../../lua/compiler/program';
import type { ProgramObjectImage } from '../../lua/compiler/program_object';
import { toLuaModulePath } from '../../lua/module_path';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { RuntimeSymbolEntry, RuntimeSymbolKind } from './symbols';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../lua/source_registry';
import { logDebugState } from './debug_state';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/memory/map';
import { resetHandledLuaErrors } from './fault_state';
import {
	BLUA32_IMAGE_ID,
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32Image,
	type Blua32ImageLayout,
} from '../../machine/cpu/blua32_image';
import {
	decodeBlua32SymbolsImage,
	type Blua32SymbolsImage,
} from '../../machine/cpu/blua32_symbols';
import { Table, type Value, isNativeFunction, isNativeObject } from '../../machine/cpu/cpu';
import type { Blua32MediaSymbols } from '../../machine/cpu/blua32_symbols';
import { asStringId, valueIsNumber, valueIsString } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';
import {
	installRuntimeRomLayers,
	resolveRuntimeLuaSource,
} from './sources';
import { LogLevel } from '../../platform/platform';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
} from '../../rompack/tooling/blua32_linker';
import { buildBlua32Tail } from '../../rompack/tooling/blua32_tail';
import type { RawRomSource, RomSourceLayer } from '../../rompack/source';

export type RebuiltBlua32Image = {
	linked: LinkedBlua32Image;
	previousImage: Blua32ImageLayout;
	previousSymbols: Blua32SymbolsImage;
	sources: ReadonlyMap<string, string>;
};

export type RebuiltBlua32Media = {
	system: RebuiltBlua32Image | null;
	cartridgeSlots: [RebuiltBlua32Image | null, RebuiltBlua32Image | null];
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

export function loadBlua32Image(
	romSource: RawRomSource,
	romBaseAddress: number,
	imageOffset: number,
): { image: Blua32ImageLayout; symbols: Blua32SymbolsImage | null } {
	const imageEntry = romSource.getEntry(BLUA32_IMAGE_ID)!;
	const image = decodeBlua32Image(
		romSource.getBytesView(imageEntry),
		romBaseAddress + imageOffset,
	);
	const symbolsEntry = romSource.getEntry(BLUA32_SYMBOLS_IMAGE_ID);
	let symbols: Blua32SymbolsImage | null = null;
	if (symbolsEntry) {
		symbols = decodeBlua32SymbolsImage(romSource.getBytesView(symbolsEntry));
	}
	return { image, symbols };
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
): {
	object: ProgramObjectImage;
	metadata: ProgramMetadata;
	modules: Array<{ path: string; chunk: LuaChunk; source: string }>;
	sources: ReadonlyMap<string, string>;
} {
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

export function buildBlua32Media(
	interpreter: LuaInterpreter,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): RebuiltBlua32Media {
	const sources = machineManager.sourceState;
	const systemRegistry = sources.systemLuaSources;
	const cartridgeImageOffsets: [number, number] = [0, 0];
	let rebuildAnyCartridge = false;
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		const imageOffset = cartridge ? cartridge.rom.header.blua32ImageOffset : 0;
		if (imageOffset && (rebuildSystem || rebuildCartridgeSlots[slot])) {
			cartridgeImageOffsets[slot] = imageOffset;
			rebuildAnyCartridge = true;
		}
	}
	const installedSystem = loadBlua32Image(
		sources.systemRomSource,
		SYSTEM_ROM_BASE,
		sources.systemRom.header.blua32ImageOffset,
	);
	let systemImage = installedSystem.image;
	let systemSymbols = installedSystem.symbols;
	let rebuiltSystem: RebuiltBlua32Image | null = null;
	let systemModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }> = [];
	if (rebuildSystem) {
		const compiledSystem = compileRegistryProgramObject(systemRegistry, interpreter, 'system', []);
		const linked = linkSystemBlua32Image(
			compiledSystem.object,
			compiledSystem.metadata,
			SYSTEM_ROM_BASE + sources.systemRom.header.blua32ImageOffset,
			{ image: installedSystem.image, symbols: installedSystem.symbols! },
		);
		systemImage = linked.layout;
		systemSymbols = linked.symbols;
		rebuiltSystem = {
			linked,
			previousImage: installedSystem.image,
			previousSymbols: installedSystem.symbols!,
			sources: compiledSystem.sources,
		};
		systemModules = compiledSystem.modules;
	} else if (rebuildAnyCartridge) {
		const systemEntry = resolveLuaSourceRecord(systemRegistry, systemRegistry.entry_path)!;
		systemModules = buildModuleChunks(systemEntry.module_path, [systemRegistry], interpreter);
	}

	const rebuiltCartridgeSlots: [RebuiltBlua32Image | null, RebuiltBlua32Image | null] = [null, null];
	if (rebuildAnyCartridge && systemSymbols === null) {
		throw new Error('Cartridge BLua32 linking requires system symbols.');
	}
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const imageOffset = cartridgeImageOffsets[slot];
		if (!imageOffset) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		const compiled = compileRegistryProgramObject(
			cartridge.luaSources,
			interpreter,
			'cart',
			systemModules,
		);
		const imageAddress = CART_ROM_BASE + imageOffset;
		const installed = loadBlua32Image(cartridge.romSource, CART_ROM_BASE, imageOffset);
		const linked = linkCartBlua32Image(
			systemImage,
			systemSymbols,
			compiled.object,
			compiled.metadata,
			imageAddress,
			{ image: installed.image, symbols: installed.symbols! },
		);
		rebuiltCartridgeSlots[slot] = {
			linked,
			previousImage: installed.image,
			previousSymbols: installed.symbols!,
			sources: compiled.sources,
		};
	}
	return {
		system: rebuiltSystem,
		cartridgeSlots: rebuiltCartridgeSlots,
	};
}

export function installBlua32Media(runtime: Runtime, rebuilt: RebuiltBlua32Media): void {
	const sources = machineManager.sourceState;
	let systemLayer: RomSourceLayer | null = null;
	const cartridgeLayers: [RomSourceLayer | null, RomSourceLayer | null] = [null, null];
	if (rebuilt.system !== null) {
		systemLayer = buildBlua32Tail(sources.systemRom, rebuilt.system.linked);
	}
	for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
		const image = rebuilt.cartridgeSlots[slot];
		if (image !== null) {
			cartridgeLayers[slot] = buildBlua32Tail(sources.cartridgeSlots[slot]!.rom, image.linked);
		}
	}
	installRuntimeRomLayers(sources, systemLayer, cartridgeLayers);
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.payload);
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		sources.systemBlua32MediaDirty = false;
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		runtime.machine.memory.cartridgeController.installRom(slot, layer.payload);
		sources.cartridgeSlots[slot]!.installedBlua32Sources = rebuilt.cartridgeSlots[slot]!.sources;
		sources.cartridgeBlua32MediaDirty[slot] = false;
	}
}

export function loadBlua32MediaSymbols(): Blua32MediaSymbols {
	const sources = machineManager.sourceState;
	const system = loadBlua32Image(
		sources.systemRomSource,
		SYSTEM_ROM_BASE,
		sources.systemRom.header.blua32ImageOffset,
	);
	const cartridgeSymbols: [Blua32SymbolsImage | null, Blua32SymbolsImage | null] = [null, null];
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (cartridge && cartridge.rom.header.blua32ImageOffset) {
			cartridgeSymbols[slot] = loadBlua32Image(
				cartridge.romSource,
				CART_ROM_BASE,
				cartridge.rom.header.blua32ImageOffset,
			).symbols;
		}
	}
	return {
		system: system.symbols,
		cartridgeSlots: cartridgeSymbols,
	};
}

export function bootActiveBlua32Media(runtime: Runtime, rebuildBlua32Media: boolean): void {
	const interpreter = installFreshLuaInterpreter(runtime);
	if (rebuildBlua32Media) {
		const sources = machineManager.sourceState;
		installBlua32Media(runtime, buildBlua32Media(
			interpreter,
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
		));
	}
	const sources = machineManager.sourceState;
	sources.currentPath = sources.activeLuaSources.entry_path;
	runtime.resetForSystemBoot();
	try {
		runtime.boot(loadBlua32MediaSymbols());
	} catch (error) {
		machineManager.platform.log(LogLevel.Error, 'BLua32 boot failed.');
		logDebugState(runtime, machineManager.platform);
		throw error;
	}
}

export function resourceSourceForChunk(path: string): string {
	const luaSource = resolveRuntimeLuaSource(machineManager.sourceState, path);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
