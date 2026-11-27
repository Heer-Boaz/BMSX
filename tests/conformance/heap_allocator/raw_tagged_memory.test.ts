import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueFloatBits, valueFromTag, valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	COP0_BAD_ADDRESS, COP0_CONTEXT, COP0_EPC, COP0_EXEC, COP0_RAM_END, COP0_STATUS, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, CPU_CAUSE_CODE_DATA_BUS_ERROR, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_CODE_SYSCALL, CPU_STATUS_CART_ENTRY, CPU_STATUS_SYSTEM_ENTRY,
} from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_VALUE, BUS_FAULT_ACCESS_WRITE, BUS_FAULT_UNMAPPED, IO_CART_RAM_BYTE_COUNT,
	IO_IRQ_MASK, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE,
} from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_FIXED_FRAME_ADDRESS, CPU_FIXED_STACK_BASE, DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const publicCell = DYNAMIC_RAM_BASE + 0x104;
const protectedCell = CPU_FIXED_STACK_BASE - 0x120 + 4;
const aperture = DYNAMIC_RAM_BASE + 0x1000;
const report = CPU_FIXED_STACK_BASE - 0x100;
const word = INSTRUCTION_BYTES;
const guard = 0x83361d92;
const nil = valueFromTag(ValueTag.Nil, 0xdecafbad);
const float = valueFloatBits(0xff812345);

class RawProgram {
	readonly code: [OpCode, number, number, number, number?][] = [];
	readonly constants: number[] = [];
	readonly functions: { firstWord: number; wordCount: number; maxStack: number }[] = [];
	emit(op: OpCode, a = 0, b = 0, c = 0, ext?: number) { this.code.push([op, a, b, c, ext]); }
	load(register: number, value: number) {
		const slot = this.constants.length;
		this.constants.push(value);
		this.emit(OpCode.LOADK, register, slot >>> 6, slot & 63);
	}
	body(emit: () => void) {
		const firstWord = this.code.length;
		emit();
		this.functions.push({ firstWord, wordCount: this.code.length - firstWord, maxStack: 8 });
	}
	seed(address: number, data: number) {
		this.load(6, data); this.load(7, address);
		this.emit(OpCode.STORE_MEM, 6, 7, MemoryAccessKind.Word);
	}
	source(exceptionFunctionIndex = 1) {
		const text = new Uint8Array(this.code.length * word);
		for (const [index, instruction] of this.code.entries()) writeInstruction(text, index, ...instruction);
		return { text, functions: this.functions, constants: this.constants.map(integerConstant),
			exceptionFunctionIndex, verifiedControlFlow: true };
	}
}

