import { valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import type { Instruction } from '../../toolchain/ts/lua/compiler/optimizer';
import { computeMaxRegister } from '../../toolchain/ts/lua/compiler/optimizer/instructions';
import { collectInstructionDefs, collectInstructionUses } from '../../toolchain/ts/lua/compiler/optimizer/liveness';
import { compileLuaSource, runCompiledLua } from './cpu_test_harness';
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

for (const optLevel of [0, 3] as const) test(`empty return, fallthrough and discarded calls use the zero-value contract (O${optLevel})`, () => {
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
	const compiled = compileLuaSource(source, 'zero-value-results.lua', optLevel);
	const image = linkTestSystemBlua32(compiled);
	const disassembly = disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
	if (optLevel === 0) assert.match(disassembly, /CALL r\d+, 0, 0/);
});
