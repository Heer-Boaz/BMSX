import { integerConstant } from '../../toolchain/ts/lua/number';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_APU_CMD,
	IO_APU_GAIN_Q12,
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SLOT,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_GX_GPU_GP1,
	IO_INP_CTRL,
	IO_INP_STATUS,
	IO_IRQ_FLAGS,
	IRQ_VBLANK,
} from '../../machine/ts/spec/bmsx/io';
import {
	APU_CMD_PLAY,
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_SQUARE,
	APU_RATE_STEP_Q16_ONE,
} from '../../machine/ts/spec/audio/apu';
import {
	GX_GPU_GP1_DISPLAY_MODE,
	GX_GPU_GP1_VERTICAL_DISPLAY_RANGE,
} from '../../machine/ts/spec/gx/gp1';
import {
	GX_GPU_PCRTC_CSR_HSINT,
	GX_GPU_PCRTC_SMODE1_HIGH,
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	GX_GPU_PCRTC_SYNCH1_HIGH,
	GX_GPU_PCRTC_SYNCH1_LOW,
	GX_GPU_PCRTC_SYNCH2_HIGH,
	GX_GPU_PCRTC_SYNCH2_LOW,
	GX_GPU_PCRTC_SYNCV_HIGH,
	GX_GPU_PCRTC_SYNCV_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import {
	GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
	GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
	GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END,
	GxGpuPcrtc,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, linkRawTestSystemBlua32 } from '../helpers/blua32';
import type { InputControllerInputSource } from '../../machine/ts/machine/devices/input/contracts';
import { applyRuntimeMachineState, captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode, HistorySeekResult } from '../../machine/ts/machine/runtime/history/history';
import {
	DEVICE_SERVICE_APU,
	DEVICE_SERVICE_APU_TRANSFER,
} from '../../machine/ts/machine/scheduler/device';
import { FrameSchedulerState, LogicalTickResult } from '../../machine/ts/machine/scheduler/frame';

import { TableWriteRecovery } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueBuiltinFunction, valueInteger, valueNil, valuePayload, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { InstructionStepResult } from '../../machine/ts/machine/runtime/frame/state';
import { BuiltinFunctionId, LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

const PCRTC_SYNCH2_SLOW_WORD = 0x004f84bc;
const PCRTC_SYNCV_192_LINE_FIELD_WORD = 0x00a60005;

class TimingInputSource implements InputControllerInputSource {
	public sampleInputControllerSnapshot(): void {
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

function createTimingRuntime(cpuHz = 5_000_000): Runtime {
	return new Runtime({
		systemRomBytes: new Uint8Array(0),
		cartridgeSlots: cartridgeSlots(),
		machineModel: {
			...PSX_MACHINE_SPEC,
			cpuFreqHz: cpuHz,
		},
	}, new TimingInputSource());
}

function cancelAudioServices(runtime: Runtime): void {
	runtime.machine.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	runtime.machine.scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
}

function runDueAt(runtime: Runtime, cycle: number): boolean {
	runtime.machine.scheduler.advanceTo(cycle);
	return runDueRuntimeTimers(runtime);
}

function configureOneHalfLineField(pcrtc: GxGpuPcrtc, syncvHigh: number): void {
	pcrtc.reset(0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, 0x00000009, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_LOW, 1, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_LOW, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_LOW, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_HIGH, syncvHigh, 0);
	pcrtc.setCpuHz(5_000_000, 0);
}

test('runtime boot timing is decoded from the exact PCRTC reset mode', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);

	assert.equal(runtime.timing.pcrtcRunning, true);
	assert.equal(runtime.timing.ufpsScaled, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
	assert.equal(runtime.timing.totalHalfLines, GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES);
	assert.equal(runtime.timing.activeDisplayHalfLines, GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
	assert.equal(runtime.machine.scheduler.nextDeadline(), 320);
});

test('PCRTC SINT stops only the beam and release starts a fresh line epoch', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.setCpuHz(5_000_000, 0);
	const runningSMode1 = pcrtc.readRegisterWord(GX_GPU_PCRTC_SMODE1_LOW);

	assert.equal(pcrtc.nextDeadlineCycle(), 320);
	pcrtc.service(320);
	assert.notEqual(pcrtc.readCsr() & GX_GPU_PCRTC_CSR_HSINT, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, runningSMode1 | GX_GPU_PCRTC_SMODE1_SINT, 320);
	pcrtc.writeCsr(GX_GPU_PCRTC_CSR_HSINT, 320);
	assert.equal(pcrtc.nextDeadlineCycle(), -1);

	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, runningSMode1, 500);
	assert.equal(pcrtc.nextDeadlineCycle(), 820);
});

test('PCRTC accepts cycle zero and coalesces sub-cycle fields into one runtime edge', () => {
	const pcrtc = new GxGpuPcrtc();
	configureOneHalfLineField(pcrtc, 1 << 21);

	assert.equal(pcrtc.timing.totalHalfLines, 1);
	assert.equal(pcrtc.timing.activeDisplayHalfLines, 0);
	assert.equal(pcrtc.nextDeadlineCycle(), 0);
	assert.equal(pcrtc.service(0) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN, GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN);
	assert.equal(pcrtc.nextDeadlineCycle(), 1);
	assert.equal(pcrtc.service(1) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN, GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN);
	assert.equal(pcrtc.nextDeadlineCycle(), 2);
	assert.equal(pcrtc.field(), 1);
});

test('PCRTC advances exact raw half-lines beyond the double product precision boundary', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, 0x0000082f, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_HIGH, 0x00000010, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_LOW, 0x000ed724, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_HIGH, 0x07b4c800, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_LOW, 0x07d79334, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_LOW, 0xc1611944, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_HIGH, 0x40661ece, 0);
	pcrtc.setCpuHz(50_000_000, 0);

	for (const deadline of [2_029_892, 793_687_425, 1_593_464_523]) {
		assert.equal(pcrtc.nextDeadlineCycle(), deadline);
		pcrtc.service(deadline);
	}
	assert.equal(pcrtc.nextDeadlineCycle(), 10_376_803_360);
	assert.equal(pcrtc.currentHalfLine(10_376_803_359), 10_223);
	assert.equal(pcrtc.currentHalfLine(10_376_803_360), 10_224);
	assert.notEqual(pcrtc.service(10_376_803_360) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END, 0);
	const state = pcrtc.captureState(10_376_803_360);
	assert.equal(state.beamCycleOffset, 0);
	assert.equal(state.beamRemainder, 0);
	assert.equal(state.beamHalfLine, 0);
});

