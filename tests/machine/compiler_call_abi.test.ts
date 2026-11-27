import { valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import { ReturnSource } from '../../machine/ts/spec/blua32/instruction_format';
import type { Instruction } from '../../toolchain/ts/lua/compiler/optimizer';
import { computeMaxRegister } from '../../toolchain/ts/lua/compiler/optimizer/instructions';
import { collectInstructionDefs, collectInstructionUses } from '../../toolchain/ts/lua/compiler/optimizer/liveness';
import { compileLuaSource, runCompiledLua } from '../helpers/cpu_test_harness';
import { disassembleTestBlua32Functions, linkTestSystemBlua32 } from '../helpers/blua32';

test('CALL liveness kills its complete scratch suffix independently of result arity', () => {
	for (const resultOperand of [0, 1, 2, 4]) {
		const call: Instruction = { op: OpCode.CALL, a: 3, b: encodeFixedValueCount(2), c: resultOperand,
			format: 'ABC', rkMask: 0, target: null };
		assert.deepEqual(collectInstructionUses(call, 8, () => []), [3, 4, 5]);
		assert.deepEqual(collectInstructionDefs(call, 8), [3, 4, 5, 6, 7, 8]);
	}
});

test('zero, fixed and open result operands have distinct compiler register effects', () => {
	for (const [operand, registers] of [[1, []], [2, [3]], [4, [3, 4, 5]], [0, [3, 4, 5, 6]]] as const) {
		const instruction: Instruction = { op: OpCode.RET, a: 3, b: operand, c: 0,
			format: 'ABC', rkMask: 0, target: null };
		assert.deepEqual(collectInstructionUses(instruction, 6, () => []), registers);
		instruction.op = OpCode.VARARG;
		assert.deepEqual(collectInstructionDefs(instruction, 6), registers);
	}
	assert.equal(computeMaxRegister([{ op: OpCode.CALL, a: 3, b: 3, c: 5,
		format: 'ABC', rkMask: 0, target: null }]), 6);
});

test('argument suffix RET reads a scalar index, not a local register window', () => {
	for (const operand of [0, 1, 5]) {
		const instruction: Instruction = { op: OpCode.RET, a: 3, b: operand, c: ReturnSource.ExtraArguments,
			format: 'ABC', rkMask: 0, target: null };
		assert.deepEqual(collectInstructionUses(instruction, 9, () => []), [3]);
		assert.equal(computeMaxRegister([instruction]), 3);
	}
});

for (const optLevel of [0, 3] as const) test(`argument intrinsics observe the physical call and return its original suffix (O${optLevel})`, () => {
	const source = `
local function fixed_count(a)
	return blua32.argument_count()
end
local function count(a, ...)
	return blua32.argument_count()
end
local function suffix(start, ...)
	return blua32.argument_suffix(start)
end
return fixed_count(9, 7), count(), count(nil, nil, 5), suffix(1, 10, 20, nil, 30)
`;
	const compiled = compileLuaSource(source, 'argument-intrinsics.lua', optLevel);
	const image = linkTestSystemBlua32(compiled);
	const listing = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
	assert.match(listing, /ARGC r\d+/);
	assert.match(listing, /RET r\d+, \*, extra arguments/);
	assert.doesNotMatch(listing, /VARARG r\d+/);
	assert.deepEqual(runCompiledLua(source, 'argument-intrinsics.lua', optLevel),
		[2, 0, 3, 20, null, 30].map(value => value === null ? valueNil() : valueInteger(value)));
});

test('argument tuple is terminal and cannot become a hidden temporary', () => {
	assert.throws(() => compileLuaSource('return 1, blua32.argument_suffix(0)'), /sole expression of a return/);
	assert.throws(() => compileLuaSource('return (blua32.argument_suffix(0))'), /sole expression of a return/);
	assert.throws(() => compileLuaSource('return blua32.argument_suffix()'), /argument_suffix expects 1 argument/);
	assert.throws(() => compileLuaSource('return blua32.argument_suffix(0, 1)'), /argument_suffix expects 1 argument/);
	assert.throws(() => compileLuaSource('return blua32.argument_count(0)'), /argument_count expects 0 arguments/);
});

test('SVC reads its operand without defining a result register', () => {
	const svc: Instruction = { op: OpCode.SVC, a: 27, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null };
	assert.equal(computeMaxRegister([svc]), 27);
	assert.deepEqual(collectInstructionUses(svc, 32, () => []), [27]);
	assert.deepEqual(collectInstructionDefs(svc, 32), []);
});

for (const optLevel of [0, 3] as const) test(`SVC preserves its operand and successor (O${optLevel})`, () => {
	const image = linkTestSystemBlua32(compileLuaSource('blua32.svc(37); return 40', 'svc.lua', optLevel));
	const listing = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
	assert.match(listing, /KSMI r(\d+), 37[\s\S]*SVC r\1[\s\S]*KSMI r(\d+), 40[\s\S]*RET r\2, 1/);
	assert.throws(() => compileLuaSource('return blua32.svc(37)'), /svc is a statement-only/);
	assert.throws(() => compileLuaSource('blua32.svc()'), /svc expects (?:one|1) argument/);
	assert.throws(() => compileLuaSource('blua32.svc(1, 2)'), /svc expects (?:one|1) argument/);
});

test('an authored exception branch can emit RFE without returning a Lua value', () => {
	const image = linkTestSystemBlua32(compileLuaSource('blua32.rfe(); return 37', 'rfe.lua', 3));
	const listing = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
	assert.match(listing, /\bRFE\b/);
	assert.doesNotMatch(listing, /KSMI r\d+, 37/);
	assert.throws(() => compileLuaSource('return blua32.rfe()'), /rfe is a statement-only/);
	assert.throws(() => compileLuaSource('blua32.rfe(1)'), /rfe expects 0 arguments/);
});

test('fixed call arguments are produced in adjacent slots, not copied through a second argument range', () => {
	const compiled = compileLuaSource('local f = function(a, b) return a + b end\nreturn f(7, 11)');
	const image = linkTestSystemBlua32(compiled);
	const disassembly = disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
	// These literal arguments have no intermediate expression state: each must
	// be materialized directly in the callee's shared parameter slots.
	assert.match(disassembly, /KSMI r2, 7[\s\S]*KSMI r3, 11[\s\S]*CALL r1, 2, \*/);
	assert.doesNotMatch(disassembly, /MOV r[23],/);
	assert.deepEqual(runCompiledLua('local f = function(a, b) return a + b end\nreturn f(7, 11)'), [valueInteger(18)]);
});

for (const optLevel of [3] as const) test(`empty return, fallthrough and discarded calls use the zero-value contract (O${optLevel})`, () => {
	const source = `
local function empty() return end
local function implicit() end
local function nilvalue() return nil end
local function pack(...) return ... end
empty()
implicit()
local uninitialized
return uninitialized, pack(empty()), pack(implicit()), pack(nilvalue())
`;
	assert.deepEqual(runCompiledLua(source, 'zero-value-results.lua', optLevel), [valueNil(), valueNil(), valueNil(), valueNil()]);
});
