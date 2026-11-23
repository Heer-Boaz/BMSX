import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../machine/ts/machine/runtime/frame/state';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import * as geo from '../../machine/ts/machine/devices/geometry/contracts';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import * as io from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

// Public BSS following the fixture's RAM code, for GEO operands and results.
const GEO_BUFFERS = DYNAMIC_RAM_BASE + 0x10000;

// The first record costs six cycles and has no vertices. The second samples
// the vertex at its own start; this places the competing STORE one cycle
// before that real device deadline, without assigning an electrical bus phase.
function observe(mode: CpuExecutionBackend, crossing: boolean, doorbell = false) {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(code, 1, OpCode.JMP, 0, 63, 62, 255);
	const system = linkRawTestSystemBlua32({
		text: code, functions: [{ firstWord: 0, wordCount: 2, maxStack: 2 }],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0, irqFunctionIndex: 0, exceptionFunctionIndex: 0,
	}, 0x15000);
	const runtime = new Runtime({
		systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(),
		machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: mode,
	}, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { memory, scheduler, cpu, geometryController: geoController } = runtime.machine;
	const frame = cpu.activeThread.frameAtDepth(0);
	// Put STORE at the page tail so its generated entry contains precisely one
	// instruction: a one-cycle grant does not take a scalar prefix fallback.
	const entry = DYNAMIC_RAM_BASE + 0x8000 + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	memory.writeBytes(entry, code);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, frame.functionAddress, entry);
	frame.registers.setInteger(0, DYNAMIC_RAM_BASE + 0x4000);
	frame.registers.setInteger(1, 0);
	runtime.frameScheduler.runCyclesToNextLogicalTick(512);
	if (mode === CpuExecutionBackend.JavaScript) {
		const word = (entry & MAPPED_PAGE_BYTE_MASK) >>> 2;
		const page = frame.executionImage.decodedPages.get(entry & ~MAPPED_PAGE_BYTE_MASK);
		const block = page?.compiledBlocks?.entries[word];
		assert.ok(block, 'the STORE loop really has a generated JS entry');
		assert.equal(block.sourceWords, 1, 'the compiled STORE is independently admitted');
		assert.equal(block.admissionCycles, 0, 'a one-cycle grant enters the generated STORE');
	}
	// Preserve warmed code but isolate this timeline from unrelated periodic
	// timer callbacks; GEO is subsequently launched through mapped registers.
	scheduler.reset();
	const record = GEO_BUFFERS + 0x1000;
	const vertex = GEO_BUFFERS + 0x2000;
	const matrix = GEO_BUFFERS + 0x3000;
	const output = GEO_BUFFERS + 0x4000;
	for (const [i, word] of [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, geo.GEO_INDEX_NONE].entries()) memory.writeU32(record + i * 4, word);
	for (const [i, word] of [0x10000, 0, 0, 0, 0x10000, 0].entries()) memory.writeU32(matrix + i * 4, word);
	memory.writeU32(vertex, 0); memory.writeU32(vertex + 4, 0);
	for (const [address, word] of [
		[io.IO_GEO_SRC0, record], [io.IO_GEO_SRC1, vertex], [io.IO_GEO_SRC2, matrix],
		[io.IO_GEO_DST0, output], [io.IO_GEO_COUNT, 2], [io.IO_GEO_STRIDE0, geo.GEO_XFORM2_RECORD_BYTES],
		[io.IO_GEO_STRIDE1, geo.GEO_VERTEX2_BYTES], [io.IO_GEO_STRIDE2, geo.GEO_XFORM2_MATRIX_BYTES],
	]) memory.writeMappedWord(address, word);
	if (doorbell) {
		memory.writeU32(output, 0xdeadbeef);
		memory.writeMappedWord(io.IO_GEO_DST1, output);
		memory.writeMappedWord(io.IO_GEO_COUNT, 0);
		memory.writeMappedWord(io.IO_GEO_PARAM0, geo.GEO_OVERLAP2D_MODE_FULL_PASS);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, frame.functionAddress, entry);
		frame.registers.setInteger(0, io.IO_GEO_CMD);
		frame.registers.setInteger(1, geo.IO_CMD_GEO_OVERLAP2D_PASS);
		const state = { updateExecuted: false, cycleBudgetRemaining: 100, cycleBudgetGranted: 100, cycleCarryGranted: 0, activeCpuUsedCycles: 0, deferredAllocationCycles: 0 };
		assert.equal(runtime.cpuExecution.runInstruction(state), InstructionStepResult.Executed);
		assert.equal(scheduler.nowCycles, 3);
		assert.equal(geoController.captureState().pendingCycles, 4, 'GEO charge begins at the doorbell, not the start of the CPU grant');
		advanceRuntimeTime(runtime, 3);
		assert.equal(memory.readU32(output), 0xdeadbeef);
		assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
		advanceRuntimeTime(runtime, 1);
		assert.equal(memory.readU32(output), 0);
		assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE);
		assert.equal(memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GEO_DONE, io.IRQ_GEO_DONE);
		return { sampled: memory.readU32(output), spent: state.activeCpuUsedCycles, elapsed: scheduler.nowCycles };
	}
	memory.writeMappedWord(io.IO_GEO_CMD, geo.IO_CMD_GEO_XFORM2_BATCH);
	runDueRuntimeTimers(runtime);
	assert.equal(geoController.captureState().pendingCycles, 6, 'empty first record pays its six header words');
	advanceRuntimeTime(runtime, crossing ? 5 : 6);
	const eventCycle = 6;
	if (crossing) assert.equal(scheduler.nextDeadline(), scheduler.nowCycles + 1);
	else assert.equal(geoController.captureState().xform.vertices[0], 0, 'non-crossing control samples before the write');
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, frame.functionAddress, entry);
	frame.registers.setInteger(0, vertex); frame.registers.setInteger(1, 0x10000);
	const state = { updateExecuted: false, cycleBudgetRemaining: 100, cycleBudgetGranted: 100, cycleCarryGranted: 0, activeCpuUsedCycles: 0, deferredAllocationCycles: 0 };
	const start = scheduler.nowCycles;
	assert.equal(runtime.cpuExecution.runInstruction(state), InstructionStepResult.Executed);
	assert.equal(state.cycleBudgetRemaining, 97, 'the runtime grants one instruction and charges all three cycles');
	assert.equal(scheduler.nowCycles, start + BASE_CYCLES[OpCode.STORE_MEM_D]);
	assert.equal(cpu.readFramePc(0), entry + INSTRUCTION_BYTES);
	assert.equal(memory.readU32(vertex), 0x10000);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 1);
	assert.equal(geoController.captureState().pendingCycles, crossing ? 17 : 16, 'the record began at its actual deadline');
	assert.ok(start <= eventCycle);
	return { sampled: geoController.captureState().xform.vertices[0], spent: state.activeCpuUsedCycles, elapsed: scheduler.nowCycles - start };
}

test('STORE across a GEO sampling deadline has the same runtime result in interpreter and JavaScript code', () => {
	const observations = [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript].map(mode => ({
		crossing: observe(mode, true), afterService: observe(mode, false),
	}));
	assert.deepEqual(observations[0], observations[1]);
	assert.deepEqual(observations[0].afterService, { sampled: 0, spent: 3, elapsed: 3 });
	assert.equal(observations[0].crossing.spent, 3);
	assert.equal(observations[0].crossing.elapsed, 3);
	// The physical CPU's memory-publication phase is not specified. Report the
	// observed crossing value without turning it into a hardware expectation.
	console.log(`GEO_STORE_DEADLINE crossing_sample=0x${observations[0].crossing.sampled.toString(16)} after_service_sample=0`);
});

test('GEO summary charge starts at an actual CPU doorbell store', () => {
	for (const mode of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		assert.deepEqual(observe(mode, false, true), { sampled: 0, spent: 3, elapsed: 7 });
	}
});