test('runtime publishes live PCRTC timing immediately and latches presentation words at VBlank', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW);

	runtime.machine.memory.writeMappedU32LE(address, PCRTC_SYNCH2_SLOW_WORD);
	assert.equal(runtime.timing.ufpsScaled, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
	runDueRuntimeTimers(runtime);
	assert.equal(runtime.timing.ufpsScaled, 39_808_917);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 125_600);
	let pcrtcState = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(pcrtcState.registerWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);
	assert.notEqual(pcrtcState.presentWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);

	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	pcrtcState = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(pcrtcState.presentWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);
});

// Characterizes the current ordering boundary, not an endorsed resolution of
// a simultaneous CPU store: scheduler time and the MMIO write are driven
// directly here, so no CPU instruction or instruction-boundary is exercised.
test('direct timing MMIO and due VBlank service depend on their call order', () => {
	const observed: Array<[number, number]> = [];
	for (const serviceFirst of [true, false]) {
		const runtime = createTimingRuntime(33_868_800);
		cancelAudioServices(runtime);
		// Service the initial HSync, leaving the old VBlank as the next deadline.
		runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
		const vblankDeadline = runtime.machine.scheduler.nextDeadline();
		runtime.machine.memory.writeMappedU32LE(IO_INP_CTRL, 1);
		runtime.machine.scheduler.advanceTo(vblankDeadline);
		if (serviceFirst) runDueRuntimeTimers(runtime);
		runtime.machine.memory.writeMappedU32LE(
			gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW),
			PCRTC_SYNCH2_SLOW_WORD,
		);
		runDueRuntimeTimers(runtime);
		observed.push([
			runtime.machine.memory.readIoU32(IO_INP_STATUS),
			runtime.machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK,
		]);
	}
	assert.deepEqual(observed, [[1, IRQ_VBLANK], [0, 0]]);
});

