import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_SYS_CONTROL,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	IO_SYS_TIME_MS,
	IO_CART_SELECT,
	IO_IRQ_ACK,
	IO_IRQ_MASK,
	IRQ_VBLANK,
	SYS_CONTROL_RESET,
	SYS_PRINT_BUFFER_BYTES,
} from '../../machine/ts/spec/bmsx/io';
import { Machine } from '../../machine/ts/machine/machine';
import { PSX_MACHINE_SPEC } from '../../machine/ts/machine/model_registry';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { decodeBlua32BootHeader } from '../../machine/ts/rompack/tooling/blua32_image';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { OpCode, encodeFixedCallArgCount } from '../../machine/ts/spec/blua32/opcode';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { Table } from '../../machine/ts/machine/cpu/table';
import { StringValue } from '../../machine/ts/machine/cpu/value';
import { blua32SourceRangeAtPc } from '../../machine/ts/rompack/tooling/blua32_symbols';
import { COP0_EXEC } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveStateBytes, captureRuntimeSaveStateBytes } from '../../machine/ts/machine/runtime/save_state/codec';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import { parseLuaChunk } from './cpu_test_harness';
import {
	blua32TestFunctionAddress,
	linkRawTestBlua32Pair,
	linkTestBlua32Pair,
	type TestBlua32Source,
} from '../helpers/blua32';

class SystemResetInputSource implements RuntimeInputSource {
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

const CART_RESET_MARKER_ADDRESS = DYNAMIC_RAM_BASE + 0x1000;
const CART_CLOSURE_GLOBAL_NAME = 'selected_cart_closure';
const CART_CLOSURE_RESULT_GLOBAL_NAME = 'selected_cart_closure_result';

function createSystemResetRuntime(systemRom: Uint8Array, cartRom: Uint8Array, cart1Rom = new Uint8Array(0)): Runtime {
	const timing = resolveRuntimeTiming(5_000_000);
	return new Runtime({
		memory: new Memory({ systemRom, cartridgeSlots: cartridgeSlots(cartRom, cart1Rom) }),
		pcrtcRunning: timing.pcrtcRunning,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		totalHalfLines: timing.totalHalfLines,
		activeDisplayHalfLines: timing.activeDisplayHalfLines,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new SystemResetInputSource());
}

function makeExecutionSelectorSystemSource(): TestBlua32Source {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.MTC0, 0, COP0_EXEC, 0, 0);
	writeInstruction(text, 2, OpCode.RFE, 0, 0, 0, 0);
	return {
		text,
		functions: [
			{ firstWord: 0, wordCount: 2 },
			{ firstWord: 2, wordCount: 1 },
		],
		constants: [blua32TestFunctionAddress(CART_ROM_BASE, 0)],
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 0,
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map((primitive) => primitive.name),
	};
}

function makeClosureCartSource(value: number, path: string, staticClosure: boolean): TestBlua32Source {
	const text = new Uint8Array(9 * INSTRUCTION_BYTES);
	const range = {
		path,
		start: { line: 1, column: 1 },
		end: { line: 1, column: 2 },
	};
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 1, 0);
	writeInstruction(text, 2, OpCode.SETGL, 0, 0, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, encodeFixedCallArgCount(0), 1, 0);
	writeInstruction(text, 4, OpCode.SETGL, 0, 0, 1, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(text, 6, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(text, 8, OpCode.RFE, 0, 0, 0, 0);
	return {
		text,
		functions: [
			{ firstWord: 0, wordCount: 6 },
			{ firstWord: 6, wordCount: 2, staticClosure },
			{ firstWord: 8, wordCount: 1 },
		],
		constants: [value],
		globalNames: [
			CART_CLOSURE_GLOBAL_NAME,
			CART_CLOSURE_RESULT_GLOBAL_NAME,
		],
		debugRanges: [range, range, range, range, range, range, range, range, range],
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	};
}

test('system control reset command is write-only, self-clearing, and save-state visible', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const machine = new Machine(memory, new SystemResetInputSource());
	machine.resetDevices();
	const controller = machine.systemController;

	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	assert.equal(memory.readIoU32(IO_SYS_CONTROL), 0);
	assert.equal(controller.captureState().resetRequested, true);

	const state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	assert.equal(controller.takeResetRequest(), true);
	assert.equal(controller.takeResetRequest(), false);
});

test('system timing registers consume scheduler and PCRTC device state without Runtime mappings', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const machine = new Machine(memory, new SystemResetInputSource());
	const timing = resolveRuntimeTiming(5_000_000);
	machine.resetDevices();
	machine.scheduler.setNowCycles(PSX_MACHINE_SPEC.cpuFreqHz);
	assert.equal(memory.readMappedWord(IO_SYS_TIME_MS), 1000);
	machine.scheduler.setNowCycles(0);
	machine.refreshDeviceTimings({
		cpuHz: timing.cpuHz,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, machine.scheduler.currentNowCycles());

	assert.equal(memory.readMappedWord(IO_SYS_TIME_MS), 0);
	assert.equal(
		memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16),
		machine.gxGpu.readPcrtcTiming().frameDurationMillisecondsQ16,
	);
	assert.equal(
		memory.readMappedWord(IO_SYS_CYCLES_PER_FRAME),
		machine.gxGpu.readPcrtcTiming().nextVblankCycleBudget,
	);

	machine.scheduler.setNowCycles(12_500_001);
	assert.equal(memory.readMappedWord(IO_SYS_TIME_MS), 2500);
	assert.equal(machine.systemController.elapsedMilliseconds(), 2500.0002);

	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	const smode1 = memory.readMappedU32LE(smode1Address);
	memory.writeMappedU32LE(smode1Address, smode1 | GX_GPU_PCRTC_SMODE1_SINT);
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 0);
	assert.equal(memory.readMappedWord(IO_SYS_CYCLES_PER_FRAME), 0);

