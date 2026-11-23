import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { valueBool, valueInteger, valueIsString } from '../../machine/ts/machine/cpu/value';
import {
	INP_CTRL_ARM,
	IO_INP_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_PORT,
} from '../../machine/ts/spec/bmsx/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import type { Instruction } from '../../toolchain/ts/lua/compiler/optimizer';
import {
	collectInstructionDefs,
	computeInstructionLivenessAt,
} from '../../toolchain/ts/lua/compiler/optimizer/liveness';
import { runCompiledLua } from '../helpers/cpu_test_harness';
import {
	disassembleTestBlua32Functions,
	linkTestSystemBlua32,
} from '../helpers/blua32';

function parseChunk(source: string, path: string = 'value_flow.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, source);
	return parser.parseChunk();
}

test('ITERN keeps incoming results live on the guard-miss edge', () => {
	const instructions: Instruction[] = [
		{ op: OpCode.ITERN, a: 0, b: 4, c: 3, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 6, b: 2, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 4, b: 2, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	assert.deepEqual(collectInstructionDefs(instructions[0], 6), [2, 4, 5, 6]);
	const [live] = computeInstructionLivenessAt(instructions, 6, [0], () => [], 'in');
	assert.deepEqual(live.slice(0, 3), Uint8Array.of(1, 1, 1));
	assert.equal(live[6], 1, 'the fallback returns the old value of the third result');
});

test('ProgramCompiler pairs specialization retains its generic call for a shadowed iterator', () => {
	const path = 'shadowed_pairs.lua';
	const source = `
local calls = 0
local function pairs(subject)
	return function(state, key)
		calls = calls + 1
		if key == nil then return false, state, 19 end
	end, subject, nil
end
local sum = 0
for key, value, extra in pairs(7) do
	if key == false then sum = sum + value + extra end
end
return sum, calls
`;
	for (const optLevel of [0, 1, 2, 3] as const) {
		const compiled = compileLuaChunkToProgram(
			parseChunk(source, path), [], { entrySource: source, optLevel, programDomain: 'system' },
		);
		const image = linkTestSystemBlua32(compiled);
		const disassembly = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
		assert.match(disassembly, /\bITERN r\d+, r\d+, 3\n[^\n]*\bJMP /);
		assert.deepEqual(Array.from(runCompiledLua(source, path, optLevel)), [valueInteger(26), valueInteger(2)]);
	}
});

test('ProgramCompiler still emits & expression as a single string-id result expression', () => {
	const returned = runCompiledLua("return &'left'", 'string_id_return.lua');
	assert.equal(returned.length, 1);
	assert.equal(valueIsString(returned[0]), true);

	const passed = runCompiledLua([
		'local function echo(value)',
		'\treturn value',
		'end',
		"return echo(&'right')",
	].join('\n'), 'string_id_argument.lua');
	assert.equal(passed.length, 1);
	assert.equal(valueIsString(passed[0]), true);
});

test('ProgramCompiler -O3 folds a conditional increment after reusing the register for a string', () => {
	// Regression: propagateValues rewrote `MOV dst, src` (src = const) into an
	// immediate const load but failed to refresh dst's tracked constant, so a
	// register reused (here r holding the call argument string 'a', then the
	// counter) kept a stale string constant. The conditional `s = s + 1` then
	// folded `'a' + 1` to NaN. This mirrors Pietious' input-update register reuse.
	const source = [
		"local function q(pi, pat) if pat == 'up' then return true end return false end",
		'local t = {}',
		'function t.sync(self)',
		"\tself.left_held = q(self, 'left')",
		"\tlocal up_primary <const> = q(self, 'up')",
		"\tlocal up_alt <const> = q(self, 'a')",
		'\tlocal s = 0',
		'\tif up_primary then s = s + 1 end',
		'\tif up_alt then s = s + 1 end',
		'\tself.up_input_sources = s',
		'\tself.up_held = s > 0',
		'\treturn self.up_input_sources, self.up_held',
		'end',
		'return t.sync({})',
	].join('\n');
	for (const opt of [3] as const) {
		const returned = runCompiledLua(source, 'reused_register_counter.lua', opt);
		assert.deepEqual(Array.from(returned), [valueInteger(1), valueBool(true)], `optLevel ${opt} miscompiled the counter`);
	}
});

test('ProgramCompiler treats raw ICU MMIO writes as plain word writes', () => {
	const source = [
		`mem[0x${IO_INP_CTRL.toString(16).padStart(8, '0')}] = 0x${INP_CTRL_ARM.toString(16).padStart(8, '0')}`,
		`mem[0x${IO_INP_OUTPUT_PORT.toString(16).padStart(8, '0')}] = 2`,
		`mem[0x${IO_INP_OUTPUT_DURATION_MS.toString(16).padStart(8, '0')}] = 120`,
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(source, 'raw_icu_words.lua'),
		[],
		{ entrySource: source },
	);
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler -O3 keeps large local constants resident for register-only loop operands', () => {
	const source = `
local write_words<const> = function(base, count)
	local target: *word = base
	local value<const> = 0x64808080
	local index = 1
	while index <= count do
		*target = value
		target = target + sizeof(word)
		index = index + 1
	end
end
return write_words
`;
	const compiled = compileLuaChunkToProgram(
		parseChunk(source, 'resident_loop_constant.lua'),
		[],
		{ entrySource: source, optLevel: 3, programDomain: 'system' },
	);
	const image = linkTestSystemBlua32(compiled);
	const functionIndex = image.symbols.metadata.functionIds.indexOf(
		'module:resident_loop_constant.lua/entry/local:write_words',
	);
	assert.notEqual(functionIndex, -1);
	const disassembly = disassembleTestBlua32Functions(
		image,
		[image.symbols.functionAddresses[functionIndex]],
	);
	const constantLoads = Array.from(disassembly.matchAll(/\bLOADK r(\d+),/g));

	assert.equal(constantLoads.length, 1);
	assert.ok(constantLoads[0].index < disassembly.indexOf('LE '));
	assert.match(disassembly, new RegExp(`\\bSTORE_MEM_D r${constantLoads[0][1]},`));
});
