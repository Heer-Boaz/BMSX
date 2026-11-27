import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { type Value, valueFloatBits, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_CAUSE, COP0_CONTEXT, COP0_EPC, COP0_IRQ_VECTOR, COP0_STATUS, CPU_CAUSE_CODE_SYSCALL, CPU_CAUSE_IRQ, CPU_STATUS_CART_ENTRY, CPU_STATUS_SYSTEM_ENTRY } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_ROOT_BANKS_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const word = INSTRUCTION_BYTES, a = CPU_FIXED_STACK_BASE - 0x4000, b = CPU_FIXED_STACK_BASE - 0x3000;
const controls = (context: number) => context + 0x100;
const values = (context: number) => context + 0x200;
const returningValue = valueInteger(0x719b6cad);
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

function assemble(status: number, payload: Value, source: number, redirect: boolean) {
	const constants: number[] = [], relocations: { slot: number; fn: number; at: number }[] = [];
	const instructions: [OpCode, number, number, number][] = [];
	const functions: { firstWord: number; wordCount: number; maxStack: number }[] = [];
	const capacity = Math.max(8, source + 1);
	function body(maxStack: number, emit: () => void) {
		const firstWord = instructions.length;
		emit();
		functions.push({ firstWord, wordCount: instructions.length - firstWord, maxStack });
	}
	function constant(register: number, value: number) {
		const slot = constants.length;
		constants.push(value);
		instructions.push([OpCode.LOADK, register, slot >>> 6, slot & 63]);
	}
	function reference(register: number, fn: number, at: number) {
		const slot = constants.length;
		relocations.push({ slot, fn, at });
		constant(register, -1 - slot);
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		constant(0, value);
		constant(1, address);
		instructions.push([OpCode.STORE_MEM, 0, 1, kind]);
	}
	function prepare(context: number, fn: number, count: number, top: number, slot: number, value: Value) {
		const frame = controls(context), backing = values(context);
		for (const [field, data] of [
			[ThreadField.StackTop, count], [ThreadField.StackBlock, backing], [ThreadField.StackCapacity, count],
			[ThreadField.FrameCapacity, 2], [ThreadField.FrameDepth, 1], [ThreadField.FrameBlock, frame],
			[frame - context + FrameField.Protected, -1], [frame - context + FrameField.StackCapacity, count],
			[frame - context + FrameField.Top, top],
		] as const) store(context + field, data);
		reference(0, fn, -1);
		constant(1, frame + FrameField.Function);
		instructions.push([OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word]);
		reference(0, fn, 0);
		constant(1, frame + FrameField.Pc);
		instructions.push([OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word]);
		store(backing + 4 * slot, valuePayload(value));
		store(backing + 4 * count + slot, valueTag(value), MemoryAccessKind.U8);
	}
	body(8, () => {
		prepare(a, 1, capacity, source + 1, source, payload);
		if (redirect) prepare(b, 4, 8, 1, 0, returningValue);
		store(IO_IRQ_MASK, IRQ_VBLANK);
		reference(0, 3, -1);
		instructions.push([OpCode.MTC0, 0, COP0_IRQ_VECTOR, 0]);
		constant(0, a);
		instructions.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	});
	body(capacity, () => {
		constant(3, status);
		instructions.push([OpCode.MTC0, 3, COP0_STATUS, 0]);
		if (source >= 256) instructions.push([OpCode.WIDE, source >>> 8, 0, 0]);
		instructions.push([OpCode.SVC, source & 63, 0, 0]);
		if (source >= 256) instructions.push([OpCode.WIDE, source >>> 8, 0, 0]);
		instructions.push([OpCode.RET, source & 63, 2, 0]);
	});
	body(8, () => {
		// R0 is the instruction's original tagged operand, not a firmware
		// request selector. Copy it using an ordinary MOV before the checkpoint.
		instructions.push([OpCode.MOV, 4, 0, 0], [OpCode.ARGC, 3, 0, 0], [OpCode.MFC0, 1, COP0_CAUSE, 0], [OpCode.MFC0, 2, COP0_EPC, 0]);
		if (redirect) {
			constant(5, b); constant(6, CPU_INTERRUPTED_CONTEXT_ADDRESS);
			instructions.push([OpCode.STORE_MEM, 5, 6, MemoryAccessKind.Word]);
			reference(5, 4, 1);
			instructions.push([OpCode.MTC0, 5, COP0_EPC, 0]);
		}
		instructions.push([OpCode.RFE, 0, 0, 0]);
	});
	body(8, () => {
		constant(0, IRQ_VBLANK); constant(1, IO_IRQ_ACK);
		instructions.push([OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word], [OpCode.RFE, 0, 0, 0]);
	});
	if (redirect) body(8, () => {
		instructions.push([OpCode.K0, 0, 0, 0], [OpCode.RET, 0, 2, 0]); // Not this first PC.
	});

	const text = new Uint8Array(instructions.length * word);
	for (const [index, instruction] of instructions.entries()) writeInstruction(text, index, ...instruction);
	const { image, romBytes: rom } = linkRawTestSystemBlua32({ text, functions, constants: constants.map(integerConstant),
		verifiedControlFlow: true, irqFunctionIndex: 3, exceptionFunctionIndex: 2 });
	assert.equal(image.header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
	assert.equal(image.header.globalNameCount, 0);
	assert.equal(image.header.systemGlobalNameCount, 0);
	for (const { slot, fn, at } of relocations) {
		const target = image.functions[fn], payload = at < 0 ? target.address : target.codeAddress + at * word;
		writeLE32(rom, image.header.constantTableAddress - SYSTEM_ROM_BASE + slot * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, payload);
	}
	// The independently authored System IRQ is a fixed-bank code function.
	const vector = image.functions[3];
	writeLE32(rom, vector.address - SYSTEM_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, vector.flags | BLUA32_FUNCTION_CODE);
	return { rom, functions: image.functions };
}

for (const { name, status, source, payload, redirect } of [
	{ name: 'supervisor SVC passes Nil as one argument', status: CPU_STATUS_SYSTEM_ENTRY, source: 7, payload: valueNil(), redirect: false },
	{ name: 'user WIDE SVC passes raw Float bits from R256', status: CPU_STATUS_CART_ENTRY, source: 256, payload: valueFloatBits(0xff812345), redirect: false },
	{ name: 'SVC handler can change the physical return bank and EPC', status: CPU_STATUS_SYSTEM_ENTRY, source: 7, payload: valueFloatBits(0x80000000), redirect: true },
]) test(name, t => {
	const { rom, functions } = assemble(status, payload, source, redirect);
	const svc = functions[1].codeAddress + 2 * word, successor = svc + (source >= 256 ? 2 : 1) * word;
	const handler = functions[2].codeAddress, irq = functions[3].codeAddress;
	const returnContext = redirect ? b : a, returnPc = redirect ? functions[4].codeAddress + word : successor;
	function boot() {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		assert.equal(runtime.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		return runtime;
	}
	const runtime = boot(), { cpu, memory } = runtime.machine;
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-raw-svc-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const path = join(directory, 'system.rom'), trace = join(directory, 'trace');
	const tsState = join(directory, 'ts.state'), nativeState = join(directory, 'native.state');
	writeFileSync(path, rom);
	const commands: string[] = [], rows: string[] = [];
	function observe(command: string, row?: string | number) {
		commands.push(command);
		if (row !== undefined) rows.push(String(row));
	}
	function replay(state = tsState) {
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [path, trace, state], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	}
	function hash(rt: Runtime, first: number, length: number) {
		observe(`H ${first} ${first + length}`, hashBytes(rt.machine.memory.ramData(), first, length));
	}
	function grant(rt: Runtime) {
		const { cpu, memory, scheduler } = rt.machine;
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		observe('P', `${depth} ${pc}`);
		const { op, a: operand } = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		if (pc === svc) {
			assert.equal(op, 0x1e);
			assert.equal(operand, source);
		}
		const result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const paid = 1 - cpu.instructionBudgetRemaining;
		assert.equal(paid, op === OpCode.SVC ? 2 : BASE_CYCLES[op] + (op === OpCode.RET ? 1 : 0), `pc=0x${pc.toString(16)}`);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		observe('E 1', `${result} ${paid} 0 ${memory.ramBusEnd()} -1`);
		return result;
	}
	for (let i = 0; i < 256 && cpu.activeThread.address !== a; ++i) assert.equal(grant(runtime), RunResult.Yielded);
	assert.equal(cpu.activeThread.address, a);
	grant(runtime); grant(runtime); // LOADK + STATUS, not SVC yet.
	assert.equal(cpu.readFramePc(0), svc);
	assert.equal(cpu.readFrameRegister(0, source), payload);
	assert.equal(cpu.captureRuntimeState().statusWord, status);
	assert.equal(grant(runtime), RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), 8 << 2);
	assert.equal(cpu.readEpcWord(), successor);
	assert.equal(memory.readRamRecordWord(controls(a) + FrameField.Pc), successor);
	assert.equal(cpu.readFramePc(0), handler);
	assert.equal(cpu.isUserMode(), false);
	const entry = cpu.activeThread.currentFrame!;
	assert.equal(entry.argumentCount, 1);
	assert.equal(entry.top, 1);
	assert.equal(entry.registers.get(0), payload);
	observe('Z', `${CPU_CAUSE_CODE_SYSCALL} 0 ${successor}`);
	hash(runtime, entry.controlOffset, FRAME_CONTROL_BYTES);
	grant(runtime); // MOV copies the passed value, then checkpoint before RFE.
	assert.equal(entry.registers.get(4), payload);
	const backing = entry.thread.stackOffset(), slot = entry.stackBase;
	hash(runtime, backing + 4 * slot, 5 * 4);
	hash(runtime, backing + 4 * entry.thread.stackRegisters.capacity() + slot, 5);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	observe(`i ${IRQ_VBLANK}`);
	assert.equal(cpu.enterPendingInterrupt(), false);
	observe('I', 0);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	observe(`x ${nativeState}`);
	const commandCut = commands.length, rowCut = rows.length;

	function finish(rt: Runtime) {
		const { cpu, memory, irqController } = rt.machine;
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readFramePc(0), handler + word);
		assert.equal(cpu.readFrameRegister(0, 0), payload);
		assert.equal(cpu.readFrameRegister(0, 4), payload);
		assert.equal(cpu.activeThread.currentFrame!.argumentCount, 1);
		assert.equal(irqController.enabledPendingFlags(), IRQ_VBLANK);
		grant(rt); grant(rt); grant(rt);
		assert.equal(cpu.readFrameRegister(0, 3), valueInteger(1));
		assert.equal(cpu.readFrameRegister(0, 1), valueInteger(CPU_CAUSE_CODE_SYSCALL));
		assert.equal(cpu.readFrameRegister(0, 2), valueInteger(successor));
		for (let i = 0; i < 16 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(rt), RunResult.Yielded);
		assert.equal(cpu.activeThread.address, returnContext);
		assert.equal(cpu.rootThread.address, a);
		assert.equal(cpu.readFramePc(0), returnPc);
		assert.equal(cpu.captureRuntimeState().statusWord, status);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.equal(cpu.readFrameRegister(0, redirect ? 0 : source), redirect ? returningValue : payload);
		assert.equal(memory.readRamRecordWord(controls(a) + FrameField.Pc), successor);
		assert.equal(irqController.enabledPendingFlags(), IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', 1);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readFramePc(0), irq);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
		assert.equal(cpu.readEpcWord(), returnPc);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${returnPc}`);
		for (let i = 0; i < 8 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(rt), RunResult.Yielded);
		assert.equal(cpu.activeThread.address, returnContext);
		assert.equal(cpu.rootThread.address, a);
		assert.equal(cpu.readFramePc(0), returnPc);
		assert.equal(irqController.enabledPendingFlags(), 0);
		assert.equal(grant(rt), RunResult.Halted);
		const expected = redirect ? returningValue : payload;
		assert.deepEqual(rt.readCompletionValues(), [expected]);
		observe('c', `1 ${valueTag(expected)} ${valuePayload(expected)}`);
		const management = cpu.heapAllocator.managementOffset(), first = management + HEAP_STRING_METADATA_OFFSET;
		const length = management + HEAP_SERVICE_ROOT_BANKS_OFFSET - first;
		assert.deepEqual(memory.ramData().subarray(first, first + length), new Uint8Array(length));
		hash(rt, first, length);
	}
	finish(runtime);
	replay();
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	commands.splice(0, commands.length, 'X', ...tail);
	rows.splice(0, rows.length, ...expected);
	replay(tsState);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
