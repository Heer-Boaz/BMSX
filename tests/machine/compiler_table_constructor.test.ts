import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES, MAX_EXT_REGISTER_A, MAX_EXT_REGISTER_BC, MIN_SIGNED_BX, ValueMoveKind, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { compileLuaChunkToProgram, type CompiledProgram } from '../../toolchain/ts/lua/compiler';
import type { Instruction } from '../../toolchain/ts/lua/compiler/optimizer';
import { allocateFrameSlots } from '../../toolchain/ts/lua/compiler/optimizer/frame_slots';
import { computeMaxRegister, isPureInstruction } from '../../toolchain/ts/lua/compiler/optimizer/instructions';
import { collectInstructionDefs, collectInstructionUses } from '../../toolchain/ts/lua/compiler/optimizer/liveness';
import { encodeWideIntegerLoad } from '../../toolchain/ts/lua/compiler/wide_integer';
import { decodeBlua32InstructionAtPc, type DecodedInstruction } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, parseLuaChunk } from '../helpers/cpu_test_harness';

function body(compiled: CompiledProgram, functionName?: string): DecodedInstruction[] {
	const index = functionName === undefined ? compiled.entryProtoIndex
		: compiled.metadata.protoIds.findIndex(id => id.endsWith(`:${functionName}`));
	assert.ok(index >= 0, functionName);
	const { code, protos } = compiled.program;
	const { entryPC, codeLen, maxStack } = protos[index];
	const result: DecodedInstruction[] = [];
	for (let pc = entryPC; pc < entryPC + codeLen;) {
		const decoded = decodeBlua32InstructionAtPc(code, 0, pc);
		if (decoded.op === OpCode.CALL && decoded.b !== 0) assert.ok(decoded.a + decoded.b <= maxStack);
		result.push(decoded);
		pc = decoded.pc + INSTRUCTION_BYTES;
	}
	return result;
}

function integer(instruction: DecodedInstruction): number {
	switch (instruction.op) {
		case OpCode.K0: return 0;
		case OpCode.K1: return 1;
		case OpCode.KSMI: return instruction.sbx;
		default: assert.fail('the capacity arguments are produced as Integer immediates');
	}
}

function tableCall(instructions: readonly DecodedInstruction[]): number {
	return instructions.findIndex((instruction, index) => instruction.op === OpCode.SVC && instruction.b === 3
		&& instructions[index - 1].op === OpCode.K0 && instructions[index - 1].a === instruction.a);
}

function tableCapacities(instructions: readonly DecodedInstruction[], site: number): number[] {
	const call = instructions[site];
	assert.equal(call.op, OpCode.SVC);
	assert.equal(call.b, 3);
	assert.equal(call.c, 0);
	const binding = instructions[site - 1];
	assert.equal(binding.op, OpCode.K0);
	assert.equal(binding.a, call.a);
	const args = instructions.slice(site - 3, site - 1);
	assert.deepEqual(args.map(arg => arg.a), [call.a + 1, call.a + 2]);
	return args.map(integer);
}

const source = `
local function empty()
	return {}
end
local function hinted(v)
	local t = {}
	t[1] = v
	t.field = v
	return t
end
local function prepared(v)
	return {left = v.x, right = v.y}
end
local function effects(make)
	return {left = make(11), right = make(22)}
end
local function virtual(x, y)
	local t = {left = x, right = y}
	return t.left + t.right
end
return empty, hinted, prepared, effects, virtual
`;

