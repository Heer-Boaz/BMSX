import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { INSTRUCTION_BYTES, RegisterJumpMode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc, type DecodedInstruction } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { createTestSystemCpu, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const path = 'calls/choice';
const source = `module<const>
bss effects: word
local condition<const> = function(flag)
	*effects = *effects * 10 + 1
	return flag
end
local argument<const> = function(x)
	*effects = *effects * 10 + 2
	return x
end
local left<const> = function(x)
	*effects = *effects * 10 + 3
	return x - 1, x + 1
end
local right<const> = function(x)
	*effects = *effects * 10 + 4
	local a, b, c, d = x + 1, x + 2, x + 3, x + 4
	return a * b + c * d, 5 * x
end
local single<const> = function(x) return x + 10 end
local trace<const> = function() return *effects end
return { condition = condition, argument = argument, left = left, right = right, single = single, trace = trace }
`;
const modules = [{ path, source }];

function decodeBody(linked: ReturnType<typeof linkManagedTestSystem>, index: number): DecodedInstruction[] {
	const { layout } = linked, fn = layout.functions[index], instructions: DecodedInstruction[] = [];
	for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
		const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
		instructions.push(instruction);
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	return instructions;
}

test('a runtime branch selects one of two linked PCs for the same software CALL window', t => {
	const main = `
local targets<const> = require('${path}')
local first, second, third, fourth
for ordinal = 0, 1 do
	local a, b = (targets.condition(ordinal == 1) and targets.left or targets.right)((targets.argument(7)))
	if ordinal == 0 then first, second = a, b else third, fourth = a, b end
end
return first, second, third, fourth, targets.trace()
`;
	const expected = [182, 35, 6, 8, 124123].map(valueInteger);
	const unoptimized = linkManagedTestSystem(main, 0, modules);
	const { cpu: reference } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(unoptimized) });
	runGuestToHalt(reference, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(reference), expected);

	const linked = linkManagedTestSystem(main, 3, modules);
	const { layout, symbols } = linked, ids = symbols.metadata.functionIds;
	const callees = ['__left', '__right'].map(suffix => {
		const index = ids.findIndex(id => id.endsWith(suffix));
		assert.notEqual(index, -1, suffix);
		const body = decodeBody(linked, index);
		assert.ok(body.some(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.LeaveWindow));
		assert.ok(body.every(row => row.op !== OpCode.CALL && row.op !== OpCode.RET));
		return layout.functions[index];
	});
	assert.notEqual(callees[0].maxStack, callees[1].maxStack, 'the shared descriptor must admit distinct child extents');
	const entry = decodeBody(linked, ids.indexOf('module:main/entry'));
	const shared = entry.findIndex((row, index) => row.op === OpCode.JREG && row.c === RegisterJumpMode.EnterWindow
		&& callees.every(callee => entry.slice(0, index).some(load => load.op === OpCode.LOADK && load.a === row.a
			&& isDeepStrictEqual(layout.constants[load.bx], integerConstant(callee.codeAddress)))));
	assert.notEqual(shared, -1, 'two raw destination loads feed one indirect instruction');
	const transfer = entry[shared], width = entry[shared - 2];
	assert.equal(width.a, transfer.b + 1);
	assert.equal(width.op, OpCode.KSMI);
	assert.equal(width.sbx, Math.max(...callees.map(callee => callee.maxStack)));
	assert.ok(entry.every(row => row.op !== OpCode.CALL));

	const systemRomBytes = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.JavaScript },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler, memory } = runtime.machine;
	const commands: string[] = [], trace: string[] = [];
	for (let grant = 0; grant < 8192; ++grant) {
		const result = scheduler.runCpuSlice(0, 47, 0, CpuRunKind.Scheduled);
		commands.push('E 47');
		trace.push(`${result} ${47 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (result === RunResult.Halted) break;
	}
	assert.deepEqual(runtime.readCompletionValues(), expected);
	commands.push('c');
	trace.push([expected.length, ...expected.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-software-call-choice-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), schedule = join(folder, 'schedule');
	writeFileSync(rom, systemRomBytes);
	writeFileSync(schedule, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, schedule, schedule], { encoding: 'utf8' }).trim().split('\n'), trace);
});

test('incompatible choices keep both ordinary function relocations', () => {
	const linked = linkManagedTestSystem(`
local targets<const> = require('${path}')
local first, second, third, fourth
for ordinal = 0, 1 do
	local a, b = (targets.condition(ordinal == 1) and targets.left or targets.single)(7)
	if ordinal == 0 then first, second = a, b else third, fourth = a, b end
end
return first, second, third, fourth
`, 3, modules);
	const { layout, symbols } = linked, ids = symbols.metadata.functionIds;
	const calleeAddresses = new Set(['__left', '__single'].map(suffix => layout.functions[ids.findIndex(id => id.endsWith(suffix))].address));
	const entry = decodeBody(linked, ids.indexOf('module:main/entry'));
	const call = entry.find(row => row.op === OpCode.CALL)!;
	const loaded = entry.filter(row => row.op === OpCode.LOADK && row.a === call.a).map(row => layout.constants[row.bx]);
	assert.deepEqual(new Set(loaded.flatMap(value => typeof value === 'object' && value !== null && value.kind === 'code_function'
		&& calleeAddresses.has(value.word) ? [value.word] : [])), calleeAddresses);
	const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) });
	runGuestToHalt(cpu, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(17), valueNil(), valueInteger(6), valueInteger(8)]);
});
