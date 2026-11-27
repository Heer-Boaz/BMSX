import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { CPU_STATUS_INHIBIT_RESET } from '../../machine/ts/spec/blua32/cop0';
import { CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { linkManagedTestSystem } from '../helpers/managed_system';

const entry = `
local state<const> = require('fixture/state')
require('fixture/init')
local data<const>: *word = state.data
local clear<const>: *word = state.clear
return *data + 100 * *clear`;
const modules = [
	{ path: 'fixture/state', source: `module<const>
data load_data: word[1] = { 41 }
bss clear_bss: word
return { data = load_data, clear = clear_bss }` },
	{ path: 'fixture/init', source: `
local state<const> = require('fixture/state')
local data<const>: *word = state.data
local clear<const>: *word = state.clear
*clear = *data + *clear + 1
return true` },
];
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) test('ordinary System reset admits the firmware-prepared context before DATA/BSS → modules → entry at O' + optLevel, () => {
	const linked = linkManagedTestSystem(entry, optLevel, modules), rom = writeTestBlua32Rom(linked);
	const reset = linked.layout.functions[linked.symbols.metadata.functionDisplayNames.indexOf('reset')];
	const preparedIndex = linked.symbols.metadata.functionIds.findIndex(id => id.startsWith('module:kernel/managed_reset/') && id.endsWith('|constant|enter'));
	const prepared = linked.layout.functions[preparedIndex];
	const { dataAddress, bssAddress } = linked.layout.header;
	assert.ok(reset && prepared && reset.address !== prepared.address);
	assert.equal(readLE32(rom, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), reset.address);

	const boot = () => {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu } = runtime.machine;
		assert.equal(cpu.readFramePc(0), reset.codeAddress);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		return runtime;
	};
	const runtime = boot();
	const { cpu, memory, scheduler } = runtime.machine;
	// Installed physical RAM can retain bytes outside the current public aperture.
	memory.writeRamRecordWord(dataAddress, 1001);
	memory.writeRamRecordWord(bssAddress, 73);
	let ordinaryCall = false;
	for (let step = 0; step < 8192 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++step) {
		const budget = ordinaryCall ? 257 : 1;
		assert.equal(scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false, 'raw reset runs ordinary code, not a resident service');
		if (cpu.rootThread.address === CPU_RESET_BANK_ADDRESS && cpu.getFrameDepth() > 1) {
			ordinaryCall = true;
			assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
		}
	}
	assert.ok(ordinaryCall, 'raw firmware actually executed an ordinary CALL');
	assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(memory.readRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameDepth), 0);
	assert.equal(cpu.activeThread.address, cpu.rootThread.address);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.readFramePc(0), prepared.codeAddress);
	assert.equal(cpu.activeThread.currentFrame!.functionAddress, prepared.address);
	assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
	assert.equal(cpu.captureRuntimeState().statusWord & CPU_STATUS_INHIBIT_RESET, CPU_STATUS_INHIBIT_RESET);
	assert.ok(cpu.heapAllocator.occupiedBytes() > 0 && cpu.luaHeap.usedBytes() > 0, 'firmware has created the first language heap and Thread');
	const sequence = memory.readBusFaultSequence();
	assert.equal(memory.readMappedWord(dataAddress), 1001);
	assert.equal(memory.readMappedWord(bssAddress), 73);
	assert.equal(memory.readBusFaultSequence(), sequence, 'the new floor made both section targets public');

	const saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(saved, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	function retire(target: Runtime) {
		const { cpu, memory, scheduler } = target.machine;
		assert.equal(cpu.activeThread.address, runtime.machine.cpu.rootThread.address);
		assert.equal(cpu.readFramePc(0), prepared.codeAddress);
		const observations: number[][] = [];
		function grant(budget: number) {
			const outcome = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
			const depth = cpu.getFrameDepth();
			observations.push([outcome, budget - cpu.instructionBudgetRemaining, depth, depth === 0 ? 0 : cpu.readFramePc(depth - 1)]);
		}
		// Observe each DATA/BSS write before the ordinary initializer reads them.
		for (let i = 0; i < 8192 && memory.readMappedWord(dataAddress) !== 41; ++i) grant(cpu.heapServiceActive() ? 257 : 1);
		assert.equal(memory.readMappedWord(dataAddress), 41);
		assert.equal(memory.readMappedWord(bssAddress), 73);
		for (let i = 0; i < 8192 && memory.readMappedWord(bssAddress) === 73; ++i) grant(1);
		assert.equal(memory.readMappedWord(bssAddress), 0, 'section init cleared BSS before executing the initializer');
		for (let i = 0; i < 512 && cpu.getFrameDepth() !== 0; ++i) grant(257);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.deepEqual(target.readCompletionValues(), [valueInteger(4241)]);
		assert.equal(memory.readMappedWord(bssAddress), 42, 'the module initializer ran exactly once before entry');
		return observations;
	}
	assert.deepEqual(retire(restored), retire(runtime), 'portable restore preserves exact managed handoff grants and PCs');
});

for (const optLevel of [0, 3] as const) test('an independent System reset selects its own prepared function at O' + optLevel, () => {
	const context = DYNAMIC_RAM_BASE, frames = context + 0x100, values = context + 0x200;
	const preparedEntry = { path: 'alternate/program', exportPathKey: 'run', valueSlots: 4 };
	const entries = [
		['main', 'module<entry>\nreturn 0'],
		['alternate/irq', 'return'],
		['alternate/fault', 'return'],
		['alternate/reset', `
local layout<const> = require('kernel/root_activation')
local startup<const> = require('bmsx/startup')
mem[${context + ThreadField.StackBlock}] = ${values}
mem[${context + ThreadField.StackCapacity}] = ${preparedEntry.valueSlots}
mem[${context + ThreadField.FrameBlock}] = ${frames}
mem[${context + ThreadField.FrameCapacity}] = 2
layout.publish_system_root(${context}, startup.prepared_entry)
cop0.context = ${context}`],
		[preparedEntry.path, 'module<const>\nlocal run<const> = function() return 73 end\nreturn { run = run }'],
		['kernel/root_activation', readFileSync('machine/bios/kernel/root_activation.lua', 'utf8')],
	];
	const { linked } = buildBlua32Image({
		domain: 'system', resetModule: 'alternate/reset', irqModule: 'alternate/irq', exceptionModule: 'alternate/fault',
		preparedEntry, biosExports: [],
		luaModules: entries.map(([path, source]) => ({ path, source, displayPath: path + '.lua', chunk: parseLuaChunk(source, path).chunk })),
		generatedLuaModules: [], loadAddress: 0x100, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
	});
	const runtime = new Runtime({
		systemRomBytes: writeTestBlua32Rom(linked), cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
	}, input);
	runtime.boot();
	const { cpu, scheduler } = runtime.machine;
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	for (let i = 0; i < 128 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i) {
		assert.equal(scheduler.runCpuSlice(0, 7, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	}
	assert.equal(cpu.rootThread.address, context);
	assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
	assert.equal(scheduler.runCpuSlice(0, 64, undefined, CpuRunKind.Scheduled), RunResult.Halted);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(73)]);
	assert.equal(cpu.luaHeap.usedBytes(), 0);
});