// Characterization of the real CPU boundary, not approval of the current
// deadline policy. Both scenarios use the same guest program and runtime
// scheduler; only the start time of the final STORE_MEM_D differs.
test('CPU timing store crossing a due VBlank differs from a store after service', () => {
	const text = new Uint8Array(7 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(text, 2, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(text, 3, OpCode.LOADK, 0, 0, 1, 0);
	writeInstruction(text, 4, OpCode.LOADK, 1, 0, 2, 0);
	writeInstruction(text, 5, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0, 0);
	const timingAddress = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 7, maxStack: 2 }],
		constants: [integerConstant(IO_INP_CTRL), integerConstant(timingAddress), integerConstant(PCRTC_SYNCH2_SLOW_WORD)],
		startupFunctionIndex: 0,
		irqFunctionIndex: 0,
		exceptionFunctionIndex: 0,
	});
	const observed: Array<[number, number]> = [];
	for (const crossing of [true, false]) {
		const runtime = new Runtime({
			systemRomBytes: image.romBytes,
			cartridgeSlots: cartridgeSlots(),
			machineModel: PSX_MACHINE_SPEC,
		}, new TimingInputSource());
		runtime.machine.cpu.reset();
		cancelAudioServices(runtime);
		const frame = {
			updateExecuted: false,
			cycleBudgetRemaining: 100,
			cycleBudgetGranted: 100,
			cycleCarryGranted: 0,
			activeCpuUsedCycles: 0,
		deferredTableWriteCycles: 0,
		};
		// The guest arms INPUT and prepares the timing store itself.
		for (let i = 0; i < 5; i++) runtime.cpuExecution.runInstruction(frame);
		const scheduler = runtime.machine.scheduler;
		advanceRuntimeTime(runtime, scheduler.nextDeadline() - scheduler.nowCycles);
		const deadline = scheduler.nextDeadline();
		advanceRuntimeTime(runtime, deadline - (crossing ? 1 : 0) - scheduler.nowCycles);
		const storePc = runtime.machine.cpu.readFramePc(0);
		runtime.cpuExecution.runInstruction(frame);
		assert.equal(runtime.machine.cpu.readFramePc(0), storePc + INSTRUCTION_BYTES);
		assert.equal(scheduler.nowCycles, deadline + BASE_CYCLES[OpCode.STORE_MEM_D] - (crossing ? 1 : 0));
		assert.equal(runtime.machine.memory.readMappedU32LE(timingAddress), PCRTC_SYNCH2_SLOW_WORD);
		observed.push([
			runtime.machine.memory.readIoU32(IO_INP_STATUS),
			runtime.machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK,
		]);
	}
	assert.deepEqual(observed, [[0, 0], [1, IRQ_VBLANK]]);
});

