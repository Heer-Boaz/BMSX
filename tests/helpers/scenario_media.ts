import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANAGED_CART_LAUNCH } from './managed_cart_launch';

import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { BIOS_EXCEPTION_BRIDGE, BIOS_FUNCTION_EXPORTS, BIOS_MANAGED_ENTRIES, BIOS_PREPARED_ENTRY, BIOS_USER_IRQ_ENTRY, SYSTEM_KERNEL_MODULES } from '../../toolchain/ts/rompack/system';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { BLUA32_FIRMWARE_MODULE_PATH, GX_DISPLAY_PRESET_MODULE_PATH, GX_REGISTER_MODULE_PATH, ROM_ASSET_SYMBOL_MODULE_PATH } from '../../toolchain/ts/rompack/generated_modules';
import { buildRelocatableRomAssetSymbolModule } from '../../toolchain/ts/rompack/asset_symbols';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { readBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	buildRomBlua32Tail,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';

const MANIFEST: CartManifest = { hardware: [{ type: 'rom' }] };
const SYSTEM_PROJECT_ROOT = 'test-fixtures/scenario/system';
const SCENARIO_BOOT = {
	resetModule: 'kernel/reset', irqModule: 'kernel/irq', exceptionModule: 'kernel/cold_exception',
	preparedEntry: BIOS_PREPARED_ENTRY, userIrqEntry: BIOS_USER_IRQ_ENTRY,
	exceptionBridge: BIOS_EXCEPTION_BRIDGE, managedEntries: BIOS_MANAGED_ENTRIES,
};

export const SCENARIO_FIXTURE_TEST_SOURCE_PATH = 'tests/carts/example/example_assert.lua';
export const SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE = 'return "source only"';
export const SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE = 'return "unselected source only"';
export const SCENARIO_FIXTURE_CART_ENTRY_SOURCE = [
	'module<entry>',
	'local trace_subject<const> = {}',
	"blua32.trace(trace_subject, 'fixture', true)",
	'return true',
].join('\n');

export type ScenarioMediaFixture = {
	readonly systemRom: Uint8Array;
	readonly cartRom: Uint8Array;
};

export type ScenarioMediaTestSource = {
	readonly path: string;
	readonly source: string;
};

function luaEntry(source: string, normalizedSourcePath: string): RomAsset {
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(source),
		program_module: true,
		source_path: 'entry.lua',
		normalized_source_path: normalizedSourcePath,
	};
}

