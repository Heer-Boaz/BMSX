import type { LuaChunk } from '../../machine/ts/lua/syntax/ast/index';
import { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import { getReservedLuaIdentifiers, registerLuaInterpreterBuiltins } from './lua_builtins';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type ProgramCompileDomain } from '../../machine/ts/lua/compiler';
import type { ProgramMetadata } from '../../machine/ts/lua/compiler/program';
import type { ProgramObjectImage } from '../../machine/ts/lua/compiler/program_object';
import { toLuaModulePath } from '../../machine/ts/lua/module_path';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { RuntimeSymbolEntry, RuntimeSymbolKind } from './symbols';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { resetHandledLuaErrors } from './fault_state';
import type { Blua32ImageLayout } from '../../machine/ts/machine/cpu/blua32_image';
import type { Blua32SymbolsImage } from '../../machine/ts/rompack/tooling/blua32_symbols';
import { asStringId, valueIsString, valueTag, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	installRuntimeRomLayers,
	resolveRuntimeLuaSource,
	type RuntimeSourceState,
} from './sources';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
} from '../../machine/ts/rompack/tooling/blua32_linker';
import { buildBlua32Tail } from '../../machine/ts/rompack/tooling/blua32_tail';
import type { RomSourceLayer } from '../../machine/ts/rompack/source';
import type { ResourceIdentity } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import type { RuntimeNativeBridge } from './native_bridge';
import type { Blua32ToolingImage } from '../../machine/ts/rompack/tooling/blua32_media';

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

function installFreshLuaInterpreter(
	fault: RuntimeFaultState,
	bridge: RuntimeNativeBridge,
	runtime: Runtime,
): LuaInterpreter {
	resetHandledLuaErrors(fault);
	const interpreter = new LuaInterpreter(bridge.luaJsBridge);
	bridge.luaInterpreter = interpreter;
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
	switch (valueTag(value)) {
		case ValueTag.Nil:
			return { kind: 'constant', valueType: 'nil' };
		case ValueTag.False:
		case ValueTag.True:
			return { kind: 'constant', valueType: 'boolean' };
		case ValueTag.Number:
			return { kind: 'constant', valueType: 'number' };
		case ValueTag.String:
			return { kind: 'constant', valueType: 'string' };
		case ValueTag.Table:
			return { kind: 'table', valueType: 'table' };
		case ValueTag.NativeFunction:
			return { kind: 'function', valueType: 'native_function' };
		case ValueTag.NativeObject:
			return { kind: 'table', valueType: 'native_object' };
		case ValueTag.Closure:
		case ValueTag.BuiltinFunction:
			return { kind: 'function', valueType: 'function' };
	}
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

function collectHiddenSymbolPrefixes(sources: RuntimeSourceState): Set<string> {
	const prefixes = new Set<string>();
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

export function listSymbols(sources: RuntimeSourceState, runtime: Runtime): RuntimeSymbolEntry[] {
	runtime.machine.cpu.syncGlobalSlotsToTable();
	const hiddenPrefixes = collectHiddenSymbolPrefixes(sources);
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
	sources: RuntimeSourceState,
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
	const compiledSources = new Map<string, string>();
	compiledSources.set(entryPath, entrySource);
	for (let index = 0; index < modules.length; index += 1) {
		compiledSources.set(modules[index].path, modules[index].source);
	}
	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel: sources.realtimeCompileOptLevel,
		entrySource,
		externalModules,
		programDomain,
	});
	return {
		object: encodeCompiledProgramObject(compiled),
		metadata: compiled.metadata,
		modules,
		sources: compiledSources,
	};
}

