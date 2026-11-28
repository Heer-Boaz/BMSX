import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { GC_ROOT_BANKS_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_STACK_BASE, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// One hand-authored function, no Lua objects, globals, constants, library
// imports, data initializer, or firmware service descriptor. Exercise a
// physical IO write (IRQ mask), then return the Integer from the reset frame.
const romCode = new Uint8Array(6 * INSTRUCTION_BYTES);
writeInstruction(romCode, 0, OpCode.K1, 0, 0, 0);
writeInstruction(romCode, 1, OpCode.KSMI, 1, 32, 0); // 0x800
writeInstruction(romCode, 2, OpCode.KSMI, 2, 0, 16);
writeInstruction(romCode, 3, OpCode.SHL, 1, 1, 2); // 0x08000000
writeInstruction(romCode, 4, OpCode.STORE_MEM_D, 0, 1, MemoryAccessKind.Word, 2); // + 8
writeInstruction(romCode, 5, OpCode.RET, 0, 2, 0);
const firmware = linkRawTestSystemBlua32({ text: romCode, functions: [{ firstWord: 0, wordCount: 6, maxStack: 3 }] });
assert.equal(firmware.image.header.constantCount, 0);
assert.equal(firmware.image.header.globalNameCount, 0);
assert.equal(firmware.image.header.systemGlobalNameCount, 0);
const runtime = new Runtime({
	systemRomBytes: firmware.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
}, {
	sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
});
const { cpu, memory, scheduler } = runtime.machine;
const management = CPU_FIXED_STACK_BASE - RAM_BASE;
const heapFirst = management + HEAP_STRING_METADATA_OFFSET, heapEnd = management + GC_ROOT_BANKS_OFFSET;
const zeroHeap = new Uint8Array(heapEnd - heapFirst);
const heapHash = hashBytes(zeroHeap, 0, zeroHeap.length);
assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap, 'power-on has no managed metadata');
runtime.boot();
const entryPc = firmware.image.functions[0].codeAddress;
assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
assert.equal(cpu.getFrameDepth(), 1);
assert.equal(cpu.readFramePc(0), entryPc);
assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
assert.equal(cpu.rootThread.currentFrame!.closureAddress, 0);
assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap, 'reset does not initialize the arena');
assert.equal(scheduler.nowCycles, 0);
assert.equal(memory.readMappedWord(IO_IRQ_MASK), 0);

const trace = ['P', `M ${IO_IRQ_MASK}`, `H ${heapFirst} ${heapEnd}`], expected = [`1 ${entryPc}`, '0 0', String(heapHash)];
function grant(cycles: number, result: RunResult, paid: number) {
	assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), result);
	assert.equal(cycles - cpu.instructionBudgetRemaining, paid);
	assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
	trace.push(`E ${cycles}`, `H ${heapFirst} ${heapEnd}`);
	expected.push(`${result} ${paid} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`, String(heapHash));
}
grant(1, RunResult.Yielded, 2);
assert.equal(cpu.readFramePc(0), entryPc + INSTRUCTION_BYTES);
assert.equal(cpu.readFrameRegister(0, 0), valueInteger(1));
assert.equal(memory.readMappedWord(IO_IRQ_MASK), 0);
trace.push('P', `M ${IO_IRQ_MASK}`);
expected.push(`1 ${entryPc + INSTRUCTION_BYTES}`, '0 0');
grant(64, RunResult.Halted, 26); // 2 + 2 + 2 + 3 + 16 and one returned slot
assert.deepEqual(runtime.readCompletionValues(), [valueInteger(1)]);
assert.equal(memory.readMappedWord(IO_IRQ_MASK), 1);
trace.push(`M ${IO_IRQ_MASK}`, 'C');
expected.push('1 0', '1');

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-minimal-firmware-'));
try {
	const rom = join(directory, 'system.rom'), input = join(directory, 'trace.txt'), unused = join(directory, 'unused.state');
	writeFileSync(rom, firmware.romBytes);
	writeFileSync(input, trace.join('\n'));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const actual = execFileSync(native, [rom, input, unused], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.deepEqual(actual, expected);
	console.log('MINIMAL-SYSTEM-ROM:PASS exact first instruction, physical IRQ mask write, and return without a BIOS roster, global names, or arena');
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
