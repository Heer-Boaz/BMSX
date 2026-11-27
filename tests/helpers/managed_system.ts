import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { buildBlua32Image, type Blua32StaticExport } from '../../toolchain/ts/rompack/blua32_image_builder';
import type { Blua32BiosFunctionExport } from '../../toolchain/ts/rompack/blua32_bios_imports';
import type { LinkedSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { BIOS_EXCEPTION_BRIDGE, BIOS_MANAGED_ENTRIES, BIOS_PREPARED_ENTRY } from '../../toolchain/ts/rompack/system';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { writeTestBlua32Rom } from './blua32';
import { cartridgeSlots } from './cartridge';

const resetModule = 'kernel/reset', irqModule = 'kernel/irq', exceptionModule = 'kernel/cold_exception';
export { MANAGED_CART_LAUNCH as TEST_CART_TRANSFER_SOURCE } from './managed_cart_launch';
const firmware = [
	resetModule, irqModule, exceptionModule, 'kernel/interrupts', BIOS_PREPARED_ENTRY.path,
	'kernel/heap_bootstrap', 'kernel/boot_diagnostics', 'kernel/system_image_bind', 'kernel/root_activation',
	'kernel/gc_stopped_roots', 'kernel/global_bank', 'kernel/warm_bindings',
	'kernel/boot_image_admission', 'kernel/value_type',
	'kernel/string_slice', 'kernel/allocate_string_slice', 'kernel/function_binding', 'kernel/byte_string_input', 'string/from_bytes',
	BIOS_EXCEPTION_BRIDGE.path, 'kernel/exception_report', 'kernel/register_window', 'kernel/protected_return', 'kernel/coroutine_transfer',
	...BIOS_MANAGED_ENTRIES.map(entry => entry.path),
];

function systemModule(path: string, source: string, linkValues?: ReadonlyMap<string, number>) {
	return { path, displayPath: path.endsWith('.lua') ? path : path + '.lua', source, chunk: parseLuaChunk(source, path).chunk, linkValues };
}

/** A test program that receives the ordinary, firmware-prepared machine, not a host-created language environment. */
export function linkManagedTestSystem(source: string, optLevel: OptimizationLevel,
	extraModules: readonly { path: string; source: string; linkValues?: ReadonlyMap<string, number> }[] = [],
	biosExports: readonly Blua32BiosFunctionExport[] = [], entryPath = 'main',
	options: { irqSource?: string; exceptionSource?: string; userIrqEntry?: Blua32StaticExport } = {}) {
	const luaModules = Array.from(new Set([...firmware, ...HEAP_SERVICE_MODULES]), path =>
		systemModule(path, path === irqModule && options.irqSource !== undefined ? options.irqSource
			: path === exceptionModule && options.exceptionSource !== undefined ? options.exceptionSource
				: readFileSync('machine/bios/' + path + '.lua', 'utf8')));
	for (const { path, source, linkValues } of extraModules) luaModules.push(systemModule(path, source, linkValues));
	luaModules.push(systemModule(entryPath, source.startsWith('module<entry>') ? source : 'module<entry>\n' + source));
	const generatedLuaModules = extraModules.some(module => module.path === 'bmsx/blua32') ? []
		: [{ path: 'bmsx/blua32', source: BLUA32_FIRMWARE_MODULE_SOURCE }];
	const { linked, object, diagnosticSources } = buildBlua32Image({
		domain: 'system', luaModules, generatedLuaModules, loadAddress: 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
		resetModule, irqModule, exceptionModule, preparedEntry: BIOS_PREPARED_ENTRY, userIrqEntry: options.userIrqEntry,
		exceptionBridge: BIOS_EXCEPTION_BRIDGE,
		managedEntries: BIOS_MANAGED_ENTRIES,
		preloadModules: HEAP_SERVICE_MODULES, biosExports,
	});
	return Object.assign(linked, { object, diagnosticSources });
}

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

/** Follow firmware from the physical reset bank to its ordinary System entry. */
export function bootManagedTestSystem(linked: LinkedSystemBlua32Image,
	entryPath = 'main', slots = cartridgeSlots()) {
	const startup = linked.symbols.metadata.functionIds.indexOf(`module:${entryPath}/startup`);
	assert.notEqual(startup, -1, 'the linked program has a managed startup');
	const start = linked.symbols.functionAddresses[startup];
	const runtime = new Runtime({ systemRomBytes: writeTestBlua32Rom(linked), cartridgeSlots: slots, machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu } = runtime.machine;
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	let bootBudget = 1_000_000;
	for (let grant = 0; grant < 32 && cpu.readFrameFunctionAddress(0) !== start && bootBudget > 0; ++grant) {
		assert.equal(cpu.runUntilDepth(0, bootBudget), RunResult.Yielded);
		bootBudget = cpu.instructionBudgetRemaining;
	}
	assert.equal(cpu.readFrameFunctionAddress(0), start, 'the BIOS transferred to the managed System startup');
	assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	return runtime.machine;
}
