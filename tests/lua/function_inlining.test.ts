import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import type { CompiledSystemProgram } from '../../toolchain/ts/lua/compiler';
import {
	optimizeInstructions,
	type Instruction,
	type OptimizationContext,
} from '../../toolchain/ts/lua/compiler/optimizer';
import {
	disassembleTestBlua32Functions,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import { compileLuaSource, runCompiledLua } from './cpu_test_harness';

const INLINE_TEST_PATH = 'function_inlining.lua';

function disassembleEntry(compiled: CompiledSystemProgram): string {
	const image = linkTestSystemBlua32(compiled);
	return disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
}

test('O3 inlines nested const calls in a loop and publishes the grown caller frame', () => {
	const source = `
local mix<const> = function(left, right)
	local shifted<const> = right << 3
	local combined<const> = left ~ shifted
	local biased<const> = combined + 17
	local rotated<const> = (biased << 5) ~ (biased >> 2)
	return rotated & 0x7fffffff
end

local run_round<const> = function(value)
	local first<const> = mix(value, 3)
	local second<const> = mix(first, 5)
	local third<const> = mix(second, 7)
	return third
end

local value = 11
local round = 0
while round < 4 do
	value = run_round(value)
	round = round + 1
end
return value
`;
	const baseline = runCompiledLua(source, INLINE_TEST_PATH, 0);
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const optimizedValues = runCompiledLua(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);
	const registers = Array.from(disassembly.matchAll(/\br(\d+)/g), match => Number(match[1]));
	const maxRegister = Math.max(...registers);
	const entryProto = optimized.program.protos[optimized.entryProtoIndex];
	const statementPoints = optimized.metadata.statementPointsByProto[optimized.entryProtoIndex];
	const resumePoints = optimized.metadata.resumePointsByProto[optimized.entryProtoIndex];

	assert.deepEqual(optimizedValues, baseline);
	assert.doesNotMatch(disassembly, /\bCALL\b/);
	assert.ok(entryProto.maxStack > 3, 'inlining must be able to grow beyond the original CALL slots');
	assert.ok(maxRegister < entryProto.maxStack, 'the function record must cover every emitted register');
	assert.ok(
		statementPoints.some(point => point.inlineCallSites.length >= 2),
		'nested inline source chain must survive optimization',
	);
	assert.ok(
		resumePoints.some(point => point.inlineCallSites.length >= 2),
		'inlined source must retain a tooling relocation point',
	);
});

test('inlining does not overwrite a caller register live above the CALL results', () => {
	const calleeInstructions: Instruction[] = [
		{ op: OpCode.K1, a: 0, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.K1, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 0, b: 1, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const callerInstructions: Instruction[] = [
		{ op: OpCode.GETGL, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.CALL, a: 0, b: 1, c: 1, format: 'ABC', rkMask: 0, target: null, callProtoIndex: 0 },
		{ op: OpCode.ADD, a: 0, b: 0, c: 3, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 0, b: 1, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const context: OptimizationContext = {
		currentFunctionId: 'caller',
		constPool: [],
		constIndex: () => 0,
		getClosureUpvalues: () => [],
		getProtoMeta: () => ({ numParams: 0, isVararg: false, maxStack: 4, upvalueDescs: [] }),
		getProtoInstructionSet: () => ({
			instructions: calleeInstructions,
			ranges: calleeInstructions.map(() => null),
		}),
		getProtoFunctionId: () => 'callee',
		getProtoLocalSlots: () => [],
		relocatedConstIndices: new Set<number>(),
		closureWrittenRegisters: new Set<number>(),
	};
	const optimized = optimizeInstructions(
		callerInstructions,
		callerInstructions.map(() => null),
		3,
		context,
	);

	assert.ok(optimized.instructions.some(instruction => instruction.op === OpCode.CALL));
});

test('inlining does not overwrite a register retained by an open closure', () => {
	const calleeInstructions: Instruction[] = [
		{ op: OpCode.K1, a: 0, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.K1, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 0, b: 1, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const callerInstructions: Instruction[] = [
		{ op: OpCode.K1, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.CLOSURE, a: 4, b: 1, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.CALL, a: 0, b: 1, c: 1, format: 'ABC', rkMask: 0, target: null, callProtoIndex: 0 },
		{ op: OpCode.RET, a: 4, b: 1, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const context: OptimizationContext = {
		currentFunctionId: 'caller',
		constPool: [],
		constIndex: () => 0,
		getClosureUpvalues: protoIndex => protoIndex === 1 ? [{ inStack: true, index: 3 }] : [],
		getProtoMeta: () => ({ numParams: 0, isVararg: false, maxStack: 4, upvalueDescs: [] }),
		getProtoInstructionSet: protoIndex => protoIndex === 0 ? {
			instructions: calleeInstructions,
			ranges: calleeInstructions.map(() => null),
		} : null,
		getProtoFunctionId: protoIndex => protoIndex === 0 ? 'callee' : 'capturing_closure',
		getProtoLocalSlots: () => [],
		relocatedConstIndices: new Set<number>(),
		closureWrittenRegisters: new Set<number>(),
	};
	const optimized = optimizeInstructions(
		callerInstructions,
		callerInstructions.map(() => null),
		3,
		context,
	);

	assert.ok(optimized.instructions.some(instruction => instruction.op === OpCode.CALL));
});

test('inlined calls evaluate extra arguments once and fill missing parameters with nil', () => {
	const source = `
local sequence = 0
local next_value<const> = function()
	sequence = sequence + 1
	return sequence
end
local pair<const> = function(first, second)
	local copy_first<const> = first
	local copy_second<const> = second
	return copy_first, copy_second
end
local first, second = pair(next_value(), next_value(), next_value())
local only, missing = pair(7)
return first, second, sequence, only, missing
`;
	for (const optLevel of [0, 3] as const) {
		assert.deepEqual(
			runCompiledLua(source, INLINE_TEST_PATH, optLevel),
			[1, 2, 3, 7, null],
		);
	}
});

test('inlined const calls preserve reads and writes through lexical upvalues', () => {
	const source = `
local total = 4
local accumulate<const> = function(value)
	total = total + value
	return total
end
local result<const> = accumulate(3)
return result, total
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), [7, 7]);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [7, 7]);
	assert.doesNotMatch(disassembleEntry(optimized), /\bCALL\b/);
});

test('a captured outer const call retains its closure environment', () => {
	const source = `
local captured = 4
local outer<const> = function(value)
	return captured + value
end
local caller<const> = function()
	return outer(3)
end
return caller()
`;
	const compiled = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const callerProtoIndex = compiled.metadata.protoIds.findIndex(id => id.endsWith('/local:caller'));
	const image = linkTestSystemBlua32(compiled);
	const callerDisassembly = disassembleTestBlua32Functions(
		image,
		[image.image.functions[callerProtoIndex].address],
	);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [7]);
	assert.match(callerDisassembly, /\bCALL\b/);
});

test('a nested closure write invalidates a mutable local call target', () => {
	const source = `
local current = function()
	return 1
end
local replace<const> = function()
	current = function()
		return 2
	end
end
replace()
return current()
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [2]);
	assert.match(disassembly, /\bCALL\b/, 'the post-mutation dynamic call must remain a CALL');
});

test('a closure-writable local never becomes a static inline target', () => {
	const source = `
local current = function()
	return 1
end
local replace = function()
	current = function()
		return 2
	end
end
return current(), replace
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3).slice(0, 1), [1]);
	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('a specialized constant write invalidates a propagated closure target', () => {
	const source = `
local original<const> = function()
	return 1
end
local target = original
target = nil
return target()
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('direct const-call inlining preserves an escaping closure value', () => {
	const source = `
local increment<const> = function(value)
	return value + 1
end
local escaped<const> = increment
local direct<const> = increment(4)
return escaped == increment, escaped(5), direct
`;
	for (const optLevel of [0, 3] as const) {
		assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, optLevel), [true, 6, 5]);
	}
});

test('variadic const functions retain the physical Lua call contract', () => {
	const source = `
local first<const> = function(...)
	return ...
end
return first(9, 10)
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [9, 10]);
	assert.match(disassembly, /\bCALL\b/);
});

test('a function that halts retains its physical call frame', () => {
	const source = `
local wait<const> = function()
	halt_until_irq
end
wait()
return 1
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});
