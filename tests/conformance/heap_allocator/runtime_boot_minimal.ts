import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_IMAGE_FLAG } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
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
assert.equal(firmware.image.header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
assert.equal(firmware.image.header.constantCount, 0);
assert.equal(firmware.image.header.globalNameCount, 0);
assert.equal(firmware.image.header.systemGlobalNameCount, 0);
const runtime = new Runtime({
	systemRomBytes: firmware.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
}, {
	sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
});
runtime.boot();
const { cpu, memory, scheduler } = runtime.machine;
const entryPc = firmware.image.functions[0].codeAddress;
assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
assert.equal(cpu.getFrameDepth(), 1);
assert.equal(cpu.readFramePc(0), entryPc);
assert.equal(scheduler.nowCycles, 0);
assert.equal(memory.readMappedWord(IO_IRQ_MASK), 0);

const trace = ['P', `M ${IO_IRQ_MASK}`], expected = [`1 ${entryPc}`, '0 0'];
function grant(cycles: number, result: RunResult, paid: number) {
	assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), result);
	assert.equal(cycles - cpu.instructionBudgetRemaining, paid);
	assert.equal(cpu.heapServiceActive(), false);
	trace.push(`J ${cycles} 1`);
	// Native trace includes current heap statistics, but the no-injection
	// probe does not yet impose a heap-free hardware reset.
	expected.push(`${result} ${paid} 0 0 ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
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
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const actual = execFileSync(native, [rom, input, unused], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.deepEqual(actual, expected);
	console.log('MINIMAL-SYSTEM-ROM:PASS exact first instruction, physical IRQ mask write, and return without a BIOS roster or global names');
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
