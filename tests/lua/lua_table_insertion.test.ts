import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { countLeadingIndent, extractIndentation } from '../../ide/editor/text/indentation';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../ide/language/lua/table_field_insertion';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { runCompiledLua } from './cpu_test_harness';

const resource: RuntimeResource = {
	domain: 0, path: 'table.lua', source: { resid: 'table.lua', type: 'lua', source_path: 'table.lua', generated: false },
};

function parseTable(source: string) {
	const parsed = parseLuaChunk(source, resource.path);
	assert.equal(parsed.syntaxError, null, source);
	const statement = parsed.chunk!.body[0];
	if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) throw new Error('expected local assignment');
	const table = statement.values[0];
	if (table.kind !== LuaSyntaxKind.TableConstructorExpression) throw new Error('expected table');
	return table;
}

function insert(source: string, index: number, fieldSource: string) {
	const model = new EditorTextModel(resource, 'lua', source);
	const table = parseTable(source);
	const fields = table.fields.map(field => readLuaSourceRange(model.buffer, field.range));
	const edits = createLuaTableFieldInsertionEdits(model.buffer, resource.path, table, index, fieldSource);
	assert.ok(edits.length >= 1 && edits.length <= 2 && edits.every(edit => edit.deleteLength === 0));
	assert.equal(new Set(edits.map(edit => edit.offset)).size, edits.length, 'coincident punctuation belongs to one producer-ordered insertion');
	let events = 0;
	model.onDidChangeContent(() => { events += 1; });
	model.pushEditOperations(edits);
	const result = model.buffer.getText();
	const inserted = parseTable(result);
	fields.splice(index, 0, fieldSource);
	assert.deepEqual(inserted.fields.map(field => readLuaSourceRange(model.buffer, field.range)), fields,
		'insertion preserves every complete field interior exactly, in the requested order');
	assert.equal(events, 1);
	model.undo();
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'punctuation and the field share one history element');
	model.redo();
	assert.equal(model.buffer.getText(), result);
	assert.equal(events, 3);
	return { result, edits, model };
}

test('shared indentation owner retains spaces/tabs without treating source content as indentation', () => {
	for (const [source, expected] of [['', ''], ['abc', ''], [' \t  text', ' \t  '], ['\t\t', '\t\t'], ['\t\r\n', '\t'], ['\v x', ''], ['\u00a0 x', '']]) {
		assert.equal(extractIndentation(source), expected);
		assert.equal(countLeadingIndent(source), expected.length);
	}
});

test('inserting the first field uses real empty-table braces and preserves their comments and padding', () => {
	const cases = [
		['local values = {}', 'local values = {added = 7}'],
		['local values = {   }', 'local values = {   added = 7   }'],
		['local values = { --[[header]] \t}', 'local values = { --[[header]] \tadded = 7 \t}'],
		['local values = {\n}', 'local values = {\n\tadded = 7\n}'],
		['  local values = { -- header\r\n  -- footer\r\n  }', '  local values = { -- header\r\n  \tadded = 7\r\n  -- footer\r\n  }'],
		['local values = (( -- outside\n { --[=[header\ninside header]=] }))',
			'local values = (( -- outside\n { --[=[header\ninside header]=] \n \tadded = 7\n }))'],
	];
	for (const [source, expected] of cases) assert.equal(insert(source, 0, 'added = 7').result, expected, source);
});

test('inline first/middle/last insertion preserves comma and semicolon lists including trailing separators', () => {
	const cases: [string, number, string][] = [
		['local values = {a=1}', 0, 'local values = {added = 7, a=1}'],
		['local values = {a=1}', 1, 'local values = {a=1, added = 7}'],
		['local values = {a=1; b=2}', 1, 'local values = {a=1; added = 7; b=2}'],
		['local values = {a=1; b=2}', 2, 'local values = {a=1; b=2; added = 7}'],
		['local values = {a=1, b=2,  }', 2, 'local values = {a=1, b=2, added = 7,  }'],
		['local values = {a=1;  }', 1, 'local values = {a=1; added = 7;  }'],
		['local values = {a=1 --[[first]], --[[separator]] b=2}', 1,
			'local values = {a=1 --[[first]], --[[separator]] added = 7, b=2}'],
		['local values = {a=1 --[[last]] }', 1, 'local values = {a=1, --[[last]] added = 7 }'],
	];
	for (const [source, index, expected] of cases) assert.equal(insert(source, index, 'added = 7').result, expected, source);
});

