import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { parseLuaFieldValueEdit } from '../../ide/language/lua/field_value_edit';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

const SOURCE = "local timing<const> = 7\nlocal effect<const> = { period_ms = (timing), -- keep this\n event = 'ready' }\nreturn effect";

test('a submitted value is an isolated expression, not a second statement, printer or evaluated value', t => {
	const model = new EditorTextModel({ domain: 0, path: 'values.lua', source: { type: 'lua', resid: 'values' } }, 'lua', SOURCE);
	t.after(() => model.dispose());
	const file = buildLuaFileSemanticData(SOURCE, model.resource.path);
	const statement = file.chunk.body[1];
	assert.ok(statement.kind === LuaSyntaxKind.LocalAssignmentStatement && statement.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
	const field = statement.values[0].fields[0];
	for (const value of ['clock.delta() * 2', "'Changed Tag'", 'false', 'function(owner) return owner.period end', '{ 1, 2 }', ' 1 --[[note]] ', '1 -- note\n']) {
		const result = parseLuaFieldValueEdit(model.buffer, field, value);
		assert.ok('value' in result, value);
		model.pushEditOperations([result.value.edit]);
		assert.equal(model.buffer.getText(), SOURCE.replace('(timing)', '(' + value + ')'));
		const next = buildLuaFileSemanticData(model.buffer.getText(), model.resource.path);
		assert.equal(next.syntaxError, null);
		const declaration = next.chunk.body[1];
		assert.ok(declaration.kind === LuaSyntaxKind.LocalAssignmentStatement && declaration.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
		const actual = declaration.values[0].fields[0];
		assert.deepEqual(result.value.fieldRange, actual.range);
		assert.deepEqual(result.value.expressionRange, actual.value.range);
		model.undo(); assert.equal(model.buffer.getText(), SOURCE);
	}
	for (const value of ['', '1, 2', '1; effect.event = false', ')', 'clock.', '1 -- swallowed neighbour', '1 --[=[unfinished', 'function()']) {
		assert.ok('error' in parseLuaFieldValueEdit(model.buffer, field, value), value);
		assert.equal(model.buffer.getText(), SOURCE);
	}
});
