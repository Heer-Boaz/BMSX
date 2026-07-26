import {
	CARTRIDGE_RESOURCE_DOMAINS,
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../ide/common/resource';
import {
	createRuntimeSourceState,
	enterCartridgeSources,
	enterSystemSources,
	rebuildRuntimeSourceResources,
	type RuntimeSourceState,
} from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	CART_ROM_HEADER_SIZE,
	parseCartHeader,
	type CartridgeIndex,
	type CartRomHeader,
	type CartridgeLayerId,
	type MachineManifest,
	type RuntimeRomPackage,
} from '../../machine/ts/rompack/format';
import type { RuntimeRomLayer } from '../../machine/ts/rompack/loader';
import { writeCartRomHeader } from '../../machine/ts/rompack/tooling/header_encode';
import { cartridgeSlots } from './cartridge';

const TEST_MACHINE: MachineManifest = {
	namespace: 'test',
	vdp_class: 'psx',
};

class TestRuntimeInputSource implements RuntimeInputSource {
	public setRuntimeInputFrameDurationMs(): void {
	}

	public sampleInputControllerSnapshot(): void {
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

export function createTestRuntime(systemRom: Uint8Array): Runtime {
	const timing = resolveRuntimeTiming(5_000_000);
	return new Runtime({
		memory: new Memory({ systemRom, cartridgeSlots: cartridgeSlots() }),
		pcrtcRunning: timing.pcrtcRunning,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		totalHalfLines: timing.totalHalfLines,
		activeDisplayHalfLines: timing.activeDisplayHalfLines,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new TestRuntimeInputSource());
}

function runtimePackage(projectRootPath: string): RuntimeRomPackage {
	return {
		img: {},
		audio: {},
		model: {},
		data: {},
		bin: {},
		audioevents: {},
		project_root_path: projectRootPath,
		cart_manifest: null,
		machine: TEST_MACHINE,
		entry_path: '',
	};
}

function cartridgeIndex(projectRootPath: string): CartridgeIndex {
	return {
		entries: [],
		projectRootPath,
		cart_manifest: null,
		machine: TEST_MACHINE,
		entry_path: '',
	};
}

function emptyRomHeader(): CartRomHeader {
	return {
		headerSize: CART_ROM_HEADER_SIZE,
		manifestOffset: CART_ROM_HEADER_SIZE,
		manifestLength: 0,
		tocOffset: CART_ROM_HEADER_SIZE,
		tocLength: 0,
		dataOffset: CART_ROM_HEADER_SIZE,
		dataLength: 0,
		blua32ImageOffset: 0,
		blua32ImageByteCount: 0,
		blua32StartupFunctionAddress: 0,
		blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0,
		blua32StaticLayoutTokenLo: 0,
		blua32StaticLayoutTokenHi: 0,
		metadataOffset: CART_ROM_HEADER_SIZE,
		metadataLength: 0,
		vdpClass: 'psx',
		cartridgeBoardWord: 0,
		cartridgeRamByteCount: 0,
	};
}

function runtimeRomLayer(
	id: CartridgeLayerId,
	projectRootPath: string,
	payload: Uint8Array,
): RuntimeRomLayer {
	return {
		id,
		header: parseCartHeader(payload),
		index: cartridgeIndex(projectRootPath),
		payload,
		package: runtimePackage(projectRootPath),
	};
}

export function createTestRuntimeRomPayload(): Uint8Array {
	const payload = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(payload, emptyRomHeader());
	return payload;
}

function installedSources(registry: LuaSourceRegistry): ReadonlyMap<string, string> {
	const sources = new Map<string, string>();
	for (let index = 0; index < registry.records.length; index += 1) {
		const record = registry.records[index];
		sources.set(record.module_path, record.src);
	}
	return sources;
}

function installSourceRegistries(
	sources: RuntimeSourceState,
	systemLuaSources: LuaSourceRegistry,
	cartridgeLuaSources: readonly [LuaSourceRegistry | null, LuaSourceRegistry | null],
	activeDomain: ResourceDomain,
): RuntimeSourceState {
	sources.systemLuaSources = systemLuaSources;
	sources.systemProjectRootPath = systemLuaSources.projectRootPath;
	sources.systemInstalledBlua32Sources = installedSources(systemLuaSources);
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const registry = cartridgeLuaSources[slot];
		if (!registry) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		cartridge.luaSources = registry;
		cartridge.projectRootPath = registry.projectRootPath;
		cartridge.installedBlua32Sources = installedSources(registry);
	}
	rebuildRuntimeSourceResources(sources);
	switch (activeDomain) {
		case 0:
		case 1:
			enterCartridgeSources(sources, activeDomain);
			break;
		case SYSTEM_RESOURCE_DOMAIN:
			enterSystemSources(sources);
			break;
	}
	return sources;
}

export function createTestRuntimeSourceState(
	systemLuaSources: LuaSourceRegistry,
	cartridgeLuaSources: readonly [LuaSourceRegistry | null, LuaSourceRegistry | null],
	activeDomain: ResourceDomain,
): RuntimeSourceState {
	const cartridgeLayers: [RuntimeRomLayer | null, RuntimeRomLayer | null] = [
		cartridgeLuaSources[0]
			? runtimeRomLayer('cart', cartridgeLuaSources[0].projectRootPath, createTestRuntimeRomPayload())
			: null,
		cartridgeLuaSources[1]
			? runtimeRomLayer('cart', cartridgeLuaSources[1].projectRootPath, createTestRuntimeRomPayload())
			: null,
	];
	const sources = createRuntimeSourceState(
		runtimeRomLayer('system', systemLuaSources.projectRootPath, createTestRuntimeRomPayload()),
		cartridgeLayers,
	);
	return installSourceRegistries(sources, systemLuaSources, cartridgeLuaSources, activeDomain);
}

export function createTestSystemImageRuntimeSourceState(
	systemRom: Uint8Array,
	systemLuaSources: LuaSourceRegistry,
): RuntimeSourceState {
	const sources = createRuntimeSourceState(
		runtimeRomLayer('system', systemLuaSources.projectRootPath, systemRom),
		[null, null],
	);
	return installSourceRegistries(
		sources,
		systemLuaSources,
		[null, null],
		SYSTEM_RESOURCE_DOMAIN,
	);
}
