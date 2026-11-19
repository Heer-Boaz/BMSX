import { cartridgeSlots } from '../helpers/cartridge';
import { GX_GPU_GP0_VRAM_TO_CPU_FIRST } from '../../machine/ts/spec/gx/gp0';
import { GX_GPU_READBACK_IDLE, GX_GPU_READBACK_READY } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_SYS_CONTROL,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	IO_SYS_STATUS,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	IO_SYS_TIME_MS,
	IO_CART_SELECT,
	IO_IRQ_ACK,
	IO_IRQ_MASK,
	IRQ_VBLANK,
	SYS_CONTROL_RESET,
	SYS_CONTROL_SUPERVISOR_ENTER,
	SYS_CONTROL_SUPERVISOR_FAULT,
	SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH,
	SYS_CONTROL_SUPERVISOR_LEAVE,
	SYS_PRINT_BUFFER_BYTES,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_EXIT_REQUESTED,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../machine/ts/spec/bmsx/io';
import { Machine } from '../../machine/ts/machine/machine';
import { SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR } from '../../machine/ts/machine/devices/system/controller';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import {
	GX_GPU_PCRTC_SMODE1_HIGH,
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	GX_GPU_PCRTC_SYNCH1_HIGH,
	GX_GPU_PCRTC_SYNCH1_LOW,
	GX_GPU_PCRTC_SYNCH2_LOW,
	GX_GPU_PCRTC_SYNCV_HIGH,
	GX_GPU_PCRTC_SYNCV_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import { decodeBlua32BootHeader } from '../../toolchain/ts/rompack/blua32_image';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { asClosure, valueInteger, valueNil, valueTable, valuePayload } from '../../machine/ts/machine/cpu/value';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { COP0_EXEC } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { InputControllerInputSource } from '../../machine/ts/machine/devices/input/contracts';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from './cpu_test_harness';
import {
	blua32TestFunctionAddress,
	linkRawTestBlua32Pair,
	linkTestBlua32Pair,
	type TestBlua32Source,
} from '../helpers/blua32';

class SystemResetInputSource implements InputControllerInputSource {
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

function createSystemResetRuntime(systemRom: Uint8Array, cartRom: Uint8Array, cart1Rom: Uint8Array = new Uint8Array(0)): Runtime {
	return new Runtime({
		systemRomBytes: systemRom,
		cartridgeSlots: cartridgeSlots(cartRom, cart1Rom),
		machineModel: {
			...PSX_MACHINE_SPEC,
			cpuFreqHz: 5_000_000,
		},
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
		constants: [integerConstant(blua32TestFunctionAddress(CART_ROM_BASE, 0))],
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
	writeInstruction(text, 3, OpCode.CALL, 0, encodeFixedValueCount(0), 2, 0);
	writeInstruction(text, 4, OpCode.SETGL, 0, 0, 1, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(text, 6, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 0, 2, 0, 0);
	writeInstruction(text, 8, OpCode.RFE, 0, 0, 0, 0);
	return {
		text,
		functions: [
			{ firstWord: 0, wordCount: 6 },
			{ firstWord: 6, wordCount: 2, staticClosure },
			{ firstWord: 8, wordCount: 1 },
		],
		constants: [integerConstant(value)],
		globalNames: [
			CART_CLOSURE_GLOBAL_NAME,
			CART_CLOSURE_RESULT_GLOBAL_NAME,
		],
		debugRanges: [range, range, range, range, range, range, range, range, range],
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	};
}

function makeCartridgeSelectionSwitchSource(result: 0 | 1): TestBlua32Source {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.K0, 1, 0, 0, 0);
	writeInstruction(text, 2, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(text, 3, result === 0 ? OpCode.K0 : OpCode.K1, 0, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RET, 0, 2, 0, 0);
	return {
		text,
		functions: [{ firstWord: 0, wordCount: 5, maxStack: 2 }],
		constants: [integerConstant(IO_CART_SELECT)],
	};
}

test('system control reset command is write-only, self-clearing, and save-state visible', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, new SystemResetInputSource(), PSX_MACHINE_SPEC);
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

test('supervisor fault capture is published only at the firmware presentation boundary', () => {
	const images = linkRawTestBlua32Pair(
		makeExecutionSelectorSystemSource(),
		makeClosureCartSource(1, 'fault_publication_cart.lua', true),
	);
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.boot();
	const memory = runtime.machine.memory;

	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
	assert.equal(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0);
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH);
	assert.equal(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 1);
});

test('synchronous-fault context entry parks unread GPUREAD and its save-state survives until LEAVE', () => {
	const images = linkRawTestBlua32Pair(makeExecutionSelectorSystemSource(), makeClosureCartSource(1, 'readback_fault.lua', true));
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.boot();
	const machine = runtime.machine;
	const gpu = machine.gxGpu;
	const memory = machine.memory;
	const source = gpu.readVramSnapshotBytes();
	const expected = source[0]! | (source[1]! << 8);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.onService(Number.MAX_SAFE_INTEGER);
	const readback = gpu.readDeviceOutput().readbackPort;
	assert.equal(readback.claimReadback(gpu.readDeviceOutput().commandBuffer.executedCommandCount), true);
	readback.pixelBytes[0] = source[0]!;
	readback.pixelBytes[1] = source[1]!;
	readback.completeReadback(readback.token);
	gpu.retireExecutedCommands();
	assert.equal(gpu.readDeviceOutput().readbackPort.phase, GX_GPU_READBACK_READY);
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
	assert.equal(machine.systemController.cpuHeld(), true);
	machine.systemController.onService();
	assert.equal(machine.systemController.cpuHeld(), false);
	assert.notEqual(memory.readMappedU32LE(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE, 0);
	assert.equal(gpu.readDeviceOutput().readbackPort.phase, GX_GPU_READBACK_IDLE);
	assert.equal(gpu.captureState().userIngressContext.readbackPhase, GX_GPU_READBACK_READY);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(
		encodeRuntimeSaveState(captureRuntimeSaveState(runtime)),
		memory.ramByteCount(), source.byteLength,
	));
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
	machine.systemController.onService();
	assert.equal(machine.systemController.supervisorContextActive(), false);
	assert.equal(gpu.readDeviceOutput().readbackPort.phase, GX_GPU_READBACK_READY);
	assert.equal(gpu.readGp0(), expected);
	assert.equal(gpu.readDeviceOutput().readbackPort.phase, GX_GPU_READBACK_IDLE);
});

test('a nested supervisor fault preserves the latched exit request', () => {
	const images = linkRawTestBlua32Pair(
		makeExecutionSelectorSystemSource(),
		makeClosureCartSource(1, 'nested_fault_cart.lua', true),
	);
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.boot();
	const machine = runtime.machine;
	const memory = machine.memory;
	machine.systemController.requestSupervisorLineEdge();
	for (let serviceCount = 0;
		serviceCount < 16
			&& machine.systemController.captureState().supervisorPhase
				!== SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1) {
		const deadline = machine.scheduler.nextDeadline();
		assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
		machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			machine.runDeviceService(machine.scheduler.popDueTimer());
		}
	}
	assert.equal(
		machine.systemController.captureState().supervisorPhase,
		SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
	);
	assert.equal(machine.cpu.enterPendingInterrupt(), true);
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_ENTER);
	machine.systemController.requestSupervisorLineEdge();
	assert.equal(
		memory.readMappedU32LE(IO_SYS_STATUS),
		SYS_STATUS_SUPERVISOR_ACTIVE
			| SYS_STATUS_SUPERVISOR_EXIT_REQUESTED
			| SYS_STATUS_SUPERVISOR_RESUMABLE,
	);

	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);

	assert.equal(
		memory.readMappedU32LE(IO_SYS_STATUS),
		SYS_STATUS_SUPERVISOR_ACTIVE
			| SYS_STATUS_SUPERVISOR_EXIT_REQUESTED
			| SYS_STATUS_SUPERVISOR_RESUMABLE,
	);
	assert.equal(machine.systemController.supervisorContextActive(), true);
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
	assert.equal(machine.systemController.supervisorContextActive(), true);
	for (let serviceCount = 0;
		serviceCount < 16 && machine.systemController.supervisorContextActive();
		serviceCount += 1) {
		const deadline = machine.scheduler.nextDeadline();
		assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
		machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			machine.runDeviceService(machine.scheduler.popDueTimer());
		}
	}
	assert.equal(machine.systemController.supervisorContextActive(), false);
});