test('multiline insertion never copies sibling documentation, inline comments or enclosing footer trivia', () => {
	const header = 'local values = { -- header\r\n';
	const first = '\t-- first ☃\r\n\ta=1; -- first inline\r\n';
	const second = '\r\n\t--[=[ second documentation ]=]\r\n\tb=2 -- before separator\r\n\t, -- second inline\r\n';
	const footer = '\t-- footer\r\n} -- outside';
	const source = header + first + second + footer;
	assert.equal(insert(source, 0, 'added = 7').result, header + '\tadded = 7;\r\n' + first + second + footer);
	assert.equal(insert(source, 1, 'added = 7').result, header + first + '\tadded = 7,\r\n' + second + footer);
	assert.equal(insert(source, 2, 'added = 7').result, header + first + second + '\tadded = 7,\r\n' + footer);
});

test('appending punctuation precedes comments and does not consume the closing brace into a line comment', () => {
	const cases = [
		['local values = {\n\ta=1 -- last\n}', 'local values = {\n\ta=1, -- last\n\tadded = 7\n}'],
		['local values = {\n\ta=1}', 'local values = {\n\ta=1,\n\tadded = 7\n}'],
		['local values = {a=1 --[[last\ncontinues]]}', 'local values = {a=1, --[[last\ncontinues]]\n\tadded = 7\n}'],
		['local values = {a=1, -- last\n-- footer\n}', 'local values = {a=1, -- last\n\tadded = 7,\n-- footer\n}'],
		['local values = {\n\ta=1 -- before separator\n\t; -- separator\n}',
			'local values = {\n\ta=1 -- before separator\n\t; -- separator\n\tadded = 7;\n}'],
	];
	for (const [source, expected] of cases) assert.equal(insert(source, 1, 'added = 7').result, expected, source);
	assert.equal(insert(cases[0][0], 1, 'added = 7').edits.length, 2, 'a separate punctuation offset stays a separate insertion in the same batch');
	assert.equal(insert('local values = {a=1}', 1, 'added = 7').edits.length, 1, 'coincident insertions are ordered by their producer');
});

test('field interiors stay byte-exact through grouped keys, nested functions, long strings and escaped newlines', () => {
	const source = 'local values = {\r\n\t["old,;"] = (([=[\nold -- string\n]=]));\r\n}';
	for (const field of [
		'[("new")] = ((10))',
		'(function() return { 1, 2; "--" } end)',
		'["new"] = [=[\n \t-- not an indentation edit\n]=]',
		'new = ("\\z \r\n  --[[inside string]]")',
		'new = (--[[inside grouped field]]\n\t{ pos = { x = 1, y = 2, z = 3 } })',
	]) {
		for (let index = 0; index <= 1; index += 1) insert(source, index, field);
	}
});

test('inserted Lua fields change actual BLua32 evaluation and array order at every position', () => {
	const source = 'local values = { value(1); value(2), value(3) }';
	const prefix = 'local order = 0\nlocal function value(n) order = order * 10 + n; return n end\n';
	for (let index = 0; index <= 3; index += 1) {
		const expected = [1, 2, 3];
		expected.splice(index, 0, 7);
		const result = insert(source, index, 'value(7)').result;
		assert.deepEqual(runCompiledLua(prefix + result + '\nreturn order, #values, values[1], values[2], values[3], values[4]'),
			[expected.reduce((order, value) => order * 10 + value, 0), 4, ...expected]);
	}
});

test('inserting next to a call leaves result arity to the BLua compiler, without rewriting the old expression', () => {
	const source = 'local values = { value() }';
	const prefix = 'local function value() return 1, 2, 3 end\n';
	const suffix = '\nreturn #values, values[1], values[2], values[3], values[4]';
	// compileTableConstructor currently requests one result per field. The
	// editor must match directly authored BLua, not impose stock-Lua expansion.
	for (const [index, authored] of [[0, 'local values = { 7, value() }'], [1, 'local values = { value(), 7 }']] as const) {
		assert.deepEqual(runCompiledLua(prefix + insert(source, index, '7').result + suffix),
			runCompiledLua(prefix + authored + suffix));
	}
});

test('repeated insertion reuses actual syntax and one history element per field without accumulating separators', () => {
	const original = 'local values = {\n}';
	const model = new EditorTextModel(resource, 'lua', original);
	for (let index = 0; index < 12; index += 1) {
		model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, resource.path, parseTable(model.buffer.getText()), index, String(index + 1)));
	}
	const expected = 'local values = {\n' + Array.from({ length: 12 }, (_, index) => '\t' + (index + 1) + (index < 11 ? ',' : '') + '\n').join('') + '}';
	assert.equal(model.buffer.getText(), expected);
	assert.deepEqual(runCompiledLua(expected + '\nreturn #values, values[1], values[12]'), [12, 1, 12]);
	for (let index = 0; index < 12; index += 1) model.undo();
	assert.equal(model.buffer.getText(), original);
	assert.equal(model.undo(), null);
	for (let index = 0; index < 12; index += 1) model.redo();
	assert.equal(model.buffer.getText(), expected);
});
