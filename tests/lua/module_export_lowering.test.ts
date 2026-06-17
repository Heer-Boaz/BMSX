import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileWithModule(entrySource: string, modulePath: string, moduleSource: string): string {
	const entryChunk = parseSource(entrySource, 'entry.lua');
	const moduleChunk = parseSource(moduleSource, `${modulePath}.lua`);
	const compiled = compileLuaChunkToProgram(
		entryChunk,
		[{ path: modulePath, chunk: moduleChunk, source: moduleSource }],
		{ entrySource },
	);
	return disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: false });
}

// A module's `return { a = a, b = b }` is an export manifest, not a runtime table.
// It must lower to direct export-slot stores, never a materialized-and-scraped table.
test('flat module export return lowers to direct export-slot stores (no scaffold table)', () => {
	const moduleSource = [
		'local function update() end',
		'local function draw() end',
		'return { update = update, draw = draw }',
	].join('\n');
	// Idiomatic import: `local m<const> = require(...)` binds statically, so members
	// resolve to export slots (GETGL) and the module's return value is never consumed.
	const disasm = compileWithModule('local m<const> = require("foo")\nm.update()\nm.draw()', 'foo', moduleSource);
	// No table is materialized or filled, and nothing is scraped back out of one.
	assert.doesNotMatch(disasm, /\bNEWT\b/, 'flat export return must not materialize a runtime table');
	assert.doesNotMatch(disasm, /\bSETFIELD\b/, 'flat export return must not fill a table');
	assert.doesNotMatch(disasm, /\bGETFIELD\b/, 'flat export return must not scrape fields back out');
	assert.doesNotMatch(disasm, /\bSETT\b/, 'flat export return must not use generic table set');
	assert.doesNotMatch(disasm, /\bGETT\b/, 'flat export return must not use generic table get');
	assert.match(disasm, /\bSET(GL|SYS)\b/, 'exports must be written directly to export slots');
});

// Nesting is not (yet) destructurable into flat slots, so it must fall back to the
// table path rather than silently dropping the sub-namespace.
test('nested module export namespace falls back to the table path', () => {
	const moduleSource = [
		'local function a() end',
		'return { sub = { a = a } }',
	].join('\n');
	const disasm = compileWithModule('local m<const> = require("bar")\nm.sub.a()', 'bar', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'nested export namespace still builds a table (fallback path)');
});

// A computed key `[k] = v` must not be misread as the literal key "k"; it falls
// back to the table path rather than writing the wrong export slot directly.
test('computed (non-literal) export key falls back to the table path', () => {
	const moduleSource = [
		'local function update() end',
		'local k<const> = "update"',
		'return { [k] = update }',
	].join('\n');
	const disasm = compileWithModule('local m<const> = require("baz")\nm.update()', 'baz', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'computed export key must fall back to the table path');
});
