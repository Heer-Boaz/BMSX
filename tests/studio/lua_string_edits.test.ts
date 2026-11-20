import { textToByteString } from '../../machine/ts/common/byte_string';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { quoteLuaByteString, quoteLuaString } from '../../toolchain/ts/lua/syntax/string_literal';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaStringValueEdit } from '../../ide/language/lua/source_edits';
import { afterTest } from '../helpers/test_cleanup';

test('Lua text literals preserve Unicode, controls and delimiters through the real lexer', () => {
	const values = ['', "both ' and \"", '\\z\\x20', '\0' + '123', '\r\n\t', 'é雪🎮', '\u2028\u2029', ']=]'];
	for (const quote of ["'", '"'] as const) for (const value of values) {
		const source = quoteLuaString(value, quote);
		assert.equal(source[0], quote);
		assert.equal(source[source.length - 1], quote);
		const tokens = new LuaLexer(source, 'string.lua').scanTokens();
		assert.equal(tokens.length, 2);
		assert.equal(tokens.get(0).literal, textToByteString(value));
	}
	assert.equal(quoteLuaString('\0' + '123'), "'\\x00123'");
});

test('Lua byte-string emission also round-trips invalid UTF-8 and adjacent hex digits', () => {
	for (const quote of ["'", '"'] as const) {
		const bytes = '\xff09\0é\xc3\xa9\n\"\'\\';
		const source = quoteLuaByteString(bytes, quote);
		assert.equal(new LuaLexer(source, 'bytes.lua').scanTokens().get(0).literal, bytes);
	}
});

test('a string-value edit preserves grouping and all exterior trivia in one Undo element', t => {
	for (const original of ["'old'", '"old"', '[==[old]==]', 'nil', 'false', 'true', '7']) {
		const source = `return ( --[[before]]\n ${original} --[[after]]\n)`;
		const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'value.lua', location: { kind: 'workspace' as const, path: 'value.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'value.lua', source: { type: 'lua', resid: 'value' } }, 'lua', source);
		afterTest(t, () => model.dispose());
		const file = buildLuaFileSemanticData(source, 'value.lua');
		const statement = file.chunk.body.get(0)!;
		assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
		const literal = statement.expressions[0];
		assert.ok(literal.kind === LuaSyntaxKind.StringLiteralExpression || literal.kind === LuaSyntaxKind.NilLiteralExpression
			|| literal.kind === LuaSyntaxKind.BooleanLiteralExpression || literal.kind === LuaSyntaxKind.NumericLiteralExpression);
		const value = 'new雪\n"\\\0' + '3';
		const edit = createLuaStringValueEdit(model.buffer, file.chunk.locations, literal, value, 'text');
		model.pushEditOperations([edit]);
		assert.equal(model.buffer.getText(), source.replace(original, quoteLuaString(value, original[0] === '"' ? '"' : "'")));
		const result = buildLuaFileSemanticData(model.buffer.getText(), 'value.lua');
		assert.equal(result.syntaxError, null);
		const returned = result.chunk.body.get(0)!;
		assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement && returned.expressions[0].kind === LuaSyntaxKind.StringLiteralExpression);
		assert.equal(returned.expressions[0].value, textToByteString(value));
		model.undo();
		assert.equal(model.buffer.getText(), source);
		assert.equal(model.canUndo, false);
		model.redo();
		assert.equal(model.buffer.getText(), source.replace(original, edit.text));
	}
});