test('system timing registers consume scheduler and PCRTC device state without Runtime mappings', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, new SystemResetInputSource(), PSX_MACHINE_SPEC);
	machine.resetDevices();
	machine.scheduler.setNowCycles(PSX_MACHINE_SPEC.cpuFreqHz);
	assert.equal(memory.readMappedWord(IO_SYS_TIME_MS), 1000);
	machine.scheduler.setNowCycles(0);
	machine.refreshDeviceTimings({
		cpuHz: 5_000_000,
		geoWorkUnitsPerSec: PSX_MACHINE_SPEC.geoWorkUnitsPerSec,
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

test('system frame period register retains low-u32 Q16 words without wrapping PCRTC pacing', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, new SystemResetInputSource(), PSX_MACHINE_SPEC);
	machine.resetDevices();
	assert.equal(machine.gxGpu.readPcrtcTiming().frameDurationMillisecondsQ16, 1_317_011);
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 1_317_011);

	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, 0x00000c0f | GX_GPU_PCRTC_SMODE1_SINT);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_HIGH), 0x00000010);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH1_LOW), 0x003fffff);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH1_HIGH), 0x07fff800);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW), 0x07ffffff);

	for (const vector of [
		{ syncvLow: 0, syncvHigh: 0x00039800, refreshUfpsScaled: 15_277, frameWord: 4_289_847_483 },
		{ syncvLow: 0, syncvHigh: 0x00039c00, refreshUfpsScaled: 15_211, frameWord: 13_493_686 },
		{ syncvLow: 0xffffffff, syncvHigh: 0xffffffff, refreshUfpsScaled: 312, frameWord: 3_892_851_843 },
	]) {
		memory.writeMappedU32LE(smode1Address, 0x00000c0f | GX_GPU_PCRTC_SMODE1_SINT);
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW), vector.syncvLow);
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_HIGH), vector.syncvHigh);
		memory.writeMappedU32LE(smode1Address, 0x00000c0f);

		const timing = machine.gxGpu.readPcrtcTiming();
		assert.equal(timing.refreshUfpsScaled, vector.refreshUfpsScaled);
		assert.equal(timing.frameDurationMillisecondsQ16, vector.frameWord);
		assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), vector.frameWord);
		assert.equal(memory.readMappedWord(IO_SYS_FRAME_MS_Q16), vector.frameWord);
		assert.equal(timing.frameDurationMs, 1000 / (vector.refreshUfpsScaled / 1_000_000));
	}

	const timing = machine.gxGpu.readPcrtcTiming();
	assert.equal(timing.halfLineClockNumerator, 3_841_908);
	assert.equal(timing.halfLineClockDenominator, 27_000_000);
	assert.equal(timing.totalHalfLines, 22_516);
	assert.equal(timing.frameDurationMs, 3_205_128.205128205);
	memory.writeMappedU32LE(smode1Address, 0x00000c0f | GX_GPU_PCRTC_SMODE1_SINT);
	assert.equal(timing.frameDurationMillisecondsQ16, 0);
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 0);
	assert.equal(timing.frameDurationMs, 0);
	memory.writeMappedU32LE(smode1Address, 0x00000c0f);
	assert.equal(timing.frameDurationMillisecondsQ16, 3_892_851_843);
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 3_892_851_843);

	const saved = machine.gxGpu.captureState();
	machine.gxGpu.reset();
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 1_317_011);
	machine.gxGpu.restoreState(saved);
	assert.equal(timing.frameDurationMillisecondsQ16, 3_892_851_843);
	assert.equal(memory.readMappedU32LE(IO_SYS_FRAME_MS_Q16), 3_892_851_843);
	assert.equal(timing.frameDurationMs, 3_205_128.205128205);
});