test('a physically refused WIDE SETT retires before queued VBlank, even after a checkpoint', () => {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.SETT, 0, 1, 2, 0);
	writeInstruction(code, 2, OpCode.K1, 3, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RET, 0, 0, 0, 0);
	const system = linkRawTestSystemBlua32({
		text: code, functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 }],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0, irqFunctionIndex: 0, exceptionFunctionIndex: 0,
	}, 0x10000);
	for (const mode of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		let samples = 0;
		let observeSample: (() => void) | null = null;
		const runtime = new Runtime({
			systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(),
			machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: mode,
		}, {
			sampleInputControllerSnapshot() { ++samples; if (observeSample !== null) observeSample(); },
			supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, scheduler, memory } = runtime.machine;
		const fs = runtime.frameScheduler;
		const initial = captureRuntimeSaveState(runtime);
		assert.ok(fs.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame));
		const edge = scheduler.nowCycles;
		applyRuntimeSaveState(runtime, initial);
		samples = 0;
		const frame = cpu.rootThread.currentFrame!;
		const functionAddress = frame.functionAddress;
		const entry = DYNAMIC_RAM_BASE + 0x9000 - 2 * INSTRUCTION_BYTES;
		memory.writeBytes(entry, code);
		const budget = cpu.luaHeap;
		budget.setCollectionTarget(budget.capacity());
		const tables = cpu.gc.tables, arena = cpu.heapAllocator;
		const owner = cpu.createTable(512, 0);
		for (let key = 1; key <= 512; ++key) tables.setInteger(owner, key, valueInteger(key));
		const payload = cpu.createTable(1, 0);
		tables.setInteger(payload, 1, valueInteger(73));
		frame.registers.set(0, valueTable(owner));
		frame.registers.set(1, valueInteger(1));
		frame.registers.set(2, valueTable(payload));
		frame.top = 4;
		if (mode === CpuExecutionBackend.JavaScript) {
			for (let n = 0; n < 24; ++n) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, entry);
				cpu.runUntilDepth(0, 1);
			}
			const page = frame.executionImage!.decodedPages.get(entry & ~MAPPED_PAGE_BYTE_MASK);
			const block = page?.compiledBlocks?.entries[(entry & MAPPED_PAGE_BYTE_MASK) >>> 2];
			assert.ok(block && block.admissionCycles === 0, 'the actual generated WIDE SETT admits the one-cycle grant');
		}
		tables.setInteger(owner, 1, valueInteger(1));
		// This weak forwarding path does not itself retain the final receiver.
		const receiver = cpu.createTable();
		const forwarding = cpu.createTable(0, 1);
		const weakMode = cpu.createTable(0, 1);
		tables.setStringKey(weakMode, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
		tables.setMetatableAddress(forwarding, weakMode);
		tables.setStringKey(forwarding, cpu.stringPool.intern('__newindex'), valueTable(owner));
		tables.setMetatableAddress(receiver, forwarding);
		frame.registers.set(0, valueTable(receiver));
		frame.registers.set(1, valueInteger(513));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, entry);
		frame.registers.set(3, valueTable(cpu.createTable(225_280, 0)));
		cpu.createTable(1024, 0); // Unreachable, contiguous two-page backing.
		const spare = arena.allocate(HEAP_PAGE_SIZE, true);
		while (arena.allocate(HEAP_PAGE_SIZE, true) !== 0) {}
		arena.free(spare);
		assert.equal(arena.availableWholePages(), 1);
		assert.equal(arena.allocate(5120, true), 0);
		assert.ok(budget.usedBytes() + 2560 < budget.capacity());
		cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		memory.writeMappedU32LE(IO_INP_CTRL, 1);
		observeSample = () => assert.equal(tables.getInteger(owner, 513), valueTable(payload), 'VBlank samples after the table write');
		advanceRuntimeTime(runtime, edge - 1 - scheduler.nowCycles);
		assert.equal(scheduler.nextDeadline(), edge);
		runtime.frameLoop.beginFrameState(1, 0);
		const oldStorage = tables.storageAddress(owner);
		const beforeWrite = captureRuntimeSaveState(runtime);
		assert.equal(fs.stepInstruction(0), InstructionStepResult.Blocked);
		assert.ok(cpu.tableWriteParked());
		let accepted = 1;
		const unchanged = () => {
			assert.equal(scheduler.nowCycles, edge - 1);
			assert.equal(scheduler.nextDeadline(), edge);
			assert.equal(fs.lastTickSequence, 0);
			assert.equal(samples, 0);
			assert.equal(cpu.readFramePc(0), entry);
			assert.equal(runtime.frameLoop.frameState.cycleBudgetRemaining, accepted);
			assert.equal(runtime.frameLoop.frameState.cycleBudgetGranted, accepted);
			assert.equal(runtime.frameLoop.frameState.activeCpuUsedCycles, 0);
			assert.equal(tables.storageAddress(owner), oldStorage);
			assert.equal(tables.getInteger(owner, 513), valueNil());
		};
		unchanged();
		assert.equal(fs.runDevicesToNextLogicalTick(0), false);
		assert.equal(fs.runCyclesToNextLogicalTick(7), false);
		accepted += 7;
		unchanged();
		for (let n = 0; n < 120 && !cpu.gc.finalMarkPending(); ++n)
			assert.equal(fs.advanceLogicalTick(31), LogicalTickResult.Maintenance);
		assert.ok(cpu.gc.finalMarkPending());
		const checkpoint = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		const finish = () => {
			for (let n = 0; n < 120 && !cpu.tableWriteReady(); ++n) {
				assert.equal(fs.advanceLogicalTick(31), LogicalTickResult.Maintenance);
				unchanged();
			}
			assert.ok(cpu.tableWriteReady());
			assert.equal(fs.stepInstruction(0), InstructionStepResult.Executed);
			assert.ok(!cpu.tableWriteParked());
			assert.equal(tables.arrayCapacity(owner), 1024);
			assert.notEqual(tables.storageAddress(owner), oldStorage);
			assert.equal(tables.getInteger(owner, 512), valueInteger(512));
			assert.equal(tables.getInteger(payload, 1), valueInteger(73));
			assert.equal(cpu.readFramePc(0), entry + 2 * INSTRUCTION_BYTES);
			assert.equal(cpu.lastPc, entry + INSTRUCTION_BYTES);
			const charge = BASE_CYCLES[OpCode.SETT] + TABLE_INDEX_VISIT_CYCLES;
			assert.equal(scheduler.nowCycles, edge - 1 + charge);
			assert.equal(fs.lastTickSequence, 1);
			assert.equal(fs.lastTickBudgetGranted, accepted);
			assert.equal(fs.lastTickCpuUsedCycles, charge);
			assert.equal(fs.lastTickBudgetRemaining, accepted - charge);
			assert.equal(samples, 1);
			assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
			return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		};
		const expected = finish();
		samples = 0;
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(checkpoint, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		const restored = finish();
		assert.deepEqual(restored, expected);
		const history = runtime.history;
		const options = { checkpointCapacity: 3, inputCapacity: 4, checkpointIntervalCycles: 10_000_000 };
		const decoded = decodeRuntimeSaveState(checkpoint, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		samples = 0;
		applyRuntimeSaveState(runtime, decoded);
		history.start(options);
		history.captureCheckpoint();
		finish();
		assert.equal(history.latestCycles, edge);
		history.beginSeek(edge - 1);
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.ok(cpu.tableWriteParked());
		history.beginPlayback();
		const liveSamples = samples;
		for (let n = 0; n < 120 && history.mode === HistoryMode.Replaying; ++n) history.advancePlayback(0);
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.ok(!cpu.tableWriteParked());
		assert.equal(fs.lastTickSequence, 1);
		assert.equal(tables.getInteger(owner, 513), valueTable(payload));
		assert.equal(samples, liveSamples, 'playback uses the recorded input boundary');

		history.beginSeek(edge - 1);
		history.beginPlayback();
		history.cancelSeek();
		history.resumeRecording();
		assert.ok(runtime.frameLoop.frameActive && history.checkpointPending, 'cancel and branch preserve the parked frame');
		history.captureCheckpoint();
		samples = 0;
		finish();

		samples = 0;
		applyRuntimeSaveState(runtime, beforeWrite);
		history.start(options);
		history.captureCheckpoint();
		assert.equal(fs.stepInstruction(0), InstructionStepResult.Blocked);
		assert.ok(cpu.tableWriteParked());
		assert.equal(fs.runCyclesToNextLogicalTick(accepted - 1), false);
		finish();
		history.beginSeek(history.latestCycles);
		assert.equal(history.mode, HistoryMode.Replaying);
		assert.ok(!cpu.tableWriteParked());
		assert.equal(history.advanceSeek(accepted), HistorySeekResult.Progressed);
		assert.ok(cpu.tableWriteParked(), 'the initial defer is not a stopped seek');
		assert.equal(scheduler.nowCycles, edge - 1);
		for (let n = 0; n < 120 && history.mode === HistoryMode.Replaying; ++n)
			assert.notEqual(history.advanceSeek(accepted), HistorySeekResult.Stopped);
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.ok(!cpu.tableWriteParked());
		assert.equal(fs.lastTickSequence, 1);
		assert.equal(tables.getInteger(owner, 513), valueTable(payload));
	}
});

