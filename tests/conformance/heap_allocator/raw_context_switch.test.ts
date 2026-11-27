import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_CAUSE, COP0_CONTEXT, COP0_CURRENT, COP0_EPC, COP0_STATUS, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, CPU_CAUSE_CODE_DATA_BUS_ERROR, CPU_CAUSE_IRQ, CPU_CAUSE_NMI, CPU_STATUS_USER_MODE_CURRENT } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_ROOT_BANKS_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const word = INSTRUCTION_BYTES, valueSlots = 16, window = 8;
const statusA = 0x41, statusB = 0x81;
const markerA = 91, markerB = 173;
const contexts = [CPU_FIXED_STACK_BASE - 0x4000, CPU_FIXED_STACK_BASE - 0x3000];
const privateWord = contexts[0] + 0x300;
const frameBlock = (context: number) => context + 0x100;
const valueBlock = (context: number) => context + 0x200;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

function assemble(user: boolean) {
	const constants: number[] = [], refs: { lane: number; fn: number; at?: number }[] = [];
	const instructions: [OpCode, number, number, number, number?][] = [];
	const functions: { firstWord: number; wordCount: number; maxStack: number }[] = [];
	function functionBody(body: () => void) {
		const firstWord = instructions.length;
		body();
		functions.push({ firstWord, wordCount: instructions.length - firstWord, maxStack: window });
	}
	function load(register: number, value: number) {
		const index = constants.length;
		constants.push(value);
		instructions.push([OpCode.LOADK, register, index >>> 6, index & 63]);
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		load(0, value); load(1, address);
		instructions.push([OpCode.STORE_MEM, 0, 1, kind]);
	}
	function linkStore(address: number, fn: number, at?: number) {
		refs.push({ lane: constants.length, fn, at });
		store(address, -1 - constants.length); // Preserve a distinct immediate for every ROM relocation.
	}
	function frame(base: number, fn: number, at: number, slot: number, top: number) {
		linkStore(base + FrameField.Function, fn);
		linkStore(base + FrameField.CallSite, fn, 0);
		linkStore(base + FrameField.Pc, fn, at);
		store(base + FrameField.Protected, -1);
		store(base + FrameField.VarargBase, slot);
		store(base + FrameField.StackBase, slot);
		store(base + FrameField.StackCapacity, window);
		store(base + FrameField.Top, top);
	}
	function ownedValue(context: number, slot: number, value: number) {
		store(valueBlock(context) + 4 * slot, value);
		store(valueBlock(context) + 4 * valueSlots + slot, ValueTag.Integer, MemoryAccessKind.U8);
	}

	functionBody(() => {
		// Only reset firmware writes these physical banks. Neither runtime
		// is given a prepared save, managed records, or an allocator.
		for (const [i, context] of contexts.entries()) {
			store(context + ThreadField.StackTop, (i + 1) * window);
			store(context + ThreadField.StackBlock, valueBlock(context));
			store(context + ThreadField.StackCapacity, valueSlots);
			store(context + ThreadField.FrameCapacity, 4);
			store(context + ThreadField.FrameDepth, i + 1);
			store(context + ThreadField.FrameBlock, frameBlock(context));
		}
		frame(frameBlock(contexts[0]), 1, 0, 0, 5);
		ownedValue(contexts[0], 4, markerA);
		frame(frameBlock(contexts[1]), 2, 0, 0, 0);
		frame(frameBlock(contexts[1]) + FRAME_CONTROL_BYTES, 3, 1, window, 5);
		ownedValue(contexts[1], window + 4, markerB);
		store(privateWord, markerA);
		store(IO_IRQ_MASK, IRQ_VBLANK);
		load(0, contexts[0]);
		instructions.push([OpCode.MTC0, 0, COP0_CONTEXT, 0]);
		instructions.push([OpCode.HALT, 0, 0, 0], [OpCode.RET, 0, 1, 0]); // The bootstrap does not resume.
	});
	functionBody(() => {
		load(0, contexts[1]);
		instructions.push([OpCode.MFC0, 1, COP0_CURRENT, 0]);
		load(3, statusA);
		instructions.push([OpCode.MTC0, 3, COP0_STATUS, 0]);
		instructions.push([OpCode.MTC0, 0, COP0_CURRENT, 0]);
		instructions.push([OpCode.MFC0, 0, COP0_CURRENT, 0]); // A resumes here.
		instructions.push([OpCode.MFC0, 2, COP0_STATUS, 0]);
		instructions.push([OpCode.RET, 0, 6, 0]);
	});
	functionBody(() => {
		instructions.push([OpCode.HALT, 0, 0, 0], [OpCode.RET, 0, 1, 0]); // B's already-suspended caller.
	});
	functionBody(() => {
		instructions.push([OpCode.K0, 4, 0, 0]); // B's saved PC must skip this clobber.
		if (user) {
			load(3, CPU_STATUS_USER_MODE_CURRENT);
			instructions.push([OpCode.MTC0, 3, COP0_STATUS, 0]);
			instructions.push([OpCode.MFC0, 4, COP0_CURRENT, 0]);
			load(0, contexts[0]);
			instructions.push([OpCode.MTC0, 0, COP0_CURRENT, 0]);
			load(5, privateWord);
			instructions.push([OpCode.LOAD_MEM, 4, 5, MemoryAccessKind.Word], [OpCode.STORE_MEM, 4, 5, MemoryAccessKind.Word]);
		} else {
			instructions.push([OpCode.MFC0, 1, COP0_CURRENT, 0]);
			instructions.push([OpCode.MFC0, 2, COP0_STATUS, 0]);
			load(5, privateWord);
			instructions.push([OpCode.LOAD_MEM, 6, 5, MemoryAccessKind.Word], [OpCode.STORE_MEM, 4, 5, MemoryAccessKind.Word]);
			load(3, statusB);
			instructions.push([OpCode.MTC0, 3, COP0_STATUS, 0]);
			load(0, contexts[0]);
			instructions.push([OpCode.MTC0, 0, COP0_CURRENT, 0]);
		}
		instructions.push([OpCode.HALT, 0, 0, 0], [OpCode.RET, 0, 1, 0]);
	});
	functionBody(() => {
		instructions.push([OpCode.MFC0, 0, COP0_CURRENT, 0]);
		instructions.push([OpCode.MFC0, 1, COP0_EPC, 0]);
		instructions.push([OpCode.MFC0, 2, COP0_CAUSE, 0]);
		if (user) {
			load(3, word);
			instructions.push([OpCode.ADD, 1, 1, 3], [OpCode.MTC0, 1, COP0_EPC, 0]);
		} else {
			load(3, IO_IRQ_ACK);
			load(4, IRQ_VBLANK);
			instructions.push([OpCode.STORE_MEM, 4, 3, MemoryAccessKind.Word]);
		}
		instructions.push([OpCode.RFE, 0, 0, 0]);
	});
	const text = new Uint8Array(instructions.length * word);
	for (const [index, op] of instructions.entries()) writeInstruction(text, index, ...op);
	const image = linkRawTestSystemBlua32({ constants: constants.map(integerConstant), text, functions, irqFunctionIndex: 4, exceptionFunctionIndex: 4, verifiedControlFlow: true });
	assert.equal(image.image.header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
	assert.equal(image.image.header.globalNameCount, 0);
	assert.equal(image.image.header.systemGlobalNameCount, 0);
	const rom = image.romBytes, linked = image.image.functions;
	for (const { lane, fn, at } of refs) {
		const value = at === undefined ? linked[fn].address : linked[fn].codeAddress + at * word;
		writeLE32(rom, image.image.header.constantTableAddress - SYSTEM_ROM_BASE + BLUA32_CONSTANT_RECORD_SIZE * lane + BLUA32_CONSTANT_PAYLOAD_OFFSET, value);
	}
	const vector = linked[4];
	writeLE32(rom, vector.address - SYSTEM_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, vector.flags | BLUA32_FUNCTION_CODE);
	return { rom, linked };
}

for (const user of [false, true]) test(user ? 'a user context cannot read or replace the current CPU bank' :
	'bare ROM switches physical CPU banks at saved PCs and returns from interrupts', t => {
	const { rom, linked } = assemble(user);
	const [a, b] = contexts, aStart = linked[1].codeAddress, bStart = linked[3].codeAddress + word;
	const makeRuntime = () => {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		return runtime;
	};
	const runtime = makeRuntime();
	const dir = mkdtempSync(join('tmp', 'raw-current-bank-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'sys.rom'), trace = join(dir, 'trace');
	const fromTs = join(dir, 'ts.state'), fromNative = join(dir, 'native.state');
	writeFileSync(path, rom);
	const rows: string[] = [], commands: string[] = [];
	function record(command: string, row?: string | number) {
		commands.push(command);
		if (row !== undefined) rows.push(String(row));
	}
	function replay(checkpoint = fromTs) {
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [path, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	}
	function grant(rt: Runtime) {
		const { cpu, memory, scheduler } = rt.machine;
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		record('P', `${depth} ${pc}`);
		const decoded = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		const run = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const paid = 1 - cpu.instructionBudgetRemaining;
		assert.equal(paid, BASE_CYCLES[decoded.op] + (decoded.op === OpCode.RET ? 5 : 0),
			`cycle charge at 0x${pc.toString(16)} for opcode ${decoded.op}`);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		record('E 1', `${run} ${paid} 0 ${memory.ramBusEnd()} -1`);
		return run;
	}
	function checkRam(rt: Runtime, address: number, size: number) {
		const offset = address - RAM_BASE;
		record(`H ${offset} ${offset + size}`, hashBytes(rt.machine.memory.ramData(), offset, size));
	}
	function upToBank(rt: Runtime, address: number) {
		for (let i = 0; i < 512 && rt.machine.cpu.activeThread.address !== address; ++i)
			assert.equal(grant(rt), RunResult.Yielded);
		assert.equal(rt.machine.cpu.activeThread.address, address);
	}
	const { cpu, memory } = runtime.machine;
	const management = cpu.heapAllocator.managementOffset();
	const heapFirst = management + HEAP_STRING_METADATA_OFFSET, heapEnd = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
	const assertEmptyHeap = (rt: Runtime) => {
		const empty = rt.machine.memory.ramData().subarray(heapFirst, heapEnd);
		assert.deepEqual(empty, new Uint8Array(heapEnd - heapFirst));
		checkRam(rt, RAM_BASE + heapFirst, heapEnd - heapFirst);
	};
	assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
	assertEmptyHeap(runtime);
	upToBank(runtime, a);
	assert.equal(cpu.rootThread.address, a);
	assert.equal(cpu.readFramePc(0), aStart);
	upToBank(runtime, b);
	assert.equal(cpu.rootThread.address, a);
	assert.equal(cpu.getFrameDepth(), 2);
	assert.equal(cpu.readFramePc(1), bStart);
	assert.equal(cpu.readFrameRegister(1, 4), valueInteger(markerB));
	assert.equal(cpu.captureRuntimeState().statusWord, statusA);
	assert.equal(memory.readRamRecordWord(frameBlock(a) + FrameField.Pc), aStart + 5 * word);
	checkRam(runtime, a, THREAD_HEAP_BYTES);
	checkRam(runtime, b, THREAD_HEAP_BYTES);
	checkRam(runtime, frameBlock(a), FRAME_CONTROL_BYTES);
	checkRam(runtime, frameBlock(b), 2 * FRAME_CONTROL_BYTES);
	writeFileSync(fromTs, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	record(`x ${fromNative}`);
	const commandCut = commands.length, rowCut = rows.length;

	function finish(rt: Runtime) {
		const { cpu, memory, irqController } = rt.machine;
		assert.equal(cpu.activeThread.address, b);
		assert.equal(cpu.readFramePc(1), bStart);
		assert.equal(cpu.captureRuntimeState().statusWord, statusA);
		function exception(cause: number, epc: number, destination: number) {
			assert.equal(cpu.fixedInterruptActive(), true);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), b);
			assert.equal(cpu.readCauseWord(), cause);
			assert.equal(cpu.readEpcWord(), epc);
			record('Z', `${cause} 0 ${epc}`);
			for (let i = 0; i < 3; ++i) grant(rt);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(CPU_RESET_BANK_ADDRESS), 'CURRENT sees the actual detached bank');
			assert.equal(cpu.readFrameRegister(0, 1), valueInteger(epc));
			assert.equal(cpu.readFrameRegister(0, 2), valueInteger(cause));
			upToBank(rt, b);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.readFramePc(1), destination);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		}
		if (user) {
			grant(rt); grant(rt);
			assert.equal(cpu.isUserMode(), true);
			const readPc = cpu.readFramePc(1);
			grant(rt); // denied MFC0; destination must keep its original word and tag.
			exception(CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, readPc, readPc + word);
			assert.equal(cpu.isUserMode(), true);
			assert.equal(cpu.readFrameRegister(1, 4), valueInteger(markerB));
			grant(rt); // load the requested A address
			const writePc = cpu.readFramePc(1);
			grant(rt); // denied MTC0; RFE must still resume B in user mode.
			exception(CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, writePc, writePc + word);
			assert.equal(cpu.isUserMode(), true);
			assert.equal(cpu.activeThread.address, b);
			assert.equal(cpu.readFrameRegister(1, 0), valueInteger(a));
			assert.equal(cpu.getFrameDepth(), 2);
			grant(rt);
			const loadPc = cpu.readFramePc(1);
			grant(rt);
			exception(CPU_CAUSE_CODE_DATA_BUS_ERROR, loadPc, loadPc + word);
			assert.equal(cpu.readFrameRegister(1, 4), valueInteger(markerB), 'a refused load cannot expose private RAM');
			const storePc = cpu.readFramePc(1);
			grant(rt);
			exception(CPU_CAUSE_CODE_DATA_BUS_ERROR, storePc, storePc + word);
			assert.equal(memory.readRamRecordWord(privateWord), markerA, 'a refused store cannot mutate private RAM');
		} else {
			cpu.requestNonMaskableInterrupt(); record('N');
			assert.equal(cpu.enterPendingInterrupt(), true); record('I', 1);
			exception(CPU_CAUSE_NMI, bStart, bStart);
			assert.equal(cpu.captureRuntimeState().statusWord, statusA);
			irqController.raise(IRQ_VBLANK); record(`i ${IRQ_VBLANK}`);
			assert.equal(cpu.enterPendingInterrupt(), true); record('I', 1);
			exception(CPU_CAUSE_IRQ, bStart, bStart);
			assert.equal(cpu.captureRuntimeState().statusWord, statusA);
			assert.equal(irqController.enabledPendingFlags(), 0);
			grant(rt); grant(rt);
			assert.equal(cpu.readFrameRegister(1, 1), valueInteger(b));
			assert.equal(cpu.readFrameRegister(1, 2), valueInteger(statusA));
			assert.equal(cpu.readFrameRegister(1, 4), valueInteger(markerB));
			grant(rt); grant(rt);
			assert.equal(cpu.readFrameRegister(1, 6), valueInteger(markerA), 'ordinary System ROM code can load private RAM');
			upToBank(rt, a);
			assert.equal(memory.readRamRecordWord(privateWord), markerB, 'ordinary System ROM code can store private RAM');
			assert.equal(cpu.readFramePc(0), aStart + 5 * word);
			assert.equal(cpu.captureRuntimeState().statusWord, statusB, 'CURRENT does not select a private CP0 status');
			grant(rt); grant(rt);
			assert.equal(grant(rt), RunResult.Halted);
			const expected = [a, a, statusB, statusA, markerA].map(valueInteger);
			assert.deepEqual(rt.readCompletionValues(), expected);
			record('c', [expected.length, ...expected.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		}
		checkRam(rt, frameBlock(a), FRAME_CONTROL_BYTES);
		checkRam(rt, frameBlock(b), 2 * FRAME_CONTROL_BYTES);
		checkRam(rt, valueBlock(b), 5 * valueSlots);
		checkRam(rt, privateWord, word);
		assertEmptyHeap(rt);
	}
	finish(runtime);
	replay();
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	commands.splice(0, commands.length, 'X', ...tail);
	rows.splice(0, rows.length, ...expected);
	replay(fromTs);

	const restored = makeRuntime();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(fromNative), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
