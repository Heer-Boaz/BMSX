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

test('ProgramCompiler treats raw ICU MMIO writes as plain word writes', () => {
	const source = [
		'mem[sys_inp_ctrl] = inp_ctrl_arm',
		'mem[sys_inp_output_port] = 2',
		'mem[sys_inp_output_duration_ms] = 120',
	].join('\n');
	const compiled = compileSource(source, 'raw_icu_words.lua');
	assert.ok(compiled.program.code.length > 0);
});