test('parked WIDE SETT resumes the fresh epoch and faults once through pcall', () => {
	const code = new Uint8Array(8 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.GETSYS, 0, 0, 0);
	writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(code, 3, OpCode.CALL, 0, 2, 3);
	writeInstruction(code, 4, OpCode.RET, 0, 3, 0);
	writeInstruction(code, 5, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 6, OpCode.SETT, 0, 1, 2);
	writeInstruction(code, 7, OpCode.RET, 0, 0, 0);
	const system = linkRawTestSystemBlua32({
		text: code, functions: [
			{ firstWord: 0, wordCount: 5, maxStack: 8 },
			{ firstWord: 5, wordCount: 3, maxStack: 8 },
		],
		systemGlobalNames: ['pcall', ...LUA_BOOT_PRIMITIVES.map(primitive => primitive.name).filter(name => name !== 'pcall')],
		startupFunctionIndex: 0, irqFunctionIndex: 0, exceptionFunctionIndex: 0,
		closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }],
	});
	const runtime = new Runtime({
		systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
	}, new TimingInputSource());
	runtime.boot();
	const { cpu, scheduler } = runtime.machine;
	const fs = runtime.frameScheduler;
	cpu.setSystemGlobalByKey(cpu.stringPool.intern('pcall'), valueBuiltinFunction(BuiltinFunctionId.PCall));
	for (let n = 0; n < 3; ++n) cpu.runUntilDepth(0, 1);
	assert.equal(cpu.getFrameDepth(), 2);
	assert.equal(cpu.rootThread.protectedDepth, 1);
	const callerPc = cpu.readFramePc(0), writePc = cpu.readFramePc(1);
	const callee = cpu.rootThread.currentFrame!;
	const tables = cpu.gc.tables, budget = cpu.luaHeap, arena = cpu.heapAllocator;
	budget.setCollectionTarget(budget.capacity());
	const owner = cpu.createTable(512, 0);
	for (let i = 1; i <= 512; ++i) tables.setInteger(owner, i, valueInteger(i));
	callee.registers.set(0, valueTable(owner));
	callee.registers.set(1, valueInteger(513));
	callee.registers.set(2, valueInteger(42));
	callee.top = 3;
	const spare = arena.allocate(HEAP_PAGE_SIZE, true);
	while (arena.allocate(HEAP_PAGE_SIZE, true) !== 0) {}
	arena.free(spare);
	cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
	const before = captureRuntimeSaveState(runtime);
	cpu.runUntilDepth(0, 1);
	const charge = 1 - cpu.instructionBudgetRemaining;
	assert.equal(cpu.getFrameDepth(), 1, 'direct CPU retains synchronous recovery');
	assert.equal(charge, BASE_CYCLES[OpCode.SETT] + 2, 'the two pcall results still have their ordinary charges');
	applyRuntimeSaveState(runtime, before);
	runtime.frameLoop.beginFrameState(1, 0);
	const clock = scheduler.nowCycles;
	assert.equal(fs.stepInstruction(0), InstructionStepResult.Blocked);
	assert.ok(cpu.tableWriteParked());
	const drain = () => {
		for (let n = 0; n < 80 && !cpu.tableWriteReady(); ++n)
			assert.equal(fs.stepInstruction(0), InstructionStepResult.Blocked);
		assert.ok(cpu.tableWriteReady());
		assert.equal(cpu.readFramePc(1), writePc);
		assert.equal(scheduler.nowCycles, clock);
		assert.equal(runtime.frameLoop.frameState.cycleBudgetRemaining, 1);
		assert.equal(tables.arrayCapacity(owner), 512);
		assert.equal(tables.getInteger(owner, 513), valueNil());
	};
	drain();
	assert.equal(cpu.captureRuntimeState().pendingTableWrite?.recovery, TableWriteRecovery.RetryCurrent);
	assert.equal(fs.advanceLogicalTick(0), LogicalTickResult.DeferredCpu);
	assert.equal(cpu.captureRuntimeState().pendingTableWrite?.recovery, TableWriteRecovery.Fresh);
	const checkpoint = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const finish = () => {
		drain();
		assert.equal(cpu.captureRuntimeState().pendingTableWrite?.recovery, TableWriteRecovery.RetryFresh);
		assert.equal(fs.stepInstruction(0), InstructionStepResult.Executed);
		assert.ok(!cpu.tableWriteParked());
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(cpu.rootThread.protectedDepth, 0);
		assert.equal(cpu.readFramePc(0), callerPc);
		assert.equal(cpu.lastPc, writePc + INSTRUCTION_BYTES);
		assert.equal(tables.getInteger(owner, 513), valueNil());
		const regs = cpu.rootThread.currentFrame!.registers;
		assert.equal(regs.get(0), valueBool(false));
		assert.equal(cpu.stringPool.toString(valuePayload(regs.get(1))), 'Out of memory.');
		assert.equal(scheduler.nowCycles, clock + charge);
		assert.equal(runtime.frameLoop.frameState.cycleBudgetRemaining, 1 - charge);
		assert.equal(runtime.frameLoop.frameState.activeCpuUsedCycles, charge);
	};
	finish();
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(checkpoint, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	finish();
});

