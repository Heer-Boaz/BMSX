import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode, BASE_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_ROOT_BANKS_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { CPU_RESET_BANK_ADDRESS, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const nil = valueNil(), payload = valueInteger(707);
const cases = [
	{ name: 'fixed CALL counts arguments beyond fixed formals', supplied: 5, formals: 1, suffix: false, skip: 0, returned: 2, wanted: 0, result: [valueInteger(4)], placementCycles: 0 },
	{ name: 'open CALL counts explicit nils without counting padded formals', supplied: 0, formals: 6, suffix: false, skip: 0, returned: 2, wanted: 0, result: [valueInteger(4)], placementCycles: 2 },
	{ name: 'open suffix starts after the selected extra', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 0, wanted: 0, result: [payload, nil], placementCycles: 1 },
	{ name: 'fixed suffix clips produced values', supplied: 0, formals: 1, suffix: true, skip: 1, returned: 2, wanted: 0, result: [payload], placementCycles: 1 },
	{ name: 'fixed suffix does not add padding to its produced values', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 6, wanted: 0, result: [payload, nil], placementCycles: 1 },
	{ name: 'fixed receiving CALL still pads the suffix to its requested result count', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 2, wanted: 4, result: [payload, nil, nil], placementCycles: 1 },
	{ name: 'unsigned suffix offset beyond its window produces nothing', supplied: 5, formals: 1, suffix: true, skip: -1, returned: 0, wanted: 0, result: [], placementCycles: 1 },
] as const;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

for (const scenario of cases) test(scenario.name + ' in a bare System ROM', t => {
	const { supplied, formals, suffix, skip, returned, wanted, result, placementCycles } = scenario;
	const text = new Uint8Array((suffix ? 11 : 10) * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.KSMI, 1, 1, 35); // 99
	writeInstruction(text, 3, OpCode.KNIL, 2, 0, 0);
	writeInstruction(text, 4, OpCode.KSMI, 3, 11, 3); // 707
	writeInstruction(text, 5, OpCode.KNIL, 4, 0, 0);
	writeInstruction(text, 6, OpCode.CALL, 0, supplied, wanted);
	writeInstruction(text, 7, OpCode.RET, 0, 0, 0);
	writeInstruction(text, 8, OpCode.ARGC, 1, 0, 0);
	if (suffix) writeInstruction(text, 9, OpCode.KSMI, 0, skip >>> 6 & 63, skip & 63, skip >>> 12 & 255);
	writeInstruction(text, suffix ? 10 : 9, OpCode.RET, suffix ? 0 : 1, returned, +suffix);
	const image = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, closureRelocations: [{ wordIndex: 1, functionIndex: 1 }],
		functions: [{ firstWord: 0, wordCount: 8, maxStack: 6 }, {
			firstWord: 8, wordCount: suffix ? 3 : 2, maxStack: 6, numParams: formals, isVararg: suffix,
		}],
	});
	assert.equal(image.image.header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
	const caller = image.image.functions[0], callee = image.image.functions[1], rom = image.romBytes;
	// Author the wire-level System CodeFunction. No Closure allocation/link
	// metadata or managed bootstrap is available to this ROM.
	writeLE32(rom, callee.address - SYSTEM_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, callee.flags | BLUA32_FUNCTION_CODE);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler } = runtime.machine;
	const management = cpu.heapAllocator.managementOffset(), first = management + HEAP_STRING_METADATA_OFFSET, end = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
	const empty = new Uint8Array(end - first);
	runtime.boot();
	const commands: string[] = [], expected: string[] = [];
	function step(op: OpCode, pc: number, depth: number, extra = 0) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), pc);
		commands.push('P');
		expected.push(`${depth} ${pc}`);
		const run = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const cycles = BASE_CYCLES[op] + extra;
		assert.equal(run, depth === 1 && op === OpCode.RET ? RunResult.Halted : RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, cycles, `op=${op} pc=${pc.toString(16)} run=${run} cause=${cpu.readCauseWord()} next=${cpu.activeThread.currentFrame?.pc}`);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		commands.push('E 1');
		expected.push(`${run} ${cycles} 0 ${memory.ramBusEnd()} -1`);
	}
	const word = INSTRUCTION_BYTES;
	for (const [index, op] of [OpCode.CLOSURE, OpCode.KSMI, OpCode.KNIL, OpCode.KSMI, OpCode.KNIL, OpCode.CALL].entries())
		step(op, caller.codeAddress + (index === 0 ? 0 : index + 1) * word, 1, op === OpCode.CALL ? placementCycles : 0);
	const frame = cpu.activeThread.currentFrame!;
	assert.equal(frame.argumentCount, 4);
	assert.equal(frame.varargCount, suffix ? 3 : 0);
	step(OpCode.ARGC, callee.codeAddress, 2);
	assert.equal(frame.registers.get(1), valueInteger(4));
	if (suffix) step(OpCode.KSMI, callee.codeAddress + word, 2);
	step(OpCode.RET, callee.codeAddress + (suffix ? 2 : 1) * word, 2, result.length);
	step(OpCode.RET, caller.codeAddress + 7 * word, 1, result.length);
	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.deepEqual(runtime.readCompletionValues(), result);
	assert.deepEqual(memory.ramData().subarray(first, end), empty);
	commands.push('c', `H ${first} ${end}`);
	expected.push([result.length, ...result.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '), String(hashBytes(empty, 0, empty.length)));
	const temp = mkdtempSync(join(tmpdir(), 'raw-call-abi-'));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const nativeRom = join(temp, 'system.rom'), trace = join(temp, 'trace');
	writeFileSync(nativeRom, rom);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [nativeRom, trace, join(temp, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
});
