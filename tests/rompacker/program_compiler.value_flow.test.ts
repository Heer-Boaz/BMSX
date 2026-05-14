import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../src/bmsx/common/text_lines';
import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import { IO_INP_ACTION, IO_INP_BIND, IO_INP_CONSUME, IO_INP_QUERY } from '../../src/bmsx/machine/bus/io';
import { valueIsString } from '../../src/bmsx/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../src/bmsx/machine/program/compiler';
import { MMIO_REGISTER_SPEC_BY_ADDRESS } from '../../src/bmsx/machine/bus/registers';
import { runCompiledLua } from '../lua/cpu_test_harness';

function parseChunk(source: string, path: string = 'value_flow.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string, path: string = 'value_flow.lua') {
	return compileLuaChunkToProgram(parseChunk(source, path), [], { entrySource: source });
}

const ICU_STRING_ID_REGISTERS = [
	['sys_inp_action', IO_INP_ACTION],
	['sys_inp_bind', IO_INP_BIND],
	['sys_inp_query', IO_INP_QUERY],
	['sys_inp_consume', IO_INP_CONSUME],
] as const;

test('ProgramCompiler uses production string-id contracts for ICU string registers', () => {
	for (const [name, address] of ICU_STRING_ID_REGISTERS) {
		assert.equal(MMIO_REGISTER_SPEC_BY_ADDRESS.get(address)?.writeRequirement, 'string_id', name);
	}
});

test('ProgramCompiler rejects plain string writes to ICU string registers by address', () => {
	for (const [name, address] of ICU_STRING_ID_REGISTERS) {
		const source = [
			`local reg<const> = ${address}`,
			"mem[reg] = 'left[p]'",
		].join('\n');
		assert.throws(
			() => compileSource(source, `${name}_plain_string_address.lua`),
			/requires an interned string-id value/,
		);
	}
});

test('ProgramCompiler rejects plain string writes to ICU string registers by global name', () => {
	for (const [name] of ICU_STRING_ID_REGISTERS) {
		const source = `mem[${name}] = 'left[p]'`;
		assert.throws(
			() => compileSource(source, `${name}_plain_string_global.lua`),
			/requires an interned string-id value/,
		);
	}
});

