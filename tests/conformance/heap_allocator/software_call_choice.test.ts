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
import { CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, RegisterJumpMode, ValueMoveKind, signExtend } from '../../../machine/ts/spec/blua32/instruction_format';
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
local left<const> = function(x, ...)
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

test('a runtime branch selects one of two linked PCs for a frame-free call', t => {
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
		assert.ok(body.some(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.Jump));
		assert.ok(body.every(row => row.op !== OpCode.CALL && row.op !== OpCode.RET));
		return layout.functions[index];
	});
	assert.notEqual(callees[0].maxStack, callees[1].maxStack);
	const caller = ids.indexOf('module:main/entry'), entry = decodeBody(linked, caller);
	const shared = entry.findIndex((row, index) => row.op === OpCode.JREG && row.c === RegisterJumpMode.Link && row.a === row.b
		&& entry[index - 1].op === OpCode.MOV && entry[index - 1].c === ValueMoveKind.AddBase
		&& callees.every(callee => entry.slice(0, index).some(load => load.op === OpCode.LOADK && load.a === entry[index - 1].b
			&& isDeepStrictEqual(layout.constants[load.bx], integerConstant(callee.codeAddress)))));
	assert.notEqual(shared, -1, 'two raw destination loads feed one indirect instruction');
	const offset = entry[shared - 1].b, frontier = entry[shared + 1], restore = entry[shared + 2];
	assert.equal(frontier.op, OpCode.MOV);
	assert.equal(frontier.c, ValueMoveKind.SetTopImmediate);
	assert.equal(frontier.a, 2);
	assert.equal(restore.op, OpCode.MOV);
	assert.equal(restore.c, ValueMoveKind.AddBase);
	assert.equal(signExtend(restore.b, restore.rkBitsB), -offset);
	assert.ok(layout.functions[caller].maxStack >= offset + Math.max(...callees.map(callee => callee.maxStack)));
	assert.ok(entry.every(row => row.op !== OpCode.CALL));

	const systemRomBytes = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
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

test('discard-only callers use one raw link for unequal return arities without dropping expression work', () => {
	const modulePath = 'calls/discard';
	const discarded = `module<const>
bss effects: word
local record<const> = function(x)
	*effects = *effects * 10 + x
	return 35 // x
end
local mixed<const> = function(x, wide)
	if wide then return record(x), 13, 17 end
	return record(x)
end
local pair<const> = function(x, wide)
	return record(x + 1), 19
end
local suffix<const> = function(x, ...)
	*effects = *effects * 10 + x
	return blua32.argument_suffix(0)
end
local trace<const> = function() return *effects end
return { mixed = mixed, pair = pair, suffix = suffix, trace = trace, record = record }
`;
	const main = `
local targets<const> = require('${modulePath}')
for i = 0, 1 do
	local wide = i == 1;
	(wide and targets.mixed or targets.pair)(3, wide)
end
targets.mixed(5, false)
targets.suffix(6, 1)
targets.suffix(7, 1, 2, 3)
return targets.trace()
`;
	const modules = [{ path: modulePath, source: discarded }];
	const linked = linkManagedTestSystem(main, 3, modules);
	const ids = linked.symbols.metadata.functionIds;
	for (const name of ['mixed', 'pair', 'suffix']) {
		const index = ids.findIndex(id => id.endsWith('__' + name)), body = decodeBody(linked, index);
		const link = linked.symbols.metadata.softwareFramesByFunction[index]!.linkSlots[0]?.slot ?? 0;
		assert.ok(body.some(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.Jump && row.a === link), name);
		assert.ok(body.every(row => row.op !== OpCode.CALL && row.op !== OpCode.RET && row.op !== OpCode.VARARG), name);
		assert.ok(body.every(row => row.op !== OpCode.MOV || row.c !== ValueMoveKind.Copy || (row.a !== link && row.b !== link)), name);
	}
	const entry = decodeBody(linked, ids.indexOf('module:main/entry'));
	assert.equal(entry.filter(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.Link).length, 1);
	assert.ok(entry.every(row => row.op !== OpCode.CALL));
	for (const [system, backend] of [
		[linkManagedTestSystem(main, 0, modules), CpuExecutionBackend.Interpreter],
		[linked, CpuExecutionBackend.Interpreter],
		[linked, CpuExecutionBackend.JavaScript],
	] as const) {
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(system) }, backend);
		runGuestToHalt(cpu, 4_194_304);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(43567)]);
	}

	// Result demand does not remove evaluation: the ordered store commits
	// before the discarded expression's divide-by-zero traps.
	const fails = linkManagedTestSystem(`
local targets<const> = require('${modulePath}')
targets.suffix(5, 3)
targets.mixed(0, false)
return targets.trace()
`, 3, modules);
	const { cpu, memory } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(fails) });
	for (let grant = 0; grant < 8192 && cpu.readCauseWord() !== CPU_CAUSE_CODE_TRAP; ++grant) {
		if (cpu.runUntilDepth(0, 43) === RunResult.Halted) break;
	}
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	assert.equal(decodeBlua32InstructionAtPc(fails.layout.textBytes, fails.layout.header.textAddress, cpu.readEpcWord()).op, OpCode.FLOORDIV);
	const effects = fails.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'effects')!.address!;
	assert.equal(memory.readMappedU32LE(effects), 50);
});

test('a result-observing caller keeps the shared ABI of a discard-only choice arm', () => {
	const linked = linkManagedTestSystem(`
local targets<const> = require('${path}')
local first, second = targets.left(7)
for i = 0, 1 do
	local left = targets.condition(i == 1);
	(left and targets.left or targets.right)(7)
end
return first, second, targets.trace()
`, 3, modules);
	const ids = linked.symbols.metadata.functionIds;
	const entry = decodeBody(linked, ids.indexOf('module:main/entry'));
	const right = decodeBody(linked, ids.findIndex(id => id.endsWith('__right')));
	assert.ok(entry.some(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.Link));
	assert.ok(right.some(row => row.op === OpCode.JREG && row.c === RegisterJumpMode.Jump && row.a !== 0));
	const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) });
	runGuestToHalt(cpu, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [6, 8, 31413].map(valueInteger));
});