test('system print registers latch writes and publish complete host lines', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, new SystemResetInputSource(), PSX_MACHINE_SPEC);
	machine.resetDevices();
	const output = machine.systemDebugTransmit;

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x68);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x69);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(output.availableByteCount(), 3);
	assert.deepEqual([
		output.readByte(),
		output.readByte(),
		output.readByte(),
	], [0x68, 0x69, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x69);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 1);

	const state = output.captureState();
	output.reset();
	output.restoreState(state);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x69);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 1);
	assert.equal(output.availableByteCount(), 0);

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x20ac);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(output.availableByteCount(), 4);
	assert.deepEqual([
		output.readByte(),
		output.readByte(),
		output.readByte(),
		output.readByte(),
	], [0xe2, 0x82, 0xac, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x20ac);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 1);

	output.reset();
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6f);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6b);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES; index += 1) {
		memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x78);
	}
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(output.availableByteCount(), 3);
	assert.deepEqual([
		output.readByte(),
		output.readByte(),
		output.readByte(),
	], [0x6f, 0x6b, 0x0a]);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x79);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(output.availableByteCount(), 2);
	assert.equal(output.readByte(), 0x79);
	assert.equal(output.readByte(), 0x0a);
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
	unusedSource.constants = [integerConstant(222), 'unused-slot-string'];
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

	const singleStringId = single.machine.cpu.stringPool.intern('post-boot-probe');
	assert.equal(dual.machine.cpu.stringPool.intern('post-boot-probe'), singleStringId);
	assert.equal(revisedDual.machine.cpu.stringPool.intern('post-boot-probe'), singleStringId);
	const singleTableId = single.machine.cpu.createTable(0, 0);
	assert.equal(dual.machine.cpu.createTable(0, 0), singleTableId);
	assert.equal(revisedDual.machine.cpu.createTable(0, 0), singleTableId);

	unusedSlotRom[decodeBlua32BootHeader(unusedSlotRom).imageOffset] ^= 0xff;
	dual.rebootSystem();
});