	machine.scheduler.setNowCycles(9_000_006_099_639_999);
	assert.equal(memory.readMappedWord(IO_SYS_TIME_MS), 409_922_903);
});

test('system print registers retain firmware output and publish complete host lines', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const machine = new Machine(memory, new SystemResetInputSource());
	machine.resetDevices();
	const controller = machine.systemController;

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x68);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x69);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 3);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0x68, 0x69, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 3);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x68);

	const state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x69);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x0a);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 0);

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x20ac);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 4);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0xe2, 0x82, 0xac, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x3f);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x0a);

	controller.reset();
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6f);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6b);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES; index += 1) {
		memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x78);
	}
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 3);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0x6f, 0x6b, 0x0a]);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x79);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 2);
	assert.equal(controller.readHostOutputByte(), 0x79);
	assert.equal(controller.readHostOutputByte(), 0x0a);

	controller.reset();
	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES + 2; index += 1) {
		memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, index);
	}
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), SYS_PRINT_BUFFER_BYTES);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 2);
});

test('runtime reset boundary restarts system firmware and preserves cartridge entry', () => {
	const systemSource = `
data marker: word = 41
*marker = *marker + 1
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const system = compileLuaChunkToProgram(parseLuaChunk(systemSource, 'system_reset_system.lua'), [], { entrySource: systemSource, programDomain: 'system' });
	const cartSource = `
function irq(flags)
	mem[${IO_IRQ_ACK}] = flags
end
mem[${CART_RESET_MARKER_ADDRESS}] = 99
halt_until_irq
mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_RESET}
return
`;
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'system_reset_cart.lua'), [], { entrySource: cartSource, programDomain: 'cart' });
	const images = linkTestBlua32Pair(system, cart);
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.boot();

	assert.equal(runtime.machine.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 0);
	assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(runtime.machine.cpu.isCartridgeExecutionActive(), true);
	assert.equal(runtime.machine.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 42);
	assert.equal(runtime.machine.memory.readMappedU32LE(CART_RESET_MARKER_ADDRESS), 99);

	runtime.machine.irqController.raise(IRQ_VBLANK);
	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.machine.cpu.isCartridgeExecutionActive(), false);
	assert.equal(runtime.pendingCall, 'entry');
	assert.equal(runtime.machine.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 42);
	assert.equal(runtime.machine.systemController.captureState().resetRequested, false);
	assert.equal(runtime.frameScheduler.lastTickSequence, 0);

	assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(runtime.machine.cpu.isCartridgeExecutionActive(), true);
	assert.equal(runtime.machine.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 42);
	assert.equal(runtime.machine.memory.readMappedU32LE(CART_RESET_MARKER_ADDRESS), 99);
});

test('an unexecuted second cartridge does not alter guest identity allocation', () => {
	const systemSource = makeExecutionSelectorSystemSource();
	const slot0 = linkRawTestBlua32Pair(
		systemSource,
		makeClosureCartSource(111, 'slot0.lua', true),
	);
	const unusedSource = makeClosureCartSource(222, 'slot1.lua', true);
	unusedSource.constants = [222, 'unused-slot-string'];
	unusedSource.globalNames = [
		CART_CLOSURE_GLOBAL_NAME,
		CART_CLOSURE_RESULT_GLOBAL_NAME,
		'unused_slot_global',
	];
	const slot1 = linkRawTestBlua32Pair(systemSource, unusedSource);
	const single = createSystemResetRuntime(slot0.systemRomBytes, slot0.cartRomBytes);
	single.boot();
	const unusedSlotRom = slot1.cartRomBytes.slice();
	const dual = createSystemResetRuntime(
		slot0.systemRomBytes,
		slot0.cartRomBytes,
		unusedSlotRom,
	);
	dual.boot();
	const revisedDual = createSystemResetRuntime(
		slot0.systemRomBytes,
		slot0.cartRomBytes,
		slot1.cartRomBytes,
	);
	revisedDual.boot();
	revisedDual.machine.memory.cartridgeController.installRom(1, slot1.cartRomBytes);
	assert.equal(revisedDual.machine.cpu.isExecutionDomainResident(1), false);

	const singleStringId = single.machine.cpu.stringPool.intern('post-boot-probe', false);
	assert.equal(dual.machine.cpu.stringPool.intern('post-boot-probe', false), singleStringId);
	assert.equal(revisedDual.machine.cpu.stringPool.intern('post-boot-probe', false), singleStringId);
	const singleTableId = single.machine.cpu.createTable(0, 0).hashId;
	assert.equal(dual.machine.cpu.createTable(0, 0).hashId, singleTableId);
	assert.equal(revisedDual.machine.cpu.createTable(0, 0).hashId, singleTableId);

	unusedSlotRom[decodeBlua32BootHeader(unusedSlotRom).imageOffset] ^= 0xff;
	dual.rebootSystem();
});

test('guest cartridge selection and EXEC-latched closures survive the runtime save-state wire format', () => {
	const systemSource = makeExecutionSelectorSystemSource();
	const slot0 = linkRawTestBlua32Pair(systemSource, makeClosureCartSource(111, 'slot0.lua', true));
	const slot1 = linkRawTestBlua32Pair(systemSource, makeClosureCartSource(222, 'slot1.lua', true));
	const runtime = createSystemResetRuntime(
		slot0.systemRomBytes,
		slot0.cartRomBytes,
		slot1.cartRomBytes,
	);
	runtime.boot();
	const cpu = runtime.machine.cpu;

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const selectedClosureName = StringValue.get(cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME));
	const selectedClosureResultName = StringValue.get(cpu.stringPool.intern(CART_CLOSURE_RESULT_GLOBAL_NAME));
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const slot0Closure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), 111);
	const savedClosureName = StringValue.get(cpu.stringPool.intern('saved_closure'));
	const closureTableName = StringValue.get(cpu.stringPool.intern('closure_table'));
	const closureTable = cpu.createTable();
	closureTable.set(slot0Closure, 77);
	cpu.setGlobalByKey(savedClosureName, slot0Closure);
	cpu.setGlobalByKey(closureTableName, closureTable);

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	const slot1Closure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	assert.equal(slot1Closure, slot0Closure);
	assert.equal(closureTable.get(slot1Closure), 77);
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), 222);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	const slot1SourceRange = blua32SourceRangeAtPc(
		slot1.cartSymbols,
		slot1.cartImage.header.textAddress,
		cpu.lastPc,
	);
	assert.ok(slot1SourceRange);
	assert.equal(slot1SourceRange.path, 'slot1.lua');
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	const sourceRangeAfterBusSelection = blua32SourceRangeAtPc(
		slot1.cartSymbols,
		slot1.cartImage.header.textAddress,
		cpu.lastPc,
	);
	assert.ok(sourceRangeAfterBusSelection);
	assert.equal(sourceRangeAfterBusSelection.path, 'slot1.lua');

	const saveBytes = captureRuntimeSaveStateBytes(runtime);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), 111);

	applyRuntimeSaveStateBytes(runtime, saveBytes);
	const restoredClosure = cpu.getGlobalByKey(savedClosureName) as Closure;
	const restoredTable = cpu.getGlobalByKey(closureTableName) as Table;
	assert.equal(restoredClosure, slot1Closure);
	assert.equal(restoredTable.get(restoredClosure), 77);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), 222);
});

test('distinct non-static closures remain distinct table keys through the runtime save-state wire format', () => {
	const images = linkRawTestBlua32Pair(
		makeExecutionSelectorSystemSource(),
		makeClosureCartSource(111, 'slot0.lua', false),
	);
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.boot();
	const cpu = runtime.machine.cpu;

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const selectedClosureName = StringValue.get(cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME));
	const firstClosure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const secondClosure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	assert.notEqual(firstClosure, secondClosure);
	assert.equal(firstClosure.functionAddress, secondClosure.functionAddress);

	const firstName = StringValue.get(cpu.stringPool.intern('first_closure'));
	const secondName = StringValue.get(cpu.stringPool.intern('second_closure'));
	const tableName = StringValue.get(cpu.stringPool.intern('closure_table'));
	const closureTable = cpu.createTable(0, 2);
	closureTable.set(firstClosure, 11);
	closureTable.set(secondClosure, 22);
	cpu.setGlobalByKey(firstName, firstClosure);
	cpu.setGlobalByKey(secondName, secondClosure);
	cpu.setGlobalByKey(tableName, closureTable);

	const saveBytes = captureRuntimeSaveStateBytes(runtime);
	applyRuntimeSaveStateBytes(runtime, saveBytes);

	const restoredFirst = cpu.getGlobalByKey(firstName) as Closure;
	const restoredSecond = cpu.getGlobalByKey(secondName) as Closure;
	const restoredTable = cpu.getGlobalByKey(tableName) as Table;
	assert.notEqual(restoredFirst, restoredSecond);
	assert.equal(restoredFirst.functionAddress, restoredSecond.functionAddress);
	assert.equal(restoredTable.get(restoredFirst), 11);
	assert.equal(restoredTable.get(restoredSecond), 22);
});

test('mixed static and non-static cartridge closures keep their identities across either save-state latch', () => {
	const systemSource = makeExecutionSelectorSystemSource();
	const slot0 = linkRawTestBlua32Pair(
		systemSource,
		makeClosureCartSource(111, 'slot0.lua', false),
	);
	const slot1 = linkRawTestBlua32Pair(
		systemSource,
		makeClosureCartSource(222, 'slot1.lua', true),
	);
	const runtime = createSystemResetRuntime(
		slot0.systemRomBytes,
		slot0.cartRomBytes,
		slot1.cartRomBytes,
	);
	runtime.boot();
	const cpu = runtime.machine.cpu;

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const selectedClosureName = StringValue.get(cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME));
	const dynamicClosure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const canonicalClosure = cpu.getGlobalByKey(selectedClosureName) as Closure;
	assert.notEqual(dynamicClosure, canonicalClosure);
	assert.equal(dynamicClosure.functionAddress, canonicalClosure.functionAddress);

	const dynamicName = StringValue.get(cpu.stringPool.intern('dynamic_closure'));
	const canonicalName = StringValue.get(cpu.stringPool.intern('canonical_closure'));
	const tableName = StringValue.get(cpu.stringPool.intern('mixed_closure_table'));
	const closureTable = cpu.createTable(0, 2);
	closureTable.set(dynamicClosure, 11);
	closureTable.set(canonicalClosure, 22);
	cpu.setGlobalByKey(dynamicName, dynamicClosure);
	cpu.setGlobalByKey(canonicalName, canonicalClosure);
	cpu.setGlobalByKey(tableName, closureTable);

	applyRuntimeSaveStateBytes(runtime, captureRuntimeSaveStateBytes(runtime));
	let restoredDynamic = cpu.getGlobalByKey(dynamicName) as Closure;
	let restoredCanonical = cpu.getGlobalByKey(canonicalName) as Closure;
	let restoredTable = cpu.getGlobalByKey(tableName) as Table;
	assert.notEqual(restoredDynamic, restoredCanonical);
	assert.equal(restoredTable.get(restoredDynamic), 11);
	assert.equal(restoredTable.get(restoredCanonical), 22);

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	applyRuntimeSaveStateBytes(runtime, captureRuntimeSaveStateBytes(runtime));
	restoredDynamic = cpu.getGlobalByKey(dynamicName) as Closure;
	restoredCanonical = cpu.getGlobalByKey(canonicalName) as Closure;
	restoredTable = cpu.getGlobalByKey(tableName) as Table;
	assert.notEqual(restoredDynamic, restoredCanonical);
	assert.equal(restoredTable.get(restoredDynamic), 11);
	assert.equal(restoredTable.get(restoredCanonical), 22);

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(selectedClosureName), restoredCanonical);
	assert.equal(restoredTable.get(cpu.getGlobalByKey(selectedClosureName)), 22);
});
