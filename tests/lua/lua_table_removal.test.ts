import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { findLuaTableFieldSeparator } from '../../toolchain/ts/lua/syntax/table_fields';
import { runCompiledLua } from './cpu_test_harness';

const resource: RuntimeResource = {
	domain: 0, path: 'table.lua',
	source: { resid: 'table.lua', type: 'lua', source_path: 'table.lua', generated: false },
};

function parseTable(source: string) {
	const parsed = parseLuaChunk(source, resource.path);
	const statement = parsed.chunk!.body[0];
	if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) throw new Error('expected local assignment');
	const table = statement.values[0];
	if (table.kind !== LuaSyntaxKind.TableConstructorExpression) throw new Error('expected table');
	return { parsed, table };
}

test('parser field ranges own expression-key brackets and all grouping, excluding exterior trivia and separators', () => {
	const texts = [
		'[("key")] -- key/value trivia\n = ((- --[[sign trivia]]\n 0x10))',
		'(factory({a = 1, b = 2}, ",;)}"))',
		'name = ((3))',
		'(function() return { 1; 2, 3 } end)',
	];
	const source = `local values = { -- outside\n${texts[0]} -- after field\n; ${texts[1]}, ${texts[2]}; ${texts[3]}\n}`;
	const model = new EditorTextModel(resource, 'lua', source);
	const { parsed, table } = parseTable(source);
	assert.deepEqual(table.fields.map(field => readLuaSourceRange(model.buffer, field.range)), texts);
	assert.deepEqual(table.fields.map(field => findLuaTableFieldSeparator(parsed.tokens, field)?.lexeme), [';', ',', ';', undefined]);
	assert.equal(readLuaSourceRange(model.buffer, table.fields[2].value.range), '3', 'child expression ranges keep their semantic meaning');
	const plain = parseTable('local values = { 10, { 20 }, named = 30 }').table;
	assert.equal(plain.fields[0].range, plain.fields[0].value.range, 'an ungrouped array field shares its immutable value range');
	assert.equal(plain.fields[1].range, plain.fields[1].value.range);
	assert.equal(plain.fields[2].range.end, plain.fields[2].value.range.end, 'a named field shares its unchanged endpoint');
});

test('removal keeps exterior comments verbatim and removes only the field plus its own separator', () => {
	const source = 'local values = { -- header\r\n\t[("key")] = ((--[=[inside]=]\r\n10)) -- after field, not punctuation\r\n\t; -- after separator\r\n\t(20), -- survivor\r\n} -- footer';
	const expected = 'local values = { -- header\r\n\t -- after field, not punctuation\r\n\t -- after separator\r\n\t(20), -- survivor\r\n} -- footer';
	const model = new EditorTextModel(resource, 'lua', source);
	const { parsed, table } = parseTable(source);
	let events = 0;
	model.onDidChangeContent(() => { events += 1; });
	const edits = createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, table.fields[0]);
	assert.equal(edits.length, 2);
	assert.ok(edits[0].offset + edits[0].deleteLength < edits[1].offset, 'outside comments are not included in a broad replacement');
	model.pushEditOperations(edits);
	assert.equal(events, 1);
	assert.equal(model.buffer.getText(), expected);
	assert.equal(parseTable(expected).table.fields.length, 1);
	assert.deepEqual(runCompiledLua(expected + '\nreturn values.key, values[1]'), [null, 20]);
	model.undo();
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'punctuation has no separate history entry');
	model.redo();
	assert.equal(model.buffer.getText(), expected);
});

test('first, middle and last array removal follow Lua order and allow an existing separator to become trailing', () => {
	for (const [index, expected, result] of [
		[0, 'local values = {  (20); (30) }', [20, 30, null]],
		[1, 'local values = { (10),  (30) }', [10, 30, null]],
		[2, 'local values = { (10), (20);  }', [10, 20, null]],
	] as const) {
		const model = new EditorTextModel(resource, 'lua', 'local values = { (10), (20); (30) }');
		const { parsed, table } = parseTable(model.buffer.getText());
		model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, table.fields[index]));
		assert.equal(model.buffer.getText(), expected);
		assert.deepEqual(runCompiledLua(expected + '\nreturn values[1], values[2], values[3]'), result);
	}
});

test('sole fields with either trailing separator or none produce an empty valid table', () => {
	for (const punctuation of ['', ',', ';']) {
		const source = `local values = { -- leading\n (10) -- trailing\n ${punctuation} -- footer\n}`;
		const model = new EditorTextModel(resource, 'lua', source);
		const { parsed, table } = parseTable(source);
		model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, table.fields[0]));
		const expected = 'local values = { -- leading\n  -- trailing\n  -- footer\n}';
		assert.equal(model.buffer.getText(), expected);
		assert.equal(parseTable(expected).table.fields.length, 0);
		assert.deepEqual(runCompiledLua(expected + '\nreturn values[1]'), [null]);
	}
});

test('field deletion is independent of key spelling and nested punctuation or comment-looking strings', () => {
	const fields = ['((10))', 'named = ({ nested = ",;--[["; other = (20) })', '[1 + 2] = (function() return 30 end)'];
	for (let index = 0; index < fields.length; index += 1) {
		const source = `local values = { ${fields.join(', ')}; }`;
		const model = new EditorTextModel(resource, 'lua', source);
		const { parsed, table } = parseTable(source);
		const edits = createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, table.fields[index]);
		assert.equal(model.buffer.getTextRange(edits[0].offset, edits[0].offset + edits[0].deleteLength), fields[index]);
		assert.equal(model.buffer.getTextRange(edits[1].offset, edits[1].offset + edits[1].deleteLength), index === fields.length - 1 ? ';' : ',');
		model.pushEditOperations(edits);
		const expected = [...fields];
		expected[index] = '';
		assert.equal(model.buffer.getText(), `local values = { ${expected.map((field, position) => position === index ? field : field + (position === fields.length - 1 ? ';' : ',')).join(' ')} }`);
		assert.equal(parseTable(model.buffer.getText()).table.fields.length, 2);
	}
});

test('repeated removal reparses the current document, and ordered document history restores exact source', () => {
	const source = 'local values = { (10), -- first\n (20); -- second\n (30), -- third\n}';
	const model = new EditorTextModel(resource, 'lua', source);
	for (let count = 3; count > 0; count -= 1) {
		const { parsed, table } = parseTable(model.buffer.getText());
		assert.equal(table.fields.length, count);
		model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, table.fields[0]));
	}
	assert.equal(parseTable(model.buffer.getText()).table.fields.length, 0);
	for (let index = 0; index < 3; index += 1) model.undo();
	assert.equal(model.buffer.getText(), source);
});