test('cartridge instruction fetch remains on the EXEC-latched socket when data selection changes', () => {
	const systemSource = makeExecutionSelectorSystemSource();
	const slot0 = linkRawTestBlua32Pair(systemSource, makeCartridgeSelectionSwitchSource(0));
	const slot1 = linkRawTestBlua32Pair(systemSource, makeCartridgeSelectionSwitchSource(1));
	const runtime = createSystemResetRuntime(
		slot0.systemRomBytes,
		slot0.cartRomBytes,
		slot1.cartRomBytes,
	);
	runtime.boot();
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);

	assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(1)]);
	assert.equal(runtime.machine.memory.readMappedU32LE(IO_CART_SELECT), 0);
	assert.equal(runtime.machine.cpu.activeCartridgeSlot(), 1);
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
	const selectedClosureName = cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME);
	const selectedClosureResultName = cpu.stringPool.intern(CART_CLOSURE_RESULT_GLOBAL_NAME);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const slot0Closure = cpu.getGlobalByKey(selectedClosureName);
	const slot0Object = asClosure(slot0Closure, cpu.gc);
	const guest = new SuspendedGuestSession(runtime);
	assert.deepEqual(guest.linkedFunctionLocation(slot0Closure), { domain: 0, address: cpu.captureClosureBinding(slot0Object).functionAddress });
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), valueInteger(111));
	const savedClosureName = cpu.stringPool.intern('saved_closure');
	const closureTableName = cpu.stringPool.intern('closure_table');
	const closureTable = cpu.createTable();
	cpu.gc.tables.set(closureTable, slot0Closure, valueInteger(77));
	cpu.setGlobalByKey(savedClosureName, slot0Closure);
	cpu.setGlobalByKey(closureTableName, valueTable(closureTable));

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	assert.equal(guest.linkedFunctionLocation(slot0Closure)!.domain, 0, 'data selection is not the current instruction bus');
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(guest.linkedFunctionLocation(slot0Closure)!.domain, 0, 'entering a system exception frame does not replace the EXEC latch');
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	const slot1Closure = cpu.getGlobalByKey(selectedClosureName);
	assert.notEqual(slot1Closure, slot0Closure, 'different execution domains own distinct canonical closures');
	assert.equal(cpu.captureClosureBinding(asClosure(slot1Closure, cpu.gc)).functionAddress, cpu.captureClosureBinding(slot0Object).functionAddress, 'both slots use the same mapped address');
	assert.equal(cpu.gc.tables.get(closureTable, slot0Closure), valueInteger(77));
	assert.equal(cpu.gc.tables.get(closureTable, slot1Closure), valueNil());
	assert.deepEqual(guest.linkedFunctionLocation(slot1Closure), { domain: 1, address: cpu.captureClosureBinding(asClosure(slot1Closure, cpu.gc)).functionAddress });
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), valueInteger(222));
	assert.deepEqual(runtime.callClosure(slot0Object), [valueInteger(111)], 'a slot 0 closure still executes slot 0 while slot 1 is active');
	assert.deepEqual(runtime.callClosure(asClosure(slot1Closure, cpu.gc)), [valueInteger(222)], 'the slot 1 closure executes slot 1');
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
	assert.equal(guest.linkedFunctionLocation(slot0Closure)!.domain, 0, 'source lookup follows the closure, not the current EXEC latch');

		const saveBytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), valueInteger(111));

		applyRuntimeSaveState(
			runtime,
			decodeRuntimeSaveState(
				saveBytes,
				runtime.machine.memory.ramByteCount(),
				runtime.machine.gxGpu.readVramSnapshotBytes().byteLength,
			),
		);
	const restoredClosure = cpu.getGlobalByKey(savedClosureName);
	const restoredTable = valuePayload(cpu.getGlobalByKey(closureTableName));
	assert.equal(restoredClosure, slot0Closure, 'restoring the heap retains the slot 0 closure address');
	assert.equal(cpu.gc.tables.get(restoredTable, restoredClosure), valueInteger(77));
	const restoredPublishedClosure = cpu.getGlobalByKey(selectedClosureName);
	assert.notEqual(restoredPublishedClosure, restoredClosure);
	assert.equal(cpu.gc.tables.get(restoredTable, restoredPublishedClosure), valueNil());
	assert.equal(cpu.activeCartridgeSlot(), 1);
	assert.equal(cpu.getGlobalByKey(selectedClosureResultName), valueInteger(222));
	assert.equal(guest.linkedFunctionLocation(restoredClosure)!.domain, 0, 'wire restore retains the closure-bound domain');
	assert.equal(guest.linkedFunctionLocation(restoredPublishedClosure)!.domain, 1);
	assert.deepEqual(runtime.callClosure(asClosure(restoredClosure, cpu.gc)), [valueInteger(111)]);
	assert.deepEqual(runtime.callClosure(asClosure(restoredPublishedClosure, cpu.gc)), [valueInteger(222)]);
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
	const selectedClosureName = cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME);
	const firstClosure = cpu.getGlobalByKey(selectedClosureName);
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const secondClosure = cpu.getGlobalByKey(selectedClosureName);
	assert.notEqual(firstClosure, secondClosure);
	assert.deepEqual(cpu.captureClosureBinding(asClosure(firstClosure, cpu.gc)), cpu.captureClosureBinding(asClosure(secondClosure, cpu.gc)));

	const firstName = cpu.stringPool.intern('first_closure');
	const secondName = cpu.stringPool.intern('second_closure');
	const tableName = cpu.stringPool.intern('closure_table');
	const closureTable = cpu.createTable(0, 2);
	cpu.gc.tables.set(closureTable, firstClosure, valueInteger(11));
	cpu.gc.tables.set(closureTable, secondClosure, valueInteger(22));
	cpu.setGlobalByKey(firstName, firstClosure);
	cpu.setGlobalByKey(secondName, secondClosure);
	cpu.setGlobalByKey(tableName, valueTable(closureTable));

	const saveBytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			saveBytes,
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().byteLength,
		),
	);

	const restoredFirst = cpu.getGlobalByKey(firstName);
	const restoredSecond = cpu.getGlobalByKey(secondName);
	const restoredTable = valuePayload(cpu.getGlobalByKey(tableName));
	assert.notEqual(restoredFirst, restoredSecond);
	assert.deepEqual(cpu.captureClosureBinding(asClosure(restoredFirst, cpu.gc)), cpu.captureClosureBinding(asClosure(restoredSecond, cpu.gc)));
	assert.equal(cpu.gc.tables.get(restoredTable, restoredFirst), valueInteger(11));
	assert.equal(cpu.gc.tables.get(restoredTable, restoredSecond), valueInteger(22));
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
	const selectedClosureName = cpu.stringPool.intern(CART_CLOSURE_GLOBAL_NAME);
	const dynamicClosure = cpu.getGlobalByKey(selectedClosureName);
	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const canonicalClosure = cpu.getGlobalByKey(selectedClosureName);
	assert.notEqual(dynamicClosure, canonicalClosure);
	assert.equal(cpu.captureClosureBinding(asClosure(dynamicClosure, cpu.gc)).functionAddress, cpu.captureClosureBinding(asClosure(canonicalClosure, cpu.gc)).functionAddress);

	const dynamicName = cpu.stringPool.intern('dynamic_closure');
	const canonicalName = cpu.stringPool.intern('canonical_closure');
	const tableName = cpu.stringPool.intern('mixed_closure_table');
	const closureTable = cpu.createTable(0, 2);
	cpu.gc.tables.set(closureTable, dynamicClosure, valueInteger(11));
	cpu.gc.tables.set(closureTable, canonicalClosure, valueInteger(22));
	cpu.setGlobalByKey(dynamicName, dynamicClosure);
	cpu.setGlobalByKey(canonicalName, canonicalClosure);
	cpu.setGlobalByKey(tableName, valueTable(closureTable));

	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			encodeRuntimeSaveState(captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().byteLength,
		),
	);
	let restoredDynamic = cpu.getGlobalByKey(dynamicName);
	let restoredCanonical = cpu.getGlobalByKey(canonicalName);
	let restoredTable = valuePayload(cpu.getGlobalByKey(tableName));
	assert.notEqual(restoredDynamic, restoredCanonical);
	assert.equal(cpu.gc.tables.get(restoredTable, restoredDynamic), valueInteger(11));
	assert.equal(cpu.gc.tables.get(restoredTable, restoredCanonical), valueInteger(22));

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			encodeRuntimeSaveState(captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().byteLength,
		),
	);
	restoredDynamic = cpu.getGlobalByKey(dynamicName);
	restoredCanonical = cpu.getGlobalByKey(canonicalName);
	restoredTable = valuePayload(cpu.getGlobalByKey(tableName));
	assert.notEqual(restoredDynamic, restoredCanonical);
	assert.equal(cpu.gc.tables.get(restoredTable, restoredDynamic), valueInteger(11));
	assert.equal(cpu.gc.tables.get(restoredTable, restoredCanonical), valueInteger(22));

	runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(selectedClosureName), restoredCanonical);
	assert.equal(cpu.gc.tables.get(restoredTable, cpu.getGlobalByKey(selectedClosureName)), valueInteger(22));
});
