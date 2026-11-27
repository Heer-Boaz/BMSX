import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PREPARED_ENTRY, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { THREAD_CONTROL_COUNT_MASK, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueInteger, valuePayload, valueTable } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CPU_CAUSE_CODE_DATA_BUS_ERROR, CPU_CAUSE_CODE_MASK, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, instructionOpcode, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET,
	HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_RESULT_FAULT,
	HeapServiceBiosCallField, HeapServiceBiosCallKind, HeapServiceOperation, HeapServiceResidentField, PreparedFrameField,
} from '../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { createTestBlua32PairCpu, linkTestBlua32Pair, linkTestSystemBlua32 } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

const program = `
local function hold(value) return value end
local function callee(a,b,...) local c,d=...; return a,b,c,d end
local function caller(f,x,y) local a,b,c,d=f(x,y,123,456); return a,b,c,d end
return hold,caller,callee
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const level of [0, 3] as const) {
	function fixture() {
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(program, level));
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
		runGuestToHalt(cpu, 65536);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const [hold, caller, callee] = runtime.readCompletionValues();
		const arg = valueTable(cpu.createTable(0, 0));
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(901)]);
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(902)]);
		cpu.beginCompletionCall(valuePayload(caller), [callee, arg, valueInteger(19)]);
		const thread = cpu.activeThread, parent = thread.currentFrame!;
		assert.equal(thread.frameDepth, 3);
		const readThread = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
		const management = arena.managementOffset();
		const armed = (field: HeapServiceBiosCallField) => memory.readRamRecordWord(management + HEAP_SERVICE_BIOS_CALL_OFFSET + field);
		const resident = (field: HeapServiceResidentField) => memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + field);
		const prepared = (field: FrameField | PreparedFrameField) => memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + field);
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(2, cycles, undefined, CpuRunKind.Scheduled);
			return { result, used: cycles - cpu.instructionBudgetRemaining };
		}
		for (let n = 0; n < 128 && instructionOpcode(memory.readMappedU32LE(parent.pc)) !== OpCode.CALL; ++n)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(instructionOpcode(memory.readMappedU32LE(parent.pc)), OpCode.CALL);
		const issue = parent.pc, depth = thread.frameDepth;
		const stack = readThread(ThreadField.StackBlock), frames = readThread(ThreadField.FrameBlock), charged = cpu.luaHeap.usedBytes();
		function launch() {
			assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.CALL] });
			assert.ok(cpu.heapServiceActive());
			assert.equal(armed(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags),
				FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY);
			assert.equal(resident(HeapServiceResidentField.IssuePc), issue);
			assert.equal(prepared(FrameField.Closure), valuePayload(callee));
			assert.equal(prepared(PreparedFrameField.Supplied), 4);
			assert.equal(prepared(PreparedFrameField.RelocateFormals), 1);
			assert.equal(prepared(FrameField.CallSite), issue);
			assert.equal(parent.pc, issue + INSTRUCTION_BYTES);
			assert.equal(thread.frameDepth, depth);
		}
		function finishReservation() {
			const trace: number[] = [];
			for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) {
				const { result, used } = grant(137);
				assert.equal(result, RunResult.Yielded);
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(armed(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
			return trace;
		}
		return { runtime, cpu, memory, arena, thread, parent, management, issue, depth, stack, frames, charged,
			readThread, resident, prepared, launch, grant, finishReservation, arg };
	}
	test(`each cold ordinary CALL preserves a prepared frame until capacity and resumes once at O${level}`, () => {
		const f = fixture(), { cpu, memory, thread } = f;
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.launch();
		assert.equal(f.readThread(ThreadField.StackBlock), f.stack);
		assert.equal(f.readThread(ThreadField.FrameBlock), f.frames);
		assert.equal(cpu.luaHeap.usedBytes(), f.charged);
		assert.equal(f.grant(17).result, RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		const checkpoint = cpu.captureRuntimeState(), partial = history.capture(memory, baseline);
		function end() {
			const trace = f.finishReservation();
			assert.equal(thread.frameDepth, f.depth + 1);
			assert.equal(f.resident(HeapServiceResidentField.SourceCount), 0, 'resident reservation returns no Values');
			assert.equal(thread.currentFrame!.pc, f.prepared(FrameField.Pc), 'no instruction in the new frame has run');
			assert.equal(thread.currentFrame!.registers.get(0), f.arg);
			assert.equal(thread.currentFrame!.registers.get(1), valueInteger(19));
			assert.equal(thread.stackRegisters.get(thread.currentFrame!.varargBase), valueInteger(123));
			assert.equal(thread.stackRegisters.get(thread.currentFrame!.varargBase + 1), valueInteger(456));
			assert.notEqual(f.readThread(ThreadField.FrameBlock), f.frames);
			for (let i = 0; i < 8 && f.grant(32768).result !== RunResult.Halted; ++i) { /* until exact caller-parent depth */ }
			assert.equal(thread.frameDepth, 2);
			assert.deepEqual(f.runtime.readCompletionValues(), [f.arg, valueInteger(19), valueInteger(123), valueInteger(456)]);
			return trace;
		}
		const trace = end(), terminal = history.capture(memory, partial);
		history.restore(memory, terminal, partial);
		cpu.restoreRuntimeState(checkpoint);
		assert.deepEqual(end(), trace);
	});

	test(`terminal backing OOM reports the paid CALL issue without publishing its frame at O${level}`, () => {
		const f = fixture(), { cpu, arena } = f;
		while (arena.allocate(4088, true)) { /* occupy entire pages */ }
		while (arena.allocate(24, true)) { /* exhaust remaining allocatable extents */ }
		f.launch();
		f.finishReservation();
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
		assert.equal(f.resident(HeapServiceResidentField.SourceCount), HEAP_SERVICE_RESULT_FAULT);
		assert.equal(f.resident(HeapServiceResidentField.SourceBase), LUA_FAULT_REASON_OUT_OF_MEMORY);
		assert.equal(cpu.readEpcWord(), f.issue);
		assert.equal(f.readThread(ThreadField.StackBlock), f.stack);
		assert.equal(f.readThread(ThreadField.FrameBlock), f.frames);
		assert.equal(cpu.gc.tableRecordAddress(valuePayload(f.arg)), valuePayload(f.arg));
	});
}

for (const optLevel of [0, 3] as const) test(`an ordinary cartridge CLOSURE and CALL cannot enter the private backing root at O${optLevel}`, () => {
	const boot = compileHeapServiceSystem(`cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`, optLevel);
	const cartSource = 'local a,b,c,d=121,122,123,124; return a,b,c,d';
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'cart.lua').chunk, [], { entrySource: cartSource, optLevel });
	const linked = linkTestBlua32Pair(boot, cart);
	const entry = linked.cartImage.functions.find(fn => fn.address === linked.cartVectors.entryFunctionAddress)!;
	const text = linked.cartRomBytes.subarray(entry.codeAddress - CART_ROM_BASE, entry.codeAddress - CART_ROM_BASE + entry.codeByteCount);
	assert.ok(entry.maxStack >= 5);
	assert.ok(text.byteLength >= 5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 2, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, encodeFixedValueCount(4), encodeFixedValueCount(0));
	writeInstruction(text, 4, OpCode.RET, 0, encodeFixedValueCount(0), 0);
	const { cpu, memory } = createTestBlua32PairCpu(linked);
	runGuestToHalt(cpu, 65_536);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const descriptor = memory.readMappedU32LE(linked.systemImage.address + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
	const target = memory.readMappedU32LE(descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HeapServiceOperation.ReserveFrameSpace);
	assert.notEqual(target, 0);
	assert.equal(memory.readMappedU32LE(target + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT, 0);
	const thread = cpu.activeThread, depth = thread.frameDepth;
	// Make the actual CALL fit; an unrelated legitimate backing request
	// must not obscure whether the called ROM address gets private access.
	thread.reserveFrame(128);
	const caller = thread.currentFrame!;
	assert.equal(caller.pc, entry.codeAddress + INSTRUCTION_BYTES);
	const management = cpu.heapAllocator.managementOffset();
	const prepared = memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + FrameField.Function);
	const residentPc = memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.IssuePc);
	const valueCapacity = memory.readRamRecordWord(thread.address + ThreadField.StackCapacity);
	const frameCapacity = memory.readRamRecordWord(thread.address + ThreadField.FrameCapacity);
	caller.registers.setInteger(0, target);
	caller.registers.setInteger(1, thread.address);
	caller.registers.setInteger(2, valueCapacity + 1);
	caller.registers.setInteger(3, (frameCapacity & THREAD_CONTROL_COUNT_MASK) + 1);
	caller.registers.setInteger(4, 0);
	cpu.clearHaltUntilIrq();
	const callPc = entry.codeAddress + 3 * INSTRUCTION_BYTES;
	for (let i = 0; i < 4096 && (caller.pc !== callPc || cpu.heapServiceActive()); ++i) {
		if (cpu.heapServiceActive())
			assert.notEqual(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function), target);
		cpu.runUntilDepth(0, 1);
	}
	assert.equal(caller.pc, callPc);
	assert.equal(caller.registers.getTag(0), ValueTag.Closure, 'raw address constructs only a normal Closure');
	assert.equal(cpu.heapServiceActive(), false);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.heapServiceActive(), false, 'ordinary CALL cannot dispatch the target as a fixed root');
	assert.equal(thread.frameDepth, depth + 1);
	assert.equal(thread.currentFrame!.functionAddress, target, 'the address really is attempted in an ordinary frame');
	for (let i = 0; i < 64 && memory.readBusFaultSequence() === 0; ++i) {
		assert.equal(cpu.heapServiceActive(), false);
		cpu.runUntilDepth(0, 1);
	}
	assert.equal(memory.readBusFaultSequence(), 1);
	assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	const faultPc = cpu.readEpcWord();
	const targetCode = linked.systemImage.functions.find(fn => fn.address === target)!;
	assert.ok(faultPc >= targetCode.codeAddress && faultPc < targetCode.codeAddress + targetCode.codeByteCount);
	const faulting = decodeBlua32InstructionAtPc(linked.systemImage.textBytes, linked.systemImage.header.textAddress, faultPc);
	assert.ok(faulting.op === OpCode.LOAD_MEM || faulting.op === OpCode.LOAD_MEM_D);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackCapacity), valueCapacity);
	assert.equal(memory.readRamRecordWord(thread.address + ThreadField.FrameCapacity), frameCapacity);
	assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + FrameField.Function), prepared);
	assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.IssuePc), residentPc);
});