for (const opt of [0, 2, 3] as const) {
	test(`the constructor uses the original SVC window and preserves table sizing at O${opt}`, () => {
		const compiled = compileLuaSource(source, 'bioscall-shapes.lua', opt);
		const empty = body(compiled, 'empty');
		assert.deepEqual(empty.slice(0, 5).map(instruction => instruction.op), [OpCode.K0, OpCode.K0, OpCode.K0, OpCode.SVC, OpCode.RET]);
		assert.deepEqual(tableCapacities(empty, 3), [0, 0]);
		assert.equal(empty[3].a, empty[4].a, 'a free suffix needs no result move');
		const hinted = body(compiled, 'hinted');
		assert.deepEqual(tableCapacities(hinted, tableCall(hinted)),
			opt === 3 ? [1, 1] : [0, 0]);
		const virtual = body(compiled, 'virtual');
		assert.equal((tableCall(virtual) >= 0), opt !== 3);
		if (opt === 3) {
			assert.deepEqual(virtual.map(instruction => instruction.op), [OpCode.ADD, OpCode.RET]);
			assert.deepEqual([virtual[0].b, virtual[0].c], [0, 1]);
		}
	});

	test(`constructor preparation never reorders RHS effects or clobbers live operands at O${opt}`, () => {
		const compiled = compileLuaSource(source, 'bioscall-order.lua', opt);
		const record = body(compiled, 'prepared');
		const site = tableCall(record);
		assert.deepEqual(tableCapacities(record, site), [0, 2]);
		const reads = record.filter(instruction => instruction.op === OpCode.GETFIELD);
		const stores = record.filter(instruction => instruction.op === OpCode.SETFIELD);
		assert.equal(reads.length, 2);
		assert.equal(stores.length, 2);
		assert.deepEqual(reads.map(instruction => instruction.a), stores.map(instruction => instruction.c));
		assert.equal(reads.every(instruction => instruction.pc < record[site].pc), opt === 3);
		assert.ok(stores.every(instruction => instruction.a === record[site].a));
		if (opt === 3) {
			const { a } = record[site];
			assert.ok(reads.every(instruction => instruction.a < a), 'both prepared RHS roots remain live');
		}
		const effects = body(compiled, 'effects');
		const allocation = tableCall(effects);
		const calls = effects.filter((instruction, index) => index !== allocation && instruction.op === OpCode.CALL);
		const writes = effects.filter(instruction => instruction.op === OpCode.SETFIELD);
		assert.equal(calls.length, 2);
		assert.equal(writes.length, 2);
		assert.ok(effects[allocation].pc < calls[0].pc && calls[0].pc < writes[0].pc
			&& writes[0].pc < calls[1].pc && calls[1].pc < writes[1].pc);
	});
}

test('only a constructor recognized by the compiler is removable; its SVC keeps the explicit liveness window', () => {
	const instruction: Instruction = { op: OpCode.SVC, format: 'ABC', a: 9, b: 3, c: 0, rkMask: 0, target: null, tableConstructor: true };
	assert.deepEqual(collectInstructionUses(instruction, 15, () => []), [9, 10, 11]);
	assert.deepEqual(collectInstructionDefs(instruction, 15), [9, 10, 11]);
	assert.equal(computeMaxRegister([instruction]), 11);
	assert.equal(isPureInstruction(instruction), true);
	assert.equal(isPureInstruction({ ...instruction, tableConstructor: undefined }), false);

	const load = (a: number): Instruction => ({ ...instruction, op: OpCode.K1, a, b: 0, c: 0 });
	const unrelated = { ...instruction, op: OpCode.MOV, a: 15, b: 9, c: ValueMoveKind.Copy };
	const allocated = allocateFrameSlots([load(9), load(10), load(11), instruction, unrelated], 16, 0, () => []);
	assert.ok(allocated);
	assert.deepEqual([...allocated.slots.slice(9, 12)], [9, 10, 11], 'compaction does not split the window');
	assert.equal(allocated.instructions[3].a, 9);
	assert.ok(allocated.maxStack < 16, 'unrelated registers can still move');
});

test('step through the software vector keeps an effect even when its result is discarded', () => {
	const entrySource = `
local function collect()
	local ignored = blua32.svc_value(65553)
	local finished = blua32.svc_value(65553)
	return finished
end
return collect`;
	for (const optLevel of [0, 3] as const) {
		const lowered = body(compileLuaChunkToProgram(parseLuaChunk(entrySource), [],
			{ entrySource, programDomain: 'system', optLevel }), 'collect');
		assert.equal(tableCall(lowered), -1);
		assert.deepEqual(lowered.filter(instruction => instruction.op === OpCode.SVC).map(op => op.b), [1, 1]);
		assert.equal(lowered.some(instruction => instruction.op === OpCode.CALL), false);
	}
});

test('a zero SVC result can differ from its nonzero operation operand', () => {
	const entrySource = `
local function bind(address)
	if blua32.svc_value(65542, address) ~= 0 then
		return 17
	end
	return 29
end
return bind`;
	for (const optLevel of [0, 3] as const) {
		const lowered = body(compileLuaChunkToProgram(parseLuaChunk(entrySource), [],
			{ entrySource, programDomain: 'system', optLevel }), 'bind');
		const issue = lowered.findIndex(instruction => instruction.op === OpCode.SVC);
		assert.ok(issue >= 0);
		assert.equal(lowered[issue].b, 2);
		assert.ok(lowered.slice(issue + 1).some(instruction => instruction.op === OpCode.EQ));
	}
});

