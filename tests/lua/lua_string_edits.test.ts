import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { quoteLuaString } from '../../toolchain/ts/lua/syntax/string_literal';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaStringValueEdit } from '../../ide/language/lua/source_edits';

test('Lua string emission round-trips bytes, delimiters and Unicode through the real lexer', () => {
	const values = ['', "both ' and \"", '\\z\\x20', '\0' + '123', '\r\n\t', 'é雪🎮', '\u2028\u2029', ']=]'];
	for (let code = 0; code < 256; code += 1) values.push(String.fromCharCode(code) + '09');
	for (const quote of ["'", '"'] as const) for (const value of values) {
		const source = quoteLuaString(value, quote);
		assert.equal(source[0], quote);
		assert.equal(source[source.length - 1], quote);
		const tokens = new LuaLexer(source, 'string.lua').scanTokens();
		assert.equal(tokens.length, 2);
		assert.equal(tokens[0].literal, value);
	}
	assert.equal(quoteLuaString('\0' + '123'), "'\\x00123'");
});

test('a string-value edit preserves grouping and all exterior trivia in one Undo element', t => {
	for (const original of ["'old'", '"old"', '[==[old]==]', 'nil', 'false', 'true', '7']) {
		const source = `return ( --[[before]]\n ${original} --[[after]]\n)`;
		const model = new EditorTextModel({ domain: 0, path: 'value.lua', source: { type: 'lua', resid: 'value' } }, 'lua', source);
		t.after(() => model.dispose());
		const statement = buildLuaFileSemanticData(source, 'value.lua').chunk.body[0];
		assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
		const literal = statement.expressions[0];
		assert.ok(literal.kind === LuaSyntaxKind.StringLiteralExpression || literal.kind === LuaSyntaxKind.NilLiteralExpression
			|| literal.kind === LuaSyntaxKind.BooleanLiteralExpression || literal.kind === LuaSyntaxKind.NumericLiteralExpression);
		const value = 'new\n"\\\0' + '3';
		const edit = createLuaStringValueEdit(model.buffer, literal, value);
		model.pushEditOperations([edit]);
		assert.equal(model.buffer.getText(), source.replace(original, quoteLuaString(value, original[0] === '"' ? '"' : "'")));
		const result = buildLuaFileSemanticData(model.buffer.getText(), 'value.lua');
		assert.equal(result.syntaxError, null);
		const returned = result.chunk.body[0];
		assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement && returned.expressions[0].kind === LuaSyntaxKind.StringLiteralExpression);
		assert.equal(returned.expressions[0].value, value);
		model.undo();
		assert.equal(model.buffer.getText(), source);
		assert.equal(model.canUndo, false);
		model.redo();
		assert.equal(model.buffer.getText(), source.replace(original, edit.text));
	}
});
