import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, MAX_EXT_REGISTER_A, MAX_EXT_REGISTER_BC, MIN_SIGNED_BX, ValueMoveKind, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BiosCall } from '../../machine/ts/spec/bmsx/bios';
import { compileLuaChunkToProgram, type CompiledProgram } from '../../toolchain/ts/lua/compiler';
import type { Instruction } from '../../toolchain/ts/lua/compiler/optimizer';
import { allocateFrameSlots } from '../../toolchain/ts/lua/compiler/optimizer/frame_slots';
import { computeMaxRegister, isPureInstruction } from '../../toolchain/ts/lua/compiler/optimizer/instructions';
import { collectInstructionDefs, collectInstructionUses } from '../../toolchain/ts/lua/compiler/optimizer/liveness';
import { encodeWideIntegerLoad } from '../../toolchain/ts/lua/compiler/wide_integer';
import { decodeBlua32InstructionAtPc, type DecodedInstruction } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { describeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import { createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { runCpuWithinBudget } from '../helpers/cpu_execution';

function body(compiled: CompiledProgram, functionName?: string): DecodedInstruction[] {
	const index = functionName === undefined ? compiled.entryProtoIndex
		: compiled.metadata.protoIds.findIndex(id => id.endsWith(`:${functionName}`));
	assert.ok(index >= 0, functionName);
	const { code, protos } = compiled.program;
	const { entryPC, codeLen, maxStack } = protos[index];
	const result: DecodedInstruction[] = [];
	for (let pc = entryPC; pc < entryPC + codeLen;) {
		const decoded = decodeBlua32InstructionAtPc(code, 0, pc);
		if (decoded.op === OpCode.BIOSCALL) assert.ok(decoded.a + decoded.c < maxStack);
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

function tableCapacities(instructions: readonly DecodedInstruction[], site: number): number[] {
	const call = instructions[site];
	assert.equal(call.op, OpCode.BIOSCALL);
	assert.equal(call.b, BiosCall.CreateTable);
	assert.equal(call.c, 2);
	const args = instructions.slice(site - 2, site);
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
	test(`BIOSCALL uses a fixed selector/window and preserves table sizing at O${opt}`, () => {
		const compiled = compileLuaSource(source, 'bioscall-shapes.lua', opt);
		const empty = body(compiled, 'empty');
		assert.deepEqual(empty.slice(0, 4).map(instruction => instruction.op), [OpCode.K0, OpCode.K0, OpCode.BIOSCALL, OpCode.RET]);
		assert.deepEqual(tableCapacities(empty, 2), [0, 0]);
		assert.equal(empty[2].a, empty[3].a, 'a free suffix needs no result move');
		const hinted = body(compiled, 'hinted');
		assert.deepEqual(tableCapacities(hinted, hinted.findIndex(instruction => instruction.op === OpCode.BIOSCALL)),
			opt === 3 ? [1, 1] : [0, 0]);
		const virtual = body(compiled, 'virtual');
		assert.equal(virtual.some(instruction => instruction.op === OpCode.BIOSCALL), opt !== 3);
		if (opt === 3) {
			assert.deepEqual(virtual.map(instruction => instruction.op), [OpCode.ADD, OpCode.RET]);
			assert.deepEqual([virtual[0].b, virtual[0].c], [0, 1]);
		}
	});

	test(`constructor preparation never reorders RHS effects or clobbers live operands at O${opt}`, () => {
		const compiled = compileLuaSource(source, 'bioscall-order.lua', opt);
		const record = body(compiled, 'prepared');
		const site = record.findIndex(instruction => instruction.op === OpCode.BIOSCALL);
		assert.deepEqual(tableCapacities(record, site), [0, 2]);
		const reads = record.filter(instruction => instruction.op === OpCode.GETFIELD);
		const stores = record.filter(instruction => instruction.op === OpCode.SETFIELD);
		assert.equal(reads.length, 2);
		assert.equal(stores.length, 2);
		assert.deepEqual(reads.map(instruction => instruction.a), stores.map(instruction => instruction.c));
		assert.equal(reads.every(instruction => instruction.pc < record[site].pc), opt === 3);
		assert.ok(stores.every(instruction => instruction.a === record[site].a));
		if (opt === 3) {
			const { a, c } = record[site];
			assert.ok(reads.every(instruction => instruction.a < a || instruction.a > a + c));
		}
		const effects = body(compiled, 'effects');
		const allocation = effects.findIndex(instruction => instruction.op === OpCode.BIOSCALL);
		const calls = effects.filter(instruction => instruction.op === OpCode.CALL);
		const writes = effects.filter(instruction => instruction.op === OpCode.SETFIELD);
		assert.equal(calls.length, 2);
		assert.equal(writes.length, 2);
		assert.ok(effects[allocation].pc < calls[0].pc && calls[0].pc < writes[0].pc
			&& writes[0].pc < calls[1].pc && calls[1].pc < writes[1].pc);
	});
}

test('only the table selector is removable; BIOSCALL uses just the implicit input lane and defines its result', () => {
	const instruction: Instruction = { op: OpCode.BIOSCALL, format: 'ABC', a: 9, b: BiosCall.CreateTable, c: 2, rkMask: 0, target: null };
	assert.equal(OpCode.BIOSCALL, 0x10);
	assert.equal(BASE_CYCLES[OpCode.BIOSCALL], BASE_CYCLES[OpCode.CALL]);
	assert.deepEqual(collectInstructionUses(instruction, 15, () => []), [10, 11]);
	assert.deepEqual(collectInstructionDefs(instruction, 15), [9]);
	assert.equal(computeMaxRegister([instruction]), 11);
	assert.equal(isPureInstruction(instruction), true);
	assert.equal(isPureInstruction({ ...instruction, b: BiosCall.Count }), false);
	assert.equal(isPureInstruction({ ...instruction, c: 1 }), false);
	const zeroArgs = { ...instruction, c: 0 };
	assert.deepEqual(collectInstructionUses(zeroArgs, 15, () => []), []);
	assert.equal(computeMaxRegister([zeroArgs]), 9);

	const load = (a: number): Instruction => ({ ...instruction, op: OpCode.K1, a, b: 0, c: 0 });
	const unrelated = { ...instruction, op: OpCode.MOV, a: 15, b: 9, c: ValueMoveKind.Copy };
	const allocated = allocateFrameSlots([load(10), load(11), instruction, unrelated], 16, 0, () => []);
	assert.ok(allocated);
	assert.deepEqual([...allocated.slots.slice(9, 12)], [9, 10, 11], 'compaction does not split the window');
	assert.equal(allocated.instructions[2].a, 9);
	assert.ok(allocated.maxStack < 16, 'unrelated registers can still move');
});

test('disassembly names the ABI fields, without treating selector or count as registers', () => {
	const image = linkTestSystemBlua32(compileLuaSource('return {}'));
	const pc = image.image.functions.find(fn => fn.address === image.vectors.entryFunctionAddress)!.codeAddress + 2 * INSTRUCTION_BYTES;
	const described = describeBlua32InstructionAtPc(image.image, image.symbols, pc);
	assert.match(described.instructionText, /^BIOSCALL r\d+, 0, 2$/);
	assert.deepEqual(described.operands.map(operand => [operand.label, operand.registerIndex]),
		[['result', 0], ['selector', undefined], ['nargs', undefined]]);
});

test('static fixed modules may not issue a potentially suspending BIOSCALL', () => {
	const moduleSource = 'module<const>\nlocal make<const> = function() return {} end\nreturn {make = make}';
	const entry = 'halt_until_irq';
	assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(entry), [
		{ path: 'static', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'static.lua') },
	], { entrySource: entry, preloadModules: ['static'], programDomain: 'system' }),
	/forbidden static opcode BIOSCALL \(BIOS service call\)/);
});

test('literal capacities are Integer values rather than truncated ABC selector fields', () => {
	const explicit = compileLuaSource(`return {${'0,'.repeat(513)}}`);
	const code = body(explicit);
	assert.deepEqual(tableCapacities(code, code.findIndex(instruction => instruction.op === OpCode.BIOSCALL)), [513, 0]);
	assert.throws(() => compileLuaSource(`return {${'0,'.repeat(MAX_EXT_REGISTER_BC + 1)}}`),
		/constructor capacity exceeds 32767 slots/);
});

test('inlining rebases the entire BIOSCALL window and leaves its selector and arity unchanged', () => {
	const compiled = compileLuaSource(`
local function make(v) return {v} end
local kept = 17
local t = make(kept)
return kept, t
`, 'inline-bioscall.lua', 3);
	const instructions = body(compiled);
	const site = instructions.findIndex(instruction => instruction.op === OpCode.BIOSCALL);
	assert.ok(site >= 0, 'the allocating callee was inlined into the entry body');
	assert.equal(instructions.some(instruction => instruction.op === OpCode.CALL), false);
	assert.deepEqual(tableCapacities(instructions, site), [1, 0]);
});

test('a constructor above 4100 locals materializes both tagged capacities in their high argument slots', () => {
	const locals = Array.from({ length: 4100 }, (_, index) => `v${index}`).join(',');
	for (const opt of [0, 2, 3] as const) {
		for (const [fields, array, hash] of [['0,1', 2, 0], ['0,1,0,1,0; x=1,y=0,z=1', 5, 3]] as const) {
			const compiled = compileHeapServiceSystem(`local ${locals}\nreturn {${fields}}`, opt, [], 'high-bioscall.lua');
			const proto = compiled.program.protos[compiled.entryProtoIndex];
			const instructions = body(compiled);
			const site = instructions.findIndex(instruction => instruction.op === OpCode.BIOSCALL);
			assert.ok(site >= 0);
			const call = instructions[site];
			assert.equal(call.a, 4100);
			assert.equal(call.b, BiosCall.CreateTable);
			assert.equal(call.c, 2);
			assert.equal(proto.maxStack, call.a + 3, 'Integer materialization uses no extra slot');
			const image = linkTestSystemBlua32(compiled);
			const fn = image.image.functions.find(candidate => candidate.address === image.vectors.entryFunctionAddress)!;
			const pc = fn.codeAddress + (call.pc - proto.entryPC) - INSTRUCTION_BYTES; // WIDE head
			const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
			cpu.setExecutionHook((_domain, at) => at === pc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
			assert.equal(runCpuWithinBudget(cpu, 40_000), RunResult.ExecutionStopped);
			const frame = cpu.getFrameDepth() - 1;
			assert.equal(cpu.readFramePc(frame), pc);
			assert.equal(cpu.readFrameRegister(frame, call.a + 1), valueInteger(array));
			assert.equal(cpu.readFrameRegister(frame, call.a + 2), valueInteger(hash));
		}
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