function paired(t: TestContext, rom: Uint8Array, cart: Uint8Array | null = null) {
	const boot = () => {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		return runtime;
	};
	const runtime = boot();
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-raw-tagged-memory-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const image = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(image, rom);
	const tsState = join(dir, 'ts.state'), nativeState = join(dir, 'native.state');
	const nativeArgs = [image, trace, tsState];
	if (cart !== null) {
		const card = join(dir, 'card.rom');
		writeFileSync(card, cart);
		nativeArgs.push(card);
	}
	const commands: string[] = [], rows: string[] = [];
	function observe(cmd: string, row?: string | number) {
		commands.push(cmd);
		if (row !== undefined) rows.push(String(row));
	}
	function replay() {
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, nativeArgs, { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	}
	function step(rt = runtime, expectedResult = RunResult.Yielded) {
		const { cpu, memory, scheduler } = rt.machine;
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		observe('P', `${depth} ${pc}`);
		const slot = cpu.activeCartridgeSlot();
		const { op, b, c } = slot === -1 ? decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc)
			: decodeBlua32InstructionAtPc(cart!, CART_ROM_BASE, pc);
		const result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const charged = 1 - cpu.instructionBudgetRemaining;
		assert.equal(result, expectedResult, `PC 0x${pc.toString(16)}`);
		assert.equal(charged, BASE_CYCLES[op] + (op === OpCode.RET ? b - 1 : op === OpCode.STORE_MEM_WORDS ? c : 0), `PC 0x${pc.toString(16)}`);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		observe('E 1', `${result} ${charged} 0 ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
	}
	function inspect(rt: Runtime, address: number, bytes: readonly number[]) {
		const offset = address - RAM_BASE, ram = rt.machine.memory.ramData();
		assert.deepEqual(Array.from(ram.subarray(offset, offset + bytes.length)), bytes);
		observe(`H ${offset} ${offset + bytes.length}`, hashBytes(ram, offset, bytes.length));
	}
	function completion(rt: Runtime, values: ReturnType<Runtime['readCompletionValues']>) {
		assert.deepEqual(rt.readCompletionValues(), values);
		observe('c', [values.length, ...values.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '));
	}
	return { runtime, boot, tsState, nativeState, commands, rows, observe, replay, step, inspect, completion };
}

test('ordinary System tagged Value accesses preserve exact payload, tag and neighboring padding', t => {
	const p = new RawProgram();
	let firstTaggedOp: number, checkpoint: number;
	p.body(() => {
		p.load(0, aperture);
		p.emit(OpCode.MTC0, 0, COP0_RAM_END);
		p.seed(publicCell, valuePayload(nil));
		p.seed(publicCell + word, 0x30201000 | valueTag(nil));
		p.seed(protectedCell, valuePayload(float));
		p.seed(protectedCell + word, 0x60504000 | valueTag(float));
		p.load(2, publicCell);
		p.load(3, protectedCell - 255 * word);
		firstTaggedOp = p.code.length;
		p.emit(OpCode.LOAD_MEM, 0, 2, MemoryAccessKind.Value);
		p.emit(OpCode.LOAD_MEM_D, 1, 3, MemoryAccessKind.Value, 255);
		p.emit(OpCode.STORE_MEM, 1, 2, MemoryAccessKind.Value);
		p.emit(OpCode.STORE_MEM_D, 0, 3, MemoryAccessKind.Value, 255);
		checkpoint = p.code.length;
		p.emit(OpCode.K0, 0);
		p.emit(OpCode.K0, 1);
		p.emit(OpCode.LOAD_MEM_D, 0, 3, MemoryAccessKind.Value, 255);
		p.emit(OpCode.LOAD_MEM, 1, 2, MemoryAccessKind.Value);
		p.emit(OpCode.RET, 0, 3);
	});
	p.body(() => p.emit(OpCode.RFE));
	const { romBytes, image } = linkRawTestSystemBlua32(p.source());
	const { runtime, boot, tsState, nativeState, commands, rows, observe, replay, step, inspect, completion } = paired(t, romBytes);
	for (let i = 0; i < firstTaggedOp!; ++i) step();
	assert.equal(runtime.machine.memory.ramBusEnd(), aperture);
	assert.equal(runtime.machine.cpu.readFramePc(0), image.functions[0].codeAddress + firstTaggedOp! * word);
	step(); step();
	assert.equal(runtime.machine.cpu.readFrameRegister(0, 0), nil);
	assert.equal(runtime.machine.cpu.readFrameRegister(0, 1), float);
	step(); step();
	assert.equal(runtime.machine.cpu.readFramePc(0), image.functions[0].codeAddress + checkpoint! * word);
	inspect(runtime, publicCell, [0x45, 0x23, 0x81, 0xff, 4, 0x10, 0x20, 0x30]);
	inspect(runtime, protectedCell, [0xad, 0xfb, 0xca, 0xde, 0, 0x40, 0x50, 0x60]);
	observe(`x ${nativeState}`);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commandCut = commands.length, rowCut = rows.length;
	function finish(rt: Runtime) {
		inspect(rt, publicCell, [0x45, 0x23, 0x81, 0xff, 4, 0x10, 0x20, 0x30]);
		inspect(rt, protectedCell, [0xad, 0xfb, 0xca, 0xde, 0, 0x40, 0x50, 0x60]);
		for (let i = 0; i < 4; ++i) step(rt);
		step(rt, RunResult.Halted);
		completion(rt, [nil, float]);
	}
	finish(runtime);
	replay();
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	commands.splice(0, commands.length, 'X', ...tail);
	rows.splice(0, rows.length, ...expected);
	replay();
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});

for (const { name, address, load, displacement, user, check, checkTag } of [
	{ name: 'unmapped second word at installed RAM end', address: RAM_BASE + MAIN_RAM_SIZE - word, load: false, displacement: 7, check: RAM_BASE + MAIN_RAM_SIZE - word },
	{ name: 'unmapped second word at fixed register bank', address: CPU_FIXED_FRAME_ADDRESS - word, load: true, displacement: 3, check: CPU_FIXED_FRAME_ADDRESS - word },
	{ name: 'misaligned load', address: publicCell + 1, load: true, displacement: 5, check: publicCell },
	{ name: 'misaligned store', address: protectedCell + 2, load: false, displacement: 0, check: protectedCell, checkTag: true },
	{ name: 'MMIO load', address: IO_IRQ_MASK, load: true, displacement: 0 },
	{ name: 'mixed MMIO/RAM store', address: IO_CART_RAM_BYTE_COUNT, load: false, displacement: 3, check: IO_CART_RAM_BYTE_COUNT + word },
	{ name: 'System ROM store', address: SYSTEM_ROM_BASE, load: false, displacement: 0 },
	{ name: 'user access to public RAM', address: publicCell, load: false, displacement: 7, user: true, check: publicCell, checkTag: true },
]) test(`ordinary tagged Value rejects ${name} without partial effects`, t => {
	const p = new RawProgram();
	let access: number;
	const misaligned = (address & 3) !== 0;
	const op = load ? (displacement ? OpCode.LOAD_MEM_D : OpCode.LOAD_MEM)
		: (displacement ? OpCode.STORE_MEM_D : OpCode.STORE_MEM);
	p.body(() => {
		p.load(0, aperture); p.emit(OpCode.MTC0, 0, COP0_RAM_END);
		if (check !== undefined) {
			p.seed(check, guard);
			if (checkTag) p.seed(check + word, 0x60504004);
		}
		p.load(0, 5); p.load(1, address - displacement * word);
		if (user) { p.load(2, CPU_STATUS_CART_ENTRY); p.emit(OpCode.MTC0, 2, COP0_STATUS); }
		access = p.code.length;
		p.emit(op, 0, 1, MemoryAccessKind.Value, displacement);
		p.emit(OpCode.RET, 0, 2);
	});
	p.body(() => {
		// Report standard CP0 and bus latches with ordinary guest instructions.
		p.emit(OpCode.MFC0, 0, COP0_BAD_ADDRESS);
		p.load(1, IO_SYS_BUS_FAULT_ADDR);
		p.emit(OpCode.LOAD_MEM, 1, 1, MemoryAccessKind.Word);
		p.load(2, IO_SYS_BUS_FAULT_ACCESS);
		p.emit(OpCode.LOAD_MEM, 2, 2, MemoryAccessKind.Word);
		p.load(3, report);
		p.emit(OpCode.STORE_MEM_WORDS, 0, 3, 3);
		p.emit(OpCode.MFC0, 4, COP0_EPC);
		p.load(5, word);
		p.emit(OpCode.ADD, 4, 4, 5);
		p.emit(OpCode.MTC0, 4, COP0_EPC);
		p.emit(OpCode.RFE);
	});
	const { romBytes, image } = linkRawTestSystemBlua32(p.source());
	const { runtime, observe, replay, step, inspect, completion } = paired(t, romBytes);
	const { cpu, memory } = runtime.machine;
	const alignedBytes = [0x92, 0x1d, 0x36, 0x83];
	if (checkTag) alignedBytes.push(4, 0x40, 0x50, 0x60);
	for (let i = 0; i < access!; ++i) step();
	if (check !== undefined) inspect(runtime, check, alignedBytes);
	const start = image.functions[0].codeAddress + access! * word, first = memory.readBusFaultSequence();
	step();
	const cause = misaligned ? (load ? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_ADDRESS_ERROR_STORE)
		: user ? CPU_CAUSE_CODE_RESERVED_INSTRUCTION : CPU_CAUSE_CODE_DATA_BUS_ERROR;
	const busFault = cause === CPU_CAUSE_CODE_DATA_BUS_ERROR;
	const flags = (load ? BUS_FAULT_ACCESS_READ : BUS_FAULT_ACCESS_WRITE) | BUS_FAULT_ACCESS_VALUE;
	assert.equal(cpu.readCauseWord(), cause);
	assert.equal(cpu.readEpcWord(), start);
	assert.equal(cpu.readBadAddressWord(), misaligned ? address : 0);
	assert.equal(memory.readBusFaultSequence(), first + +busFault);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), busFault ? BUS_FAULT_UNMAPPED : 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), busFault ? address : 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), busFault ? flags : 0);
	observe('Z', `${cause} 0 ${start}`);
	for (let i = 0; i < 16 && cpu.getFrameDepth() > 1; ++i) step();
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.readFramePc(0), start + word);
	const words = [misaligned ? address : 0, busFault ? address : 0, busFault ? flags : 0];
	inspect(runtime, report, words.flatMap(value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24]));
	if (check !== undefined) inspect(runtime, check, alignedBytes);
	step(runtime, RunResult.Halted);
	completion(runtime, [valueInteger(5)]); // A denied load didn't overwrite R0.
	replay();
});

test('ordinary tagged Value requires System ROM authority even in cartridge supervisor mode', t => {
	const root = CPU_FIXED_STACK_BASE - 0x2000, frame = root + 0x100;
	const system = new RawProgram(), card = new RawProgram();
	let functionSlot: number, codeSlot: number, cartSlot: number;
	system.body(() => {
		system.load(0, aperture); system.emit(OpCode.MTC0, 0, COP0_RAM_END);
		system.seed(publicCell, guard);
		system.seed(root + ThreadField.StackTop, 8);
		system.seed(root + ThreadField.StackBlock, root + 0x200);
		system.seed(root + ThreadField.StackCapacity, 8);
		system.seed(root + ThreadField.FrameDepth, 1);
		system.seed(root + ThreadField.FrameCapacity, 2);
		system.seed(root + ThreadField.FrameBlock, frame);
		system.seed(frame + FrameField.StackCapacity, 8);
		functionSlot = system.constants.length; system.seed(frame + FrameField.Function, -1);
		codeSlot = system.constants.length; system.seed(frame + FrameField.Pc, -2);
		system.load(0, root); system.emit(OpCode.MTC0, 0, COP0_CONTEXT);
		system.emit(OpCode.RET, 0, 1);
	});
	system.body(() => {
		cartSlot = system.constants.length;
		system.load(0, -3); system.emit(OpCode.MTC0, 0, COP0_EXEC);
		system.emit(OpCode.RET, 0, 1);
	});
	system.body(() => {
		// The cartridge first uses normal SVC entry. Firmware deliberately
		// makes its next instruction supervisor, without changing its domain.
		system.load(0, CPU_STATUS_SYSTEM_ENTRY << 2);
		system.emit(OpCode.MTC0, 0, COP0_STATUS);
		system.emit(OpCode.RFE);
	});
	card.body(() => {
		card.load(0, 0x1234); card.load(1, publicCell);
		card.emit(OpCode.SVC, 0);
		card.emit(OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Value);
		card.emit(OpCode.RET, 0, 2);
	});
	const pair = linkRawTestBlua32Pair(system.source(2), card.source(0));
	for (const [slot, pointer] of [
		[functionSlot!, pair.systemImage.functions[1].address],
		[codeSlot!, pair.systemImage.functions[1].codeAddress],
		[cartSlot!, pair.cartImage.functions[0].address],
	]) {
		writeLE32(pair.systemRomBytes, pair.systemImage.header.constantTableAddress
			+ slot * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, pointer);
	}
	const { runtime, step, observe, replay, inspect } = paired(t, pair.systemRomBytes, pair.cartRomBytes);
	const { cpu, memory } = runtime.machine;
	for (let i = 0; i < 100 && cpu.activeCartridgeSlot() !== 0; ++i) step();
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isUserMode(), true);
	step(); step(); step();
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
	assert.equal(cpu.activeCartridgeSlot(), -1);
	step(); step(); step();
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isUserMode(), false);
	const pc = pair.cartImage.functions[0].codeAddress + 3 * word, before = memory.readBusFaultSequence();
	assert.equal(cpu.readFramePc(0), pc);
	inspect(runtime, publicCell, [0x92, 0x1d, 0x36, 0x83, 0, 0, 0, 0]);
	step();
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
	assert.equal(cpu.readEpcWord(), pc);
	assert.equal(cpu.readBadAddressWord(), 0);
	assert.equal(memory.readBusFaultSequence(), before);
	observe('Z', `${CPU_CAUSE_CODE_RESERVED_INSTRUCTION} 0 ${pc}`);
	inspect(runtime, publicCell, [0x92, 0x1d, 0x36, 0x83, 0, 0, 0, 0]);
	replay();
});
