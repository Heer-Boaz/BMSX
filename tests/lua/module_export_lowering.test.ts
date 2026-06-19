import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import type { ProgramConstReloc } from '../../machine/ts/machine/program/loader';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileWithModule(entrySource: string, modulePath: string, moduleSource: string): { disasm: string; constRelocs: ProgramConstReloc[] } {
	const entryChunk = parseSource(entrySource, 'entry.lua');
	const moduleChunk = parseSource(moduleSource, `${modulePath}.lua`);
	const compiled = compileLuaChunkToProgram(
		entryChunk,
		[{ path: modulePath, chunk: moduleChunk, source: moduleSource }],
		{ entrySource },
	);
	return {
		disasm: disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: false }),
		constRelocs: compiled.constRelocs,
	};
}

// Module return values remain real runtime tables so direct `require(x).field` and
// dynamic consumers keep Lua semantics. Static module-root calls still lower their
// call target to an export_proto relocation so the linker can replace function
// exports with direct CLOSURE operands.
test('static module function calls use export-proto relocations while preserving runtime tables', () => {
	const moduleSource = [
		'local api = {}',
		'function api.update() end',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\napi.update()', 'foo', moduleSource);
	const disasm = compiled.disasm;
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__update'), true, 'static module-root call must emit an export-proto relocation');
	assert.match(disasm, /\bNEWT\b/, 'module runtime table must still be materialized for require() consumers');
	assert.match(disasm, /\bSETFIELD\b/, 'exported function must still be stored on the returned table');
	assert.match(disasm, /\bSET(GL|SYS)\b/, 'export slot must remain populated for value reads and non-symbol exports');
});

// Non-call value reads must not use export_proto relocations; data exports use direct slots.
test('static module data reads use global slots, not export-proto relocations', () => {
	const moduleSource = [
		'local api = { value = 7 }',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\nreturn api.value + 1', 'foo', moduleSource);
	const disasm = compiled.disasm;
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__value'), false, 'data reads must not emit export-proto relocations');
	assert.match(disasm, /\bGET(GL|SYS)\b.*foo__value/, 'data read must use the export slot directly');
});

// Nested namespaces are runtime tables; flat export slots only represent direct fields.
test('nested module export namespace uses the table path', () => {
	const moduleSource = [
		'local function a() end',
		'return { sub = { a = a } }',
	].join('\n');
	const { disasm } = compileWithModule('local m<const> = require("bar")\nm.sub.a()', 'bar', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'nested export namespace still builds a table');
});

// A computed key `[k] = v` must not be misread as the literal key "k"; computed
// field ownership stays with the table value.
test('computed (non-literal) export key uses the table path', () => {
	const moduleSource = [
		'local function update() end',
		'local k<const> = "update"',
		'return { [k] = update }',
	].join('\n');
	const { disasm } = compileWithModule('local m<const> = require("baz")\nm.update()', 'baz', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'computed export key stays on the table path');
});