test('legacy GP1 display words cannot drive the PCRTC clock', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const deadline = runtime.machine.scheduler.nextDeadline();
	const revision = runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming.revision;

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_DISPLAY_MODE << 24);
	runtime.machine.memory.writeMappedU32LE(
		IO_GX_GPU_GP1,
		(GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | 0x00038020,
	);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), 0);
	assert.equal(runtime.machine.gxGpu.readVerticalDisplayRangeWord(), 0x00038020);
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming.revision, revision);
	assert.equal(runtime.machine.scheduler.nextDeadline(), deadline);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
});

test('runtime preserves the GX-GPU-owned GP1 readiness binding', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);

	assert.equal(runtime.machine.memory.mappedWriteReady(IO_GX_GPU_GP1), true);
	runtime.machine.gxGpu.beginSupervisorControlQuiesce();
	assert.equal(runtime.machine.memory.mappedWriteReady(IO_GX_GPU_GP1), false);
});

test('runtime restore preserves physical beam phase and a pending presentation timing write', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_HIGH);
	runtime.machine.memory.writeMappedU32LE(address, PCRTC_SYNCV_192_LINE_FIELD_WORD);
	runDueRuntimeTimers(runtime);
	assert.equal(runtime.timing.activeDisplayHalfLines, 384);
	const pendingState = captureRuntimeMachineState(runtime);
	const pendingDeadline = runtime.machine.scheduler.nextDeadline();

	runDueAt(runtime, pendingDeadline);
	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	assert.equal(
		captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc.presentWords[GX_GPU_PCRTC_SYNCV_HIGH],
		PCRTC_SYNCV_192_LINE_FIELD_WORD,
	);

	applyRuntimeMachineState(runtime, pendingState);
	const restoredPcrtc = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(restoredPcrtc.registerWords[GX_GPU_PCRTC_SYNCV_HIGH], PCRTC_SYNCV_192_LINE_FIELD_WORD);
	assert.notEqual(restoredPcrtc.presentWords[GX_GPU_PCRTC_SYNCV_HIGH], PCRTC_SYNCV_192_LINE_FIELD_WORD);
	assert.equal(runtime.timing.activeDisplayHalfLines, 384);
	assert.equal(runtime.machine.scheduler.nextDeadline(), pendingDeadline);
});

