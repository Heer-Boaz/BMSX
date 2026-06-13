import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { valueIsString } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';
import { MMIO_REGISTER_SPECS } from '../../machine/ts/machine/bus/registers';
import { runCompiledLua } from '../lua/cpu_test_harness';

function parseChunk(source: string, path: string = 'value_flow.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string, path: string = 'value_flow.lua') {
	return compileLuaChunkToProgram(parseChunk(source, path), [], { entrySource: source });
}

test('ProgramCompiler has no special MMIO string-id register contracts after raw ICU redesign', () => {
	assert.deepEqual(MMIO_REGISTER_SPECS, []);
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
	// folded `'a' + 1` to NaN. This mirrors pietious' sync_input_state_from_runtime.
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
	for (const opt of [0, 1, 2, 3] as const) {
		const returned = runCompiledLua(source, 'reused_register_counter.lua', opt);
		assert.deepEqual(Array.from(returned), [1, true], `optLevel ${opt} miscompiled the counter`);
	}
});

test('ProgramCompiler treats raw ICU MMIO writes as plain word writes', () => {
	const source = [
		'mem[sys_inp_ctrl] = inp_ctrl_arm',
		'mem[sys_inp_output_port] = 2',
		'mem[sys_inp_output_duration_ms] = 120',
	].join('\n');
	const compiled = compileSource(source, 'raw_icu_words.lua');
	assert.ok(compiled.program.code.length > 0);
});
