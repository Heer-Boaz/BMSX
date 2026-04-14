import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LuaLexer } from '../../src/bmsx/lua/syntax/lualexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/luaparser';
import { compileLuaChunkToProgram } from '../../src/bmsx/emulator/program_compiler';
import {
	withTemporaryMmioRegisterSpec,
	type MmioRegisterSpec,
} from '../../src/bmsx/emulator/mmio_register_spec';

function parseChunk(source: string, path: string = 'value_flow.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, source);
	return parser.parseChunk();
}

function compileSource(source: string, path: string = 'value_flow.lua') {
	return compileLuaChunkToProgram(parseChunk(source, path), [], { entrySource: source });
}

function withStringRefRegister<T>(address: number, name: string, run: () => T): T {
	const spec: MmioRegisterSpec = {
		name,
		address,
		writeRequirement: 'string_ref',
	};
	return withTemporaryMmioRegisterSpec(spec, run);
}

test('ProgramCompiler proves Lua and/or short-circuit expressions as string_ref when truthiness is known', () => {
	withStringRefRegister(0x5100, 'sys_test_flow_and_or_ok', () => {
		const source = [
			'local reg<const> = 20736',
			"mem[reg] = true and &'a' or &'b'",
		].join('\n');
		const compiled = compileSource(source, 'and_or_ok.lua');
		assert.ok(compiled.program.code.length > 0);
	});
});

test('ProgramCompiler rejects mixed and/or truthiness paths that are not provably string_ref', () => {
	withStringRefRegister(0x5101, 'sys_test_flow_and_or_fail', () => {
		const source = [
			'local function write(flag)',
			'\tlocal reg<const> = 20737',
			"\tmem[reg] = flag and &'a' or 1",
			'end',
			'return write',
		].join('\n');
		assert.throws(
			() => compileSource(source, 'and_or_fail.lua'),
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler invalidates closure-written aliases after calls in local initializers', () => {
	withStringRefRegister(0x5102, 'sys_test_flow_initializer_call', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20738',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler invalidates closure-written aliases after calls in assignment RHS expressions', () => {
	withStringRefRegister(0x5103, 'sys_test_flow_rhs_call', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20739',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler invalidates closure-written aliases after calls in conditions', () => {
	withStringRefRegister(0x5104, 'sys_test_flow_condition_call', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20740',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler finds nested closure writes inside table constructors', () => {
	withStringRefRegister(0x5105, 'sys_test_flow_table_closure', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20741',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler iterates loop flow analysis to a real fixpoint instead of stopping after a low cap', () => {
	withStringRefRegister(0x5106, 'sys_test_flow_loop_fixpoint', () => {
		const source = [
			'local function write(cond, kick)',
			'\tlocal reg<const> = 20742',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler matches assignment target-preparation order before RHS evaluation', () => {
	withStringRefRegister(0x5107, 'sys_test_flow_assignment_order', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20743',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler matches memory-target preparation order before RHS evaluation', () => {
	withStringRefRegister(0x5108, 'sys_test_flow_memory_assignment_order', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20744',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler treats function declarations as writing the declaration target', () => {
	withStringRefRegister(0x5109, 'sys_test_flow_function_target', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20745',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler treats simple function declarations as truthy function writes even when the target was not already tracked', () => {
	withStringRefRegister(0x510a, 'sys_test_flow_function_param_target', () => {
		const source = [
			'local function write(p)',
			'\tlocal reg<const> = 20746',
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
});

test('ProgramCompiler tracks nested closure writes introduced through function declarations', () => {
	withStringRefRegister(0x510b, 'sys_test_flow_function_decl_closure', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20747',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler does not treat dotted function declarations as rewriting the base lexical symbol', () => {
	withStringRefRegister(0x510c, 'sys_test_flow_function_decl_dotted', () => {
		const source = [
			'local function write(holder)',
			'\tlocal reg<const> = 20748',
			'\tfunction holder.build()',
			'\t\treturn 0',
			'\tend',
			"\tmem[reg] = holder and &'a' or 1",
			'end',
			'return write',
		].join('\n');
		assert.throws(
			() => compileSource(source, 'function_decl_dotted.lua'),
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler does not treat method function declarations as rewriting the base lexical symbol', () => {
	withStringRefRegister(0x510d, 'sys_test_flow_function_decl_method', () => {
		const source = [
			'local function write(holder)',
			'\tlocal reg<const> = 20749',
			'\tfunction holder:build()',
			'\t\treturn 0',
			'\tend',
			"\tmem[reg] = holder and &'a' or 1",
			'end',
			'return write',
		].join('\n');
		assert.throws(
			() => compileSource(source, 'function_decl_method.lua'),
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler keeps while-loop exit flow conservative when the condition call mutates tracked locals', () => {
	withStringRefRegister(0x510e, 'sys_test_flow_while_condition', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20750',
			"\tlocal q = &'a'",
			'\tlocal keepGoing = true',
			'\tlocal tick<const> = function()',
			'\t\tif keepGoing then',
			'\t\t\tkeepGoing = false',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler keeps repeat-until exit flow conservative when the condition call mutates tracked locals', () => {
	withStringRefRegister(0x510f, 'sys_test_flow_repeat_condition', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20751',
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
			/requires a string_ref value/,
		);
	});
});

test('ProgramCompiler treats concat as plain string instead of preserving string_ref', () => {
	withStringRefRegister(0x5110, 'sys_test_flow_concat_plain_string', () => {
		const source = [
			'local function write()',
			'\tlocal reg<const> = 20752',
			"\tmem[reg] = &'a' .. &'b'",
			'end',
			'return write',
		].join('\n');
		assert.throws(
			() => compileSource(source, 'concat_plain_string.lua'),
			/requires a string_ref value/,
		);
	});
});