test('runtime restore preserves an in-flight frame budget', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	runtime.frameLoop.beginFrameState(23_456, 34_567);
	const active = runtime.frameLoop.frameState;
	active.updateExecuted = true;
	active.cycleBudgetRemaining = 12_345;
	active.activeCpuUsedCycles = 45_678;
	const snapshot = captureRuntimeMachineState(runtime);

	runtime.frameLoop.frameActive = false;
	active.updateExecuted = false;
	active.cycleBudgetRemaining = 99;
	active.cycleBudgetGranted = 98;
	active.cycleCarryGranted = 97;
	active.activeCpuUsedCycles = 96;
	applyRuntimeMachineState(runtime, snapshot);

	assert.deepEqual(runtime.frameLoop.captureState(), snapshot.frameLoop);
	assert.equal(runtime.vblank.tickCompleted, false);
});

test('host machine-cycle grants remain exact while PCRTC is stopped', () => {
	const grants: number[] = [];
	let scheduler!: FrameSchedulerState;
	const frameState = {
		cycleBudgetRemaining: 0,
		cycleBudgetGranted: 0,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
		deferredTableWriteCycles: 0,
	};
	const frameLoop = {
		frameActive: false,
		frameState,
		beginFrameState(budget: number, carry: number): void {
			this.frameActive = true;
			frameState.cycleBudgetRemaining = budget;
			frameState.cycleBudgetGranted = budget;
			frameState.cycleCarryGranted = carry;
		},
		tickUpdate(): boolean {
			if (!this.frameActive && !scheduler.startScheduledFrame()) return false;
			grants.push(frameState.cycleBudgetRemaining);
			this.frameActive = false;
			return true;
		},
	};
	const runtime = {
		history: { mode: HistoryMode.Disabled, executionPaused: false },
		timing: { cpuHz: 5_000_000, cpuCyclesPerMillisecond: 5_000, pcrtcRunning: false },
		machine: createTimingRuntime().machine,
		frameLoop,
	} as unknown as Runtime;
	scheduler = new FrameSchedulerState(runtime);
	(runtime as unknown as { frameScheduler: FrameSchedulerState }).frameScheduler = scheduler;

	scheduler.run(50);
	assert.deepEqual(grants, [250_000]);

	scheduler.reset();
	grants.length = 0;
	for (let hostFrame = 0; hostFrame < 2; hostFrame += 1) {
		scheduler.run(0.0001);
	}
	assert.deepEqual(grants, [1]);
});