/** Writes a production-format BIOS/cart pair with retained scenario sources. */
export async function buildScenarioMediaFixture(
	outputDirectory: string,
	testSources: readonly ScenarioMediaTestSource[],
	options?: {
		systemOptLevel?: 0 | 1 | 2 | 3;
		cartOptLevel?: 0 | 1 | 2 | 3;
		systemSource: string;
		launchCartridge?: true;
		systemModules: readonly { path: string; source: string }[];
		cartSource: string;
		cartModules?: readonly { path: string; source: string }[];
		systemAssets?: readonly RomAsset[];
		cartAssets?: readonly RomAsset[];
	},
): Promise<ScenarioMediaFixture> {
	const systemSource = options?.systemSource ?? 'module<entry>\nreturn true';
	const systemAssets = [luaEntry(options?.launchCartridge ? systemSource + MANAGED_CART_LAUNCH : systemSource,
		`${SYSTEM_PROJECT_ROOT}/entry.lua`)];
	// The executable fixture uses the real heap firmware. The public utility
	// slots below are unrelated to the tested runtime scenario.
	const systemModules = new Map(BIOS_FUNCTION_EXPORTS.map(exported => [exported.path, {
		path: exported.path,
		source: 'module<const>\nreturn function(value) return value end',
	}]));
	const firmware = new Set<string>(SYSTEM_KERNEL_MODULES);
	if (options?.launchCartridge) for (const path of [
		SCENARIO_BOOT.resetModule, SCENARIO_BOOT.irqModule, SCENARIO_BOOT.exceptionModule,
		BIOS_PREPARED_ENTRY.path, BIOS_USER_IRQ_ENTRY.path, BIOS_EXCEPTION_BRIDGE.path,
		'kernel/heap_bootstrap', 'kernel/boot_diagnostics', 'kernel/root_activation', 'kernel/warm_bindings',
		'kernel/interrupts', 'kernel/exception_report', 'kernel/register_window', 'kernel/protected_return',
		'kernel/coroutine_transfer', 'kernel/function_binding',
		...BIOS_MANAGED_ENTRIES.map(entry => entry.path),
	]) firmware.add(path);
	for (const path of firmware) {
		systemModules.set(path, { path, source: await readFile(`machine/bios/${path}.lua`, 'utf8') });
	}
	for (const module of options?.systemModules ?? []) systemModules.set(module.path, module);
	for (const module of systemModules.values()) {
		systemAssets.push({ resid: module.path, type: 'lua', buffer: Buffer.from(module.source), program_module: true,
			source_path: `${module.path}.lua`, normalized_source_path: `${SYSTEM_PROJECT_ROOT}/${module.path}.lua` });
	}
	if (options?.systemAssets !== undefined) systemAssets.push(...options.systemAssets);
	const systemBlua32 = buildRomBlua32Tail(systemAssets, {
		...options?.launchCartridge && SCENARIO_BOOT,
		generatedLuaModules: options?.launchCartridge ? [{ path: BLUA32_FIRMWARE_MODULE_PATH, source: BLUA32_FIRMWARE_MODULE_SOURCE }] : [],
		includeDiagnostics: true,
		includeSymbols: true,
		optLevel: options?.systemOptLevel ?? 0,
		ramByteCount: 0x00400000,
		domain: 'system',
		preloadModules: SYSTEM_KERNEL_MODULES,
		includeSources: true,
		biosExports: BIOS_FUNCTION_EXPORTS,
	});
	await finalizeRompack('system', {
		projectRootPath: SYSTEM_PROJECT_ROOT,
		debug: true,
		outputDirectory,
		blua32: systemBlua32,
	});
	const systemRom = new Uint8Array(await readFile(join(outputDirectory, 'system.debug.rom')));

	const sourceOnlyModule: RomAsset = {
		resid: 'source-only-module',
		type: 'lua',
		buffer: Buffer.from(SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE),
		source_path: 'testlib/fixture.lua',
		normalized_source_path: 'testlib/fixture.lua',
	};
	const unselectedSourceOnlyModule: RomAsset = {
		resid: 'unselected-source-only-module',
		type: 'lua',
		buffer: Buffer.from(SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE),
		source_path: 'testlib/unselected.lua',
		normalized_source_path: 'testlib/unselected.lua',
	};
	const frameworkAssets: RomAsset[] = [];
	for (const name of ['context', 'execution']) {
		frameworkAssets.push({ resid: `testlib/${name}`, type: 'lua', buffer: await readFile(`testlib/${name}.lua`), source_path: `testlib/${name}.lua`, normalized_source_path: `testlib/${name}.lua` });
	}
	const cartAssets = [
		...frameworkAssets,
		luaEntry(options === undefined ? SCENARIO_FIXTURE_CART_ENTRY_SOURCE : options.cartSource, 'carts/example/entry.lua'),
		sourceOnlyModule,
		unselectedSourceOnlyModule,
	];
	for (let index = 0; index < testSources.length; index += 1) {
		const testSource = testSources[index];
		cartAssets.push({
			resid: scenarioTestAssetId(testSource.path),
			type: 'lua',
			buffer: Buffer.from(testSource.source),
			source_path: testSource.path,
			normalized_source_path: testSource.path,
			update_timestamp: 1234 + index,
		});
	}
	if (options?.cartModules !== undefined) for (const module of options.cartModules) {
		cartAssets.push({ resid: module.path, type: 'lua', buffer: Buffer.from(module.source), program_module: true, source_path: `${module.path}.lua`, normalized_source_path: `${module.path}.lua` });
	}

	if (options?.cartAssets !== undefined) cartAssets.push(...options.cartAssets);
	const cartLayout = layoutRomPrefix(cartAssets, true, MANIFEST);
	const cartBlua32 = buildRomBlua32Tail(cartAssets, {
		generatedLuaModules: options?.launchCartridge ? [
			{ path: ROM_ASSET_SYMBOL_MODULE_PATH, ...buildRelocatableRomAssetSymbolModule(cartLayout.entries, 'cart', cartLayout.nextOffset) },
			{ path: GX_DISPLAY_PRESET_MODULE_PATH, source: GX_DISPLAY_PRESET_MODULE_SOURCE },
			{ path: GX_REGISTER_MODULE_PATH, source: GX_REGISTER_MODULE_SOURCE },
		] : [],
		includeDiagnostics: true,
		includeSymbols: true,
		optLevel: options?.cartOptLevel ?? 0,
		ramByteCount: 0x00400000,
		domain: 'cart',
		imageOffset: cartLayout.nextOffset,
		biosImports: readBlua32BiosImports(systemRom),
	});
	await finalizeRompack('cart', {
		projectRootPath: 'carts/example',
		debug: true,
		layout: cartLayout,
		outputDirectory,
		blua32: cartBlua32,
	});

	return {
		systemRom,
		cartRom: new Uint8Array(await readFile(join(outputDirectory, 'cart.debug.rom'))),
	};
}
