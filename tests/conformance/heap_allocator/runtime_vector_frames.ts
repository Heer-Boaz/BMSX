import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_TRAP, CPU_CAUSE_IRQ, CPU_CAUSE_NMI, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const createRuntime = (romBytes: Uint8Array) => {
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	return runtime;
};

const code = new Uint8Array(10 * INSTRUCTION_BYTES);
writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
writeInstruction(code, 1, OpCode.RET, 0, 2, 0);
writeInstruction(code, 2, OpCode.KSMI, 0, 0, IRQ_VBLANK);
writeInstruction(code, 3, OpCode.KSMI, 1, 32, 0); // 0x800
writeInstruction(code, 4, OpCode.KSMI, 2, 0, 16);
writeInstruction(code, 5, OpCode.SHL, 1, 1, 2); // 0x08000000
assert.equal(IO_IRQ_ACK - 0x08000000, 4);
writeInstruction(code, 6, OpCode.STORE_MEM_D, 0, 1, MemoryAccessKind.Word, 1);
writeInstruction(code, 7, OpCode.RFE, 0, 0, 0);
writeInstruction(code, 8, OpCode.K1, 0, 0, 0);
writeInstruction(code, 9, OpCode.RFE, 0, 0, 0);
const functions = [
	{ firstWord: 0, wordCount: 2, numParams: 2, maxStack: 3 },
	{ firstWord: 2, wordCount: 6, numParams: 1, maxStack: 3 },
	{ firstWord: 8, wordCount: 2, maxStack: 1 },
];
const firmware = linkRawTestSystemBlua32({ text: code, functions, verifiedControlFlow: true, irqFunctionIndex: 1, exceptionFunctionIndex: 2 });
const pcs = firmware.image.functions.map(fn => fn.codeAddress);
const runtime = createRuntime(firmware.romBytes), { cpu, memory, scheduler, irqController } = runtime.machine;
const trace: string[] = [], expected: string[] = [];
const observe = (cmd: string, output?: string | number) => {
	trace.push(cmd);
	if (output !== undefined) expected.push(String(output));
};
function frame(index: number, pc: number, exception: boolean, nmi = false) {
	const current = cpu.rootThread.frameAtDepth(index);
	assert.equal(cpu.getFrameDepth(), index + 1);
	assert.equal(current.pc, pc);
	assert.equal(current.closureAddress, 0);
	assert.equal(cpu.getFrameUpvalueCount(index), 0);
	assert.equal(current.isExceptionFrame, exception);
	assert.equal(current.isNonMaskableExceptionFrame, nmi);
	assert.equal(cpu.heapServiceActive(), false);
	observe('P', `${index + 1} ${pc}`);
	const offset = current.controlOffset;
	observe(`H ${offset} ${offset + FRAME_CONTROL_BYTES}`, hashBytes(memory.ramData(), offset, FRAME_CONTROL_BYTES));
	return current;
}
function grant(cycles: number, paid: number) {
	const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
	assert.equal(cycles - cpu.instructionBudgetRemaining, paid);
	assert.equal(cpu.heapServiceActive(), false);
	observe(`J ${cycles} 1`, `${result} ${paid} 0 0 ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
	return result;
}
function status(cause: number, epc: number, word: number) {
	assert.equal(cpu.readCauseWord(), cause);
	assert.equal(cpu.readEpcWord(), epc);
	assert.equal(cpu.captureRuntimeState().statusWord, word);
	observe('Z', `${cause} 0 ${epc}`);
}

const first = frame(0, pcs[0], false);
assert.equal(first.top, 2);
assert.equal(first.registers.get(0), valueNil());
assert.equal(first.registers.get(1), valueNil());
assert.equal(scheduler.nowCycles, 0);
const heapControl = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
const heapControlEnd = cpu.heapAllocator.allocatorStateOffset();
const heapControlHash = hashBytes(memory.ramData(), heapControl, heapControlEnd - heapControl);
observe(`H ${heapControl} ${heapControlEnd}`, heapControlHash);
memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
irqController.raise(IRQ_VBLANK);
observe(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`);
observe(`i ${IRQ_VBLANK}`);
assert.equal(cpu.enterPendingInterrupt(), true);
observe('I', 1);
const interrupted = frame(1, pcs[1], true);
assert.equal(interrupted.callSitePc, pcs[0]);
assert.equal(interrupted.registers.get(0), valueNil());
status(CPU_CAUSE_IRQ, pcs[0], 4);
// The first vector fits the reserved window. It leaves the object inventory,
// collector and usage untouched; the nested vector may still grow storage.
assert.equal(hashBytes(memory.ramData(), heapControl, heapControlEnd - heapControl), heapControlHash);
observe(`H ${heapControl} ${heapControlEnd}`, heapControlHash);
cpu.requestNonMaskableInterrupt();
observe('N');
assert.equal(cpu.enterPendingInterrupt(), true);
observe('I', 1);
assert.equal(frame(2, pcs[2], true, true).callSitePc, pcs[1]);
status(CPU_CAUSE_NMI, pcs[1], 16);
const checkpoint = captureRuntimeSaveState(runtime);

function finish() {
	grant(BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.RFE], BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.RFE]);
	frame(1, pcs[1], true);
	status(CPU_CAUSE_IRQ, pcs[0], 0x14);
	const irq = 3 * BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.SHL]
		+ BASE_CYCLES[OpCode.STORE_MEM_D] + BASE_CYCLES[OpCode.RFE];
	grant(irq, irq);
	frame(0, pcs[0], false);
	status(CPU_CAUSE_IRQ, pcs[0], 0x15);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS), 0);
	observe(`M ${IO_IRQ_FLAGS}`, '0 0');
	const end = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.RET] + 1;
	assert.equal(grant(64, end), RunResult.Halted);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(1)]);
	observe('C', 1);
}

mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'vector-frames-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const rom = join(dir, 'system.rom'), commands = join(dir, 'trace.txt');
	const portable = join(dir, 'portable.state'), exported = join(dir, 'from-native.state');
	writeFileSync(portable, encodeRuntimeSaveState(checkpoint));
	observe(`x ${exported}`); // The native core has just taken its own nested NMI.
	observe('S');
	finish();
	applyRuntimeSaveState(runtime, checkpoint);
	observe('U');
	finish();
	observe('X');
	applyRuntimeSaveState(runtime, checkpoint);
	finish();
	writeFileSync(rom, firmware.romBytes);
	writeFileSync(commands, trace.join('\n'));
	assert.deepEqual(execFileSync(native, [rom, commands, portable], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	// Follow the hardware frontier in a native-produced portable save as well.
	const decoded = decodeRuntimeSaveState(readFileSync(exported), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	applyRuntimeSaveState(runtime, decoded);
	assert.equal(frame(2, pcs[2], true, true).callSitePc, pcs[1]);
	status(CPU_CAUSE_NMI, pcs[1], 16);
	finish();
	console.log('VECTOR-FRAMES:PASS ordinary reset plus pre-first-instruction IRQ, nested NMI, W1C and portable rewind (both cores)');

	// Absence is a represented capture binding, not a convenient read of RAM 0.
	// This poisonous count would admit a capture if address zero were treated
	// as the first word of a Closure by the scalar or generated datapath.
	writeInstruction(code, 0, OpCode.GETUP, 0, 0, 0);
	writeInstruction(code, 8, OpCode.HALT, 0, 0, 0);
	const missing = linkRawTestSystemBlua32({ text: code, functions, verifiedControlFlow: true, irqFunctionIndex: 1, exceptionFunctionIndex: 2 });
	const fault = createRuntime(missing.romBytes);
	const faultCpu = fault.machine.cpu, badPc = faultCpu.readFramePc(0);
	fault.machine.memory.writeRamRecordWord(0, 0x01000000);
	faultCpu.runUntilDepth(0, 128);
	assert.equal(faultCpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
	assert.equal(faultCpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	assert.equal(faultCpu.readEpcWord(), badPc);
	const profile = process.env.BMSX_TEST_PINNED_NATIVE_PROFILE === '1';
	const cmds = ['W 0 16777216', profile ? '_ 128' : 'J 128 1', 'Z'];
	writeFileSync(rom, missing.romBytes);
	writeFileSync(commands, cmds.join('\n'));
	const lines = execFileSync(native, [rom, commands, portable], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.equal(lines[1], `${CPU_CAUSE_CODE_TRAP} ${LUA_FAULT_REASON_INVALID_ARGUMENT} ${badPc}`);
	if (profile) assert.equal(lines[0], '1', 'an actual generated capture admission replays before reading a Closure');
	console.log(`VECTOR-CAPTURE:PASS absent environment, raw RAM zero ignored${profile ? ', generated native admission' : ''}`);
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
