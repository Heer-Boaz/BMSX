import {
	CARTRIDGE_RESOURCE_DOMAINS,
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../ide/common/resource';
import {
	createRuntimeSourceState,
	createLoadedProjectSourceCatalog,
	enterCartridgeSources,
	enterSystemSources,
	type RuntimeSourceState,
} from '../../ide/runtime/sources';
import type { LuaSourceRegistry, LuaSourceRoot } from '../../ide/runtime/source_registry';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { InputControllerInputSource } from '../../machine/ts/machine/devices/input/contracts';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import {
	parseCartHeader,
	type CartRomHeader,
} from '../../machine/ts/rompack/format';
import type {
	PackedCartridgeIndex,
	RomAsset,
	RomToolingPackage,
} from '../../toolchain/ts/rompack/assets';
import type { RomImageDomain } from '../../machine/ts/rompack/image';
import type { RomToolingLayer } from '../../toolchain/ts/rompack/loader';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { cartridgeSlots } from './cartridge';
import { decodeRomToc } from '../../machine/ts/rompack/toc';

class TestInputSource implements InputControllerInputSource {
	public sampleInputControllerSnapshot(): void {
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

export function createTestRuntime(systemRom: Uint8Array): Runtime {
	return new Runtime({
		systemRomBytes: systemRom,
		cartridgeSlots: cartridgeSlots(),
		machineModel: {
			...PSX_MACHINE_SPEC,
			cpuFreqHz: 5_000_000,
		},
	}, new TestInputSource());
}

export function createTestToolingPackage(projectRootPath: string): RomToolingPackage {
	return {
		img: {},
		audio: {},
		model: {},
		data: {},
		bin: {},
		collision_shape: {},
		audioevents: {},
		project_root_path: projectRootPath,
		cart_manifest: null,
	};
}

function cartridgeIndex(projectRootPath: string): PackedCartridgeIndex {
	return {
		entries: [],
		projectRootPath,
		cart_manifest: null,
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
		blua32DiagnosticDirectoryOffset: 0,
		metadataOffset: CART_ROM_HEADER_SIZE,
		metadataLength: 0,
	};
}

export function createTestRomToolingLayer<TDomain extends RomImageDomain>(
	id: TDomain,
	projectRootPath: string,
	payload: Uint8Array,
): RomToolingLayer<TDomain> {
	const header = parseCartHeader(payload);
	const index = cartridgeIndex(projectRootPath);
	if (header.tocLength !== 0) {
		index.entries = decodeRomToc(
			payload.subarray(header.tocOffset, header.tocOffset + header.tocLength),
		).entries;
	}
	return {
		id,
		header,
		index,
		bytes: payload,
		package: createTestToolingPackage(projectRootPath),
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
		if (record.program_module) sources.set(record.module_path, record.src);
	}
	return sources;
}

/** Explicit fixture admission data, not a runtime domain-to-context resolver. */
export const TEST_SYSTEM_CONTEXT_ID = 'fixture-system-source';
export const TEST_CARTRIDGE_CONTEXT_IDS = ['fixture-cartridge-source-a', 'fixture-cartridge-source-b'] as const;

function admitFixtureContexts(system: RomToolingLayer<'system'>,
	cartridges: readonly [RomToolingLayer<'cart'> | null, RomToolingLayer<'cart'> | null],
	systemRegistry: LuaSourceRegistry,
	cartridgeRegistries: readonly [LuaSourceRegistry | null, LuaSourceRegistry | null],
	authoredAssets: TestAuthoredAssets,
): WorkspaceSourceCatalog {
	const catalog = new WorkspaceSourceCatalog();
	const sourceRoots = (root: string): LuaSourceRoot[] => [
		{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' },
	];
	catalog.admitContext({ admission: { id: TEST_SYSTEM_CONTEXT_ID, projectRoot: systemRegistry.projectRootPath },
		programDomain: 'system', systemContextId: null, luaSources: systemRegistry, sourceRoots: sourceRoots(systemRegistry.projectRootPath),
		dependencyContextIds: [], previewPackage: system.package, previewRom: { ...system }, assetSources: authoredAssets.system });
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const registry = cartridgeRegistries[slot];
		if (registry === null) continue;
		const layer = cartridges[slot]!;
		catalog.admitContext({ admission: { id: TEST_CARTRIDGE_CONTEXT_IDS[slot], projectRoot: registry.projectRootPath },
			programDomain: 'cart', systemContextId: TEST_SYSTEM_CONTEXT_ID, luaSources: registry, sourceRoots: [
				...sourceRoots(registry.projectRootPath),
				{ path: 'cartlib', resourcePathPrefix: 'cartlib', modulePathPrefix: 'cartlib', structured: false, sourceKind: 'library' },
			], dependencyContextIds: [TEST_SYSTEM_CONTEXT_ID], previewPackage: layer.package,
			previewRom: { ...layer }, assetSources: authoredAssets.cartridgeSlots[slot] });
	}
	return catalog;
}

export type TestAuthoredAssets = {
	readonly system: readonly RomAsset[];
	readonly cartridgeSlots: readonly [readonly RomAsset[], readonly RomAsset[]];
};

export function createTestRuntimeSourceState(
	systemLuaSources: LuaSourceRegistry,
	cartridgeLuaSources: readonly [LuaSourceRegistry | null, LuaSourceRegistry | null],
	activeDomain: ResourceDomain,
	authoredAssets: TestAuthoredAssets = { system: [], cartridgeSlots: [[], []] },
): RuntimeSourceState {
	const system = createTestRomToolingLayer('system', systemLuaSources.projectRootPath, createTestRuntimeRomPayload());
	const cartridgeLayers: [RomToolingLayer<'cart'> | null, RomToolingLayer<'cart'> | null] = [
		cartridgeLuaSources[0] === null ? null : createTestRomToolingLayer('cart', cartridgeLuaSources[0].projectRootPath, createTestRuntimeRomPayload()),
		cartridgeLuaSources[1] === null ? null : createTestRomToolingLayer('cart', cartridgeLuaSources[1].projectRootPath, createTestRuntimeRomPayload()),
	];
	const catalog = admitFixtureContexts(system, cartridgeLayers, systemLuaSources, cartridgeLuaSources, authoredAssets);
	const sources = createRuntimeSourceState(system, cartridgeLayers, { catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID,
		cartridgeContextIds: [cartridgeLuaSources[0] === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[0],
			cartridgeLuaSources[1] === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[1]] });
	// These fixtures explicitly install the supplied source generations; they do
	// not make the mutable authoring registry an installed-media owner.
	sources.systemInstalledBlua32Sources = installedSources(systemLuaSources);
	sources.systemSourceRevision = 0;
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const registry = cartridgeLuaSources[slot];
		if (registry === null) continue;
		sources.cartridgeSlots[slot]!.installedBlua32Sources = installedSources(registry);
		sources.cartridgeSlots[slot]!.installedSourceRevision = 0;
	}
	if (activeDomain === SYSTEM_RESOURCE_DOMAIN) enterSystemSources(sources); else enterCartridgeSources(sources, activeDomain);
	return sources;
}

export function createTestSystemImageRuntimeSourceState(systemRom: Uint8Array, systemLuaSources: LuaSourceRegistry): RuntimeSourceState {
	const layer = createTestRomToolingLayer('system', systemLuaSources.projectRootPath, systemRom);
	const catalog = admitFixtureContexts(layer, [null, null], systemLuaSources, [null, null], { system: layer.index.entries, cartridgeSlots: [[], []] });
	const sources = createRuntimeSourceState(layer, [null, null], { catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID, cartridgeContextIds: [null, null] });
	sources.systemInstalledBlua32Sources = installedSources(systemLuaSources);
	sources.systemSourceRevision = 0;
	return sources;
}

/** Real ROM fixture admission: seed authored contexts once, then attach their exact images. */
export function createLoadedTestRuntimeSourceState(system: RomToolingLayer<'system'>,
	cartridges: readonly [RomToolingLayer<'cart'> | null, RomToolingLayer<'cart'> | null]): RuntimeSourceState {
	const catalog = createLoadedProjectSourceCatalog(
		{ admission: { id: TEST_SYSTEM_CONTEXT_ID, projectRoot: system.index.projectRootPath }, layer: system },
		cartridges.flatMap((layer, slot) => layer === null ? [] : [{
			admission: { id: TEST_CARTRIDGE_CONTEXT_IDS[slot], projectRoot: layer.index.projectRootPath }, layer,
		}]),
	);
	return createRuntimeSourceState(system, cartridges, { catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID,
		cartridgeContextIds: [cartridges[0] === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[0], cartridges[1] === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[1]] });
}