test('slot compaction keeps the complete saved SVC argument window', () => {
	const svc: Instruction = { op: OpCode.SVC, format: 'ABC', a: 9, b: 7, c: 0, rkMask: 0, target: null };
	const setup = Array.from({ length: svc.b }, (_, index) =>
		({ ...svc, op: OpCode.K1, a: svc.a + index, b: 0 }));
	const use = { ...svc, op: OpCode.MOV, a: 17, b: svc.a, c: ValueMoveKind.Copy };
	const allocated = allocateFrameSlots([...setup, svc, use], 18, 0, () => []);
	assert.ok(allocated);
	assert.deepEqual([...allocated.slots.slice(9, 16)], [9, 10, 11, 12, 13, 14, 15]);
	assert.equal(allocated.instructions[7].a, 9);
	assert.ok(allocated.maxStack < 18);
});

test('static fixed modules may not construct a managed Table', () => {
	const moduleSource = 'module<const>\nlocal make<const> = function() return {} end\nreturn {make = make}';
	const entry = 'halt_until_irq';
	assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(entry), [
		{ path: 'static', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'static.lua') },
	], { entrySource: entry, preloadModules: ['static'], programDomain: 'system' }),
	/Static function export.*cannot construct a Table/);
});

test('literal capacities travel as tagged Integer values rather than instruction fields', () => {
	const explicit = compileLuaSource(`return {${'0,'.repeat(513)}}`);
	const code = body(explicit);
	assert.deepEqual(tableCapacities(code, tableCall(code)), [513, 0]);
	assert.throws(() => compileLuaSource(`return {${'0,'.repeat(MAX_EXT_REGISTER_BC + 1)}}`),
		/constructor capacity exceeds 32767 slots/);
});

test('inlining rebases the complete constructor window without changing its width', () => {
	const compiled = compileLuaSource(`
local function make(v) return {v} end
local kept = 17
local t = make(kept)
return kept, t
`, 'inline-bioscall.lua', 3);
	const instructions = body(compiled);
	const site = tableCall(instructions);
	assert.ok(site >= 0, 'the allocating callee was inlined into the entry body');
	assert.equal(instructions.filter(instruction => instruction.op === OpCode.CALL).length, 0);
	assert.deepEqual(tableCapacities(instructions, site), [1, 0]);
});

test('a constructor above 4100 locals keeps the token and hints in its existing high register window', () => {
	const locals = Array.from({ length: 4100 }, (_, index) => `v${index}`).join(',');
	for (const opt of [0, 2, 3] as const) {
		const compiled = compileLuaSource(`local ${locals}\nreturn {0,1,0,1,0; x=1,y=0,z=1}`, 'high-table.lua', opt);
		const proto = compiled.program.protos[compiled.entryProtoIndex];
		const instructions = body(compiled);
		const site = tableCall(instructions);
		assert.ok(site >= 0);
		const call = instructions[site], token = instructions[site - 1];
		assert.deepEqual([call.a, call.b, call.c], [4100, 3, 0]);
		assert.equal(proto.maxStack, call.a + 3, 'Integer materialization uses no extra slot');
		assert.equal(token.op, OpCode.K0);
		assert.equal(token.a, call.a);
	}
});

test('the high Integer encoding uses the top ABC register and remains one skip target', () => {
	const register = MAX_EXT_REGISTER_A;
	const value = MIN_SIGNED_BX;
	const encoding = encodeWideIntegerLoad(register, value, true);
	for (const skip of [false, true]) {
		const text = new Uint8Array(encoding.byteLength + 3 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.K0, 0, 0, 0);
		writeInstruction(text, 1, OpCode.EQ, skip ? 0 : 1, 0, 0);
		text.set(encoding, 2 * INSTRUCTION_BYTES);
		writeInstruction(text, text.byteLength / INSTRUCTION_BYTES - 1, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{
			firstWord: 0, wordCount: text.byteLength / INSTRUCTION_BYTES, maxStack: register + 1,
		}] });
		const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		assert.equal(cpu.runUntilDepth(0, 1024), RunResult.Halted);
		assert.equal(cpu.readFrameRegister(0, register), skip ? valueNil() : valueInteger(value));
	}
});