test('ProgramCompiler accepts explicit dynamic & producers for ICU string registers', () => {
	const source = [
		"local action<const> = 'left'",
		"mem[sys_inp_query] = &(action .. '[p]')",
	].join('\n');
	const compiled = compileSource(source, 'sys_inp_query_dynamic_string_id.lua');
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler rejects non-string & producers for ICU string registers', () => {
	const source = 'mem[sys_inp_query] = &1';
	assert.throws(
		() => compileSource(source, 'sys_inp_query_string_id_number.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler emits & expression as a single result expression', () => {
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

test('ProgramCompiler accepts & writes to sys_inp_query', () => {
	const source = [
		`local reg<const> = ${IO_INP_QUERY}`,
		"local q<const> = &'left[p]'",
		'mem[reg] = q',
	].join('\n');
	const compiled = compileSource(source, 'sys_inp_query_ok.lua');
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler rejects plain string writes to sys_inp_query', () => {
	const source = [
		`local reg<const> = ${IO_INP_QUERY}`,
		"mem[reg] = 'left[p]'",
	].join('\n');
	assert.throws(
		() => compileSource(source, 'sys_inp_query_plain_string.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler rejects degraded aliases written to sys_inp_query', () => {
	const source = [
		'local function write(flag)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'left[p]'",
		'\tif flag then',
		"\t\tq = 'right[p]'",
		'\tend',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'sys_inp_query_degraded_alias.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler proves Lua and/or short-circuit expressions as string-id when truthiness is known', () => {
	const source = [
		`local reg<const> = ${IO_INP_QUERY}`,
		"mem[reg] = true and &'a' or &'b'",
	].join('\n');
	const compiled = compileSource(source, 'and_or_ok.lua');
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler rejects mixed and/or truthiness paths that are not provably string-id', () => {
	const source = [
		'local function write(flag)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tmem[reg] = flag and &'a' or 1",
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'and_or_fail.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler invalidates closure-written aliases after calls in local initializers', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal f<const> = function()',
		"\t\tq = 'x'",
		'\t\treturn 0',
		'\tend',
		'\tlocal tmp = f()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'initializer_call.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler invalidates closure-written aliases after calls in assignment RHS expressions', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal f<const> = function()',
		"\t\tq = 'x'",
		'\t\treturn 0',
		'\tend',
		'\tlocal tmp = 0',
		'\ttmp = f()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'rhs_call.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler invalidates closure-written aliases after calls in conditions', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal f<const> = function()',
		"\t\tq = 'x'",
		'\t\treturn false',
		'\tend',
		'\tif f() then',
		'\tend',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'condition_call.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler finds nested closure writes inside table constructors', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal holder<const> = {',
		'\t\tmutate = function()',
		"\t\t\tq = 'x'",
		'\t\t\treturn 0',
		'\t\tend,',
		'\t}',
		'\tholder.mutate()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'table_closure.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler iterates loop flow analysis to a real fixpoint instead of stopping after a low cap', () => {
	const source = [
		'local function write(cond, kick)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal a = &'a'",
		"\tlocal b = &'b'",
		"\tlocal c = &'c'",
		"\tlocal d = &'d'",
		"\tlocal e = &'e'",
		"\tlocal f = &'f'",
		'\twhile cond do',
		'\t\tf = e',
		'\t\te = d',
		'\t\td = c',
		'\t\tc = b',
		'\t\tb = a',
		'\t\ta = kick()',
		'\t\tmem[reg] = f',
		'\tend',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'loop_fixpoint.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler handles numeric for-loops without an explicit step expression', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tfor i = 1, 3 do',
		'\tend',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	const compiled = compileSource(source, 'numeric_for_default_step.lua');
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler matches assignment target-preparation order before RHS evaluation', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal t = {}',
		'\tlocal bump<const> = function()',
		"\t\tq = 'x'",
		"\t\treturn 'slot'",
		'\tend',
		'\tq, t[bump()] = q, 0',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'assignment_order.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler matches memory-target preparation order before RHS evaluation', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal bump<const> = function()',
		"\t\tq = 'x'",
		'\t\treturn reg',
		'\tend',
		'\tmem[bump()], q = 0, q',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'memory_assignment_order.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler treats function declarations as writing the declaration target', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tfunction q()',
		'\t\treturn 0',
		'\tend',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'function_target.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler treats simple function declarations as truthy function writes even when the target was not already tracked', () => {
	const source = [
		'local function write(p)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		'\tfunction p()',
		'\t\treturn 0',
		'\tend',
		"\tmem[reg] = p and &'a' or 1",
		'end',
		'return write',
	].join('\n');
	const compiled = compileSource(source, 'function_param_target.lua');
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler tracks nested closure writes introduced through function declarations', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal trigger = false',
		'\tfunction trigger()',
		'\t\tlocal inner<const> = function()',
		"\t\t\tq = 'x'",
		'\t\tend',
		'\t\tinner()',
		'\t\treturn 0',
		'\tend',
		'\ttrigger()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'function_decl_closure.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler does not treat dotted function declarations as rewriting the base lexical symbol', () => {
	const source = [
		'local function write(holder)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		'\tfunction holder.build()',
		'\t\treturn 0',
		'\tend',
		"\tmem[reg] = holder and &'a' or 1",
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'function_decl_dotted.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler does not treat method function declarations as rewriting the base lexical symbol', () => {
	const source = [
		'local function write(holder)',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		'\tfunction holder:build()',
		'\t\treturn 0',
		'\tend',
		"\tmem[reg] = holder and &'a' or 1",
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'function_decl_method.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler tracks nested closure writes in dotted function declaration bodies', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal holder = {}',
		'\tfunction holder.build()',
		'\t\tlocal inner<const> = function()',
		"\t\t\tq = 'x'",
		'\t\tend',
		'\t\tinner()',
		'\t\treturn 0',
		'\tend',
		'\tholder.build()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'function_decl_dotted_closure.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler keeps while-loop exit flow conservative when the condition call mutates tracked locals', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal keep_going = true',
		'\tlocal tick<const> = function()',
		'\t\tif keep_going then',
		'\t\t\tkeep_going = false',
		"\t\t\tq = 'x'",
		'\t\t\treturn true',
		'\t\tend',
		'\t\treturn false',
		'\tend',
		'\twhile tick() do',
		'\tend',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'while_condition.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler keeps repeat-until exit flow conservative when the condition call mutates tracked locals', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tlocal q = &'a'",
		'\tlocal done = false',
		'\tlocal tick<const> = function()',
		'\t\tif done then',
		'\t\t\treturn true',
		'\t\tend',
		'\t\tdone = true',
		"\t\tq = 'x'",
		'\t\treturn false',
		'\tend',
		'\trepeat',
		'\tuntil tick()',
		'\tmem[reg] = q',
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'repeat_condition.lua'),
		/requires an interned string-id value/,
	);
});

test('ProgramCompiler treats concat as plain string instead of preserving string-id', () => {
	const source = [
		'local function write()',
		`\tlocal reg<const> = ${IO_INP_QUERY}`,
		"\tmem[reg] = &'a' .. &'b'",
		'end',
		'return write',
	].join('\n');
	assert.throws(
		() => compileSource(source, 'concat_plain_string.lua'),
		/requires an interned string-id value/,
	);
});
