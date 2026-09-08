import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldMoveEdit } from '../../ide/language/lua/table_field_moves';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { getLuaTableFieldTriviaSpan } from '../../toolchain/ts/lua/syntax/table_fields';
import { runCompiledLua } from './cpu_test_harness';

const resource: RuntimeResource = {
	domain: 0, path: 'table.lua',
	source: { resid: 'table.lua', type: 'lua', source_path: 'table.lua', generated: false },
};

function parseTable(source: string) {
	const parsed = parseLuaChunk(source, resource.path);
	assert.equal(parsed.syntaxError, null);
	const statement = parsed.chunk!.body[0];
	if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) throw new Error('expected local assignment');
	const table = statement.values[0];
	if (table.kind !== LuaSyntaxKind.TableConstructorExpression) throw new Error('expected table');
	return table;
}

test('Lua punctuated field spans own documentation and inline trivia, not enclosing brace trivia', () => {
	const header = 'local values = { -- table header\r\n';
	const first = '\t-- first documentation ☃\r\n\t[("key")] = ((10)) -- before separator, not punctuation\r\n\t; -- first inline\r\n';
	const second = '\r\n\t--[=[ second documentation ]=]\r\n\t(20), -- second inline\r\n';
	const footer = '\t-- table footer\r\n} -- outside';
	const source = header + first + second + footer;
	const table = parseTable(source);
	const tokens = new LuaLexer(source, resource.path, false).scanTokens();
	const model = new EditorTextModel(resource, 'lua', source);
	const spans = table.fields.map(field => getLuaTableFieldTriviaSpan(tokens, field));
	assert.equal(spans[0].endToken, spans[1].startToken, 'adjacent punctuated pairs have one shared trivia boundary');
	assert.deepEqual(spans.map(span => model.buffer.getTextRange(
		model.buffer.offsetAt(span.startToken.line - 1, span.startToken.column - 1),
		model.buffer.offsetAt(span.endToken.line - 1, span.endToken.column - 1),
	)), [first, second]);
	assert.deepEqual(spans.map(span => span.separator!.lexeme), [';', ',']);
	const edit = createLuaTableFieldMoveEdit(model.buffer, resource.path, table, 1, -1);
	assert.equal(edit.offset, header.length);
	assert.equal(edit.deleteLength, first.length + second.length);
	assert.equal(edit.text, second + first);
	model.pushEditOperations([edit]);
	assert.equal(model.buffer.getText(), header + second + first + footer);
	assert.equal(parseTable(model.buffer.getText()).fields.length, 2);
});

test('moving fields follows token attachment through long comments, strings and unusual line layouts', () => {
	const cases = [
		['local values = { a=1, b=2 }', 'local values = { b=2, a=1, }'],
		['local values = {\n a=1,\n b=2}', 'local values = {\n b=2, a=1,\n}'],
		['local values = {a=1, -- inline\n b=2 -- last\n}', 'local values = { b=2, -- last\na=1, -- inline\n}'],
		['local values = {a=1; b=2;}', 'local values = {b=2;a=1; }'],
		['local values = {\n a=1, --[=[ first\n still first ]=] \n -- second\n b=2,\n}',
			'local values = {\n -- second\n b=2,\n a=1, --[=[ first\n still first ]=] \n}'],
		['local values = {\n a=1, --[[first\n]] b=2,\n}', 'local values = {\nb=2,\n a=1, --[[first\n]] }'],
		['local values = {\n ["--🚀,;"] = (([=[\nnot -- a comment,; }\n]=]));\n (function() return {"--"; ","} end),\n}',
			'local values = {\n (function() return {"--"; ","} end),\n ["--🚀,;"] = (([=[\nnot -- a comment,; }\n]=]));\n}'],
		['local values = {\r\n a=("\\z \r\n  --[[text]]");\r\n b=2 -- last\r\n}',
			'local values = {\r\n b=2, -- last\r\n a=("\\z \r\n  --[[text]]");\r\n}'],
	];
	for (const [source, expected] of cases) {
		for (const [index, direction] of [[0, 1], [1, -1]] as const) {
			const model = new EditorTextModel(resource, 'lua', source);
			const table = parseTable(source);
			const texts = table.fields.map(field => readLuaSourceRange(model.buffer, field.range));
			model.pushEditOperations([createLuaTableFieldMoveEdit(model.buffer, resource.path, table, index, direction)]);
			assert.equal(model.buffer.getText(), expected, source);
			assert.deepEqual(parseTable(expected).fields.map(field => readLuaSourceRange(model.buffer, field.range)), texts.reverse());
			model.undo();
			assert.equal(model.buffer.getText(), source);
			model.redo();
			assert.equal(model.buffer.getText(), expected);
		}
	}
});

test('missing separators are inserted before comments; repeated moves do not accumulate punctuation', () => {
	const source = 'local values = {\n\t(10), -- first\n\t(20); -- middle\n\t(30) -- last\n}';
	const model = new EditorTextModel(resource, 'lua', source);
	let events = 0;
	model.onDidChangeContent(() => { events += 1; });
	for (const [index, direction] of [[2, -1], [1, -1], [0, 1], [1, 1]] as const) {
		model.pushEditOperations([createLuaTableFieldMoveEdit(model.buffer, resource.path, parseTable(model.buffer.getText()), index, direction)]);
	}
	assert.equal(events, 4, 'one event and history element per explicit move');
	const withSeparator = source.replace('(30)', '(30),');
	assert.equal(model.buffer.getText(), withSeparator, 'only the grammar-required comma survives the round trip');
	assert.deepEqual(runCompiledLua(withSeparator + '\nreturn values[1], values[2], values[3]'), [10, 20, 30]);
	for (let index = 0; index < 4; index += 1) model.undo();
	assert.equal(model.buffer.getText(), source, 'Undo also restores the formerly absent separator');
	assert.equal(model.undo(), null);
	for (let index = 0; index < 4; index += 1) model.redo();
	assert.equal(model.buffer.getText(), withSeparator);
});

test('first, interior and final swaps change actual BLua32 field evaluation and array order', () => {
	const source = 'local values = {\n value(1),\n value(2);\n (value(3)),\n value(4)\n}';
	const prefix = 'local order = 0\nlocal function value(n) order = order * 10 + n; return n end\n';
	for (const [index, direction, expected] of [
		[0, 1, [2134, 2, 1, 3, 4]],
		[2, -1, [1324, 1, 3, 2, 4]],
		[3, -1, [1243, 1, 2, 4, 3]],
	] as const) {
		const model = new EditorTextModel(resource, 'lua', source);
		model.pushEditOperations([createLuaTableFieldMoveEdit(model.buffer, resource.path, parseTable(source), index, direction)]);
		assert.deepEqual(runCompiledLua(prefix + model.buffer.getText() + '\nreturn order, values[1], values[2], values[3], values[4]'), expected);
	}
});

test('moving syntax fields does not confuse identical names or mutate nested or neighbouring lists', () => {
	const first = '\t-- first\n\tduplicate = {1, 2; 3},\n';
	const second = '\t-- second\n\tduplicate = {4, 5; 6},\n';
	const source = 'local values = {\n' + first + second + '}\nlocal other = {7,8}';
	const model = new EditorTextModel(resource, 'lua', source);
	model.pushEditOperations([createLuaTableFieldMoveEdit(model.buffer, resource.path, parseTable(source), 0, 1)]);
	assert.equal(model.buffer.getText(), 'local values = {\n' + second + first + '}\nlocal other = {7,8}');
	assert.deepEqual(runCompiledLua(model.buffer.getText() + '\nreturn values.duplicate[1], other[2]'), [1, 8]);
});