test('stopped PCRTC has no video deadline and hardware reset restores the exact beam', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	const runningWord = runtime.machine.memory.readMappedU32LE(address);
	runtime.machine.memory.writeMappedU32LE(address, runningWord | GX_GPU_PCRTC_SMODE1_SINT);
	runDueRuntimeTimers(runtime);

	assert.equal(runtime.timing.pcrtcRunning, false);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 0);
	assert.equal(runtime.machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	runtime.resetHardwareState();
	cancelAudioServices(runtime);
	assert.equal(runtime.timing.pcrtcRunning, true);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
	assert.equal(runtime.machine.scheduler.nextDeadline(), 320);
});

test('PCRTC retains frame cycle budgets above a signed 32-bit CPU slice', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.setCpuHz(110_000_000_000, 0);
	assert.ok(pcrtc.timing.nextVblankCycleBudget > 0x7fffffff);
});

test('VBlank reset and runtime restore preserve the active APU clock domain', () => {
	const runtime = createTimingRuntime();
	const memory = runtime.machine.memory;
	memory.writeMappedU32LE(IO_APU_SOURCE_SAMPLE_RATE_HZ, runtime.timing.cpuHz);
	memory.writeMappedU32LE(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedU32LE(IO_APU_SOURCE_FRAME_COUNT, 2);
	memory.writeMappedU32LE(IO_APU_SOURCE_LOOP_END_SAMPLE, 2);
	memory.writeMappedU32LE(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeMappedU32LE(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
	memory.writeMappedU32LE(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeMappedU32LE(IO_APU_GENERATOR_DUTY_Q12, 0x0800);
	memory.writeMappedU32LE(IO_APU_SLOT, 1);
	memory.writeMappedU32LE(IO_APU_CMD, APU_CMD_PLAY);
	runtime.machine.audioController.onService(0);

	runtime.machine.scheduler.advanceTo(100_000);
	runtime.machine.audioController.onService(100_000);
	runtime.machine.audioOutput.outputRing.clear();
	runtime.vblank.reset();
	assert.equal(runtime.machine.scheduler.nowCycles, 100_000);
	runtime.machine.scheduler.advanceTo(100_114);
	runtime.machine.audioController.onService(100_114);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 1);

	const state = captureRuntimeMachineState(runtime);
	runtime.machine.scheduler.advanceTo(200_000);
	runtime.machine.audioController.onService(200_000);
	runtime.machine.audioOutput.outputRing.clear();
	applyRuntimeMachineState(runtime, state);
	assert.equal(runtime.machine.scheduler.nowCycles, 100_114);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 0);
	runtime.machine.scheduler.advanceTo(100_228);
	runtime.machine.audioController.onService(100_228);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 1);

	runtime.resetHardwareState();
	assert.equal(runtime.machine.scheduler.nowCycles, 0);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 0);
});