export function buildBlua32Media(
	sources: RuntimeSourceState,
	interpreter: LuaInterpreter,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): RebuiltBlua32Media {
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
	const installedSystem = sources.currentBlua32Media.system!;
	let systemImage = installedSystem.layout;
	let systemSymbols = installedSystem.symbols;
	let rebuiltSystem: RebuiltBlua32Image | null = null;
	let systemModules: ReadonlyArray<{ path: string; chunk: LuaChunk; source: string }> = [];
	if (rebuildSystem) {
		const compiledSystem = compileRegistryProgramObject(sources, systemRegistry, interpreter, 'system', []);
		const linked = linkSystemBlua32Image(
			compiledSystem.object,
			compiledSystem.metadata,
			SYSTEM_ROM_BASE + sources.systemRom.header.blua32ImageOffset,
			{ image: installedSystem.layout, symbols: installedSystem.symbols! },
		);
		systemImage = linked.layout;
		systemSymbols = linked.symbols;
		rebuiltSystem = {
			linked,
			previousImage: installedSystem.layout,
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
			sources,
			cartridge.luaSources,
			interpreter,
			'cart',
			systemModules,
		);
		const imageAddress = CART_ROM_BASE + imageOffset;
		const installed = sources.currentBlua32Media.cartridgeSlots[slot]!;
		const linked = linkCartBlua32Image(
			systemImage,
			systemSymbols,
			compiled.object,
			compiled.metadata,
			imageAddress,
			{ image: installed.layout, symbols: installed.symbols! },
		);
		rebuiltCartridgeSlots[slot] = {
			linked,
			previousImage: installed.layout,
			previousSymbols: installed.symbols!,
			sources: compiled.sources,
		};
	}
	return {
		system: rebuiltSystem,
		cartridgeSlots: rebuiltCartridgeSlots,
	};
}

export function installBlua32Media(
	sources: RuntimeSourceState,
	runtime: Runtime,
	rebuilt: RebuiltBlua32Media,
): void {
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
	const currentMedia = sources.currentBlua32Media;
	let systemImage = currentMedia.system;
	const cartridgeImages: [Blua32ToolingImage | null, Blua32ToolingImage | null] = [
		currentMedia.cartridgeSlots[0],
		currentMedia.cartridgeSlots[1],
	];
	if (systemLayer !== null) {
		runtime.machine.memory.installSystemRom(systemLayer.payload);
		sources.systemInstalledBlua32Sources = rebuilt.system!.sources;
		sources.systemBlua32MediaDirty = false;
		systemImage = {
			layout: rebuilt.system!.linked.layout,
			symbols: rebuilt.system!.linked.symbols,
		};
	}
	for (let slot = 0; slot < cartridgeLayers.length; slot += 1) {
		const layer = cartridgeLayers[slot];
		if (layer === null) {
			continue;
		}
		runtime.machine.memory.cartridgeController.installRom(slot, layer.payload);
		sources.cartridgeSlots[slot]!.installedBlua32Sources = rebuilt.cartridgeSlots[slot]!.sources;
		sources.cartridgeBlua32MediaDirty[slot] = false;
		cartridgeImages[slot] = {
			layout: rebuilt.cartridgeSlots[slot]!.linked.layout,
			symbols: rebuilt.cartridgeSlots[slot]!.linked.symbols,
		};
	}
	sources.currentBlua32Media = {
		system: systemImage,
		cartridgeSlots: cartridgeImages,
	};
}

export function bootActiveBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	nativeBridge: RuntimeNativeBridge,
	runtime: Runtime,
	rebuildBlua32Media: boolean,
): void {
	const interpreter = installFreshLuaInterpreter(fault, nativeBridge, runtime);
	if (rebuildBlua32Media) {
		installBlua32Media(sources, runtime, buildBlua32Media(
			sources,
			interpreter,
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
		));
	}
	runtime.resetForSystemBoot();
	runtime.boot();
}

export function resourceSourceForChunk(sources: RuntimeSourceState, identity: ResourceIdentity): string {
	const luaSource = resolveRuntimeLuaSource(sources, identity);
	if (!luaSource) {
		throw new Error(`Missing Lua source for '${identity.path}'.`);
	}
	return readWorkspaceLuaSourceText(luaSource.registry, luaSource.record);
}
