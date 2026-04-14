import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LuaLexer } from '../../src/bmsx/lua/syntax/lualexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/luaparser';
import { compileLuaChunkToProgram } from '../../src/bmsx/emulator/program_compiler';
import {
	MMIO_REGISTER_SPEC_BY_ADDRESS,
	MMIO_REGISTER_SPEC_BY_NAME,
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
	const byAddress = MMIO_REGISTER_SPEC_BY_ADDRESS as Map<number, MmioRegisterSpec>;
	const byName = MMIO_REGISTER_SPEC_BY_NAME as Map<string, MmioRegisterSpec>;
	const previousByAddress = byAddress.get(address);
	const previousByName = byName.get(name);
	const spec: MmioRegisterSpec = {
		name,
		address,
		writeRequirement: 'string_ref',
	};
	byAddress.set(address, spec);
	byName.set(name, spec);
	try {
		return run();
	} finally {
		if (previousByAddress === undefined) {
			byAddress.delete(address);
		} else {
			byAddress.set(address, previousByAddress);
		}
		if (previousByName === undefined) {
			byName.delete(name);
		} else {
			byName.set(name, previousByName);
		}
	}
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
