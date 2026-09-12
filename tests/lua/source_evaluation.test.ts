import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { collectLuaSourceEvaluation } from '../../toolchain/ts/lua/semantic/source_evaluation';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { runCompiledLua } from './cpu_test_harness';

test('source evaluation includes eager reads/operations, not a referenced initializer or a callback body', () => {
	const source = `local alias<const> = make_elsewhere()
return { alias, build(value), object.field, object[key], left + right,
 function() return deferred(captured) end, condition and maybe(), ... }`;
	const file = buildLuaFileSemanticData(source, 'evaluation.lua');
	const statement = file.chunk.body[1];
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const evaluation = collectLuaSourceEvaluation(file, statement.expressions[0]);
	assert.deepEqual(evaluation.filter(item => item.kind === 'call').map(item => {
		assert.ok(item.expression.kind === LuaSyntaxKind.CallExpression && item.expression.callee.kind === LuaSyntaxKind.IdentifierExpression);
		return item.expression.callee.name;
	}), ['build', 'maybe']);
	assert.deepEqual(evaluation.filter(item => item.kind === 'read').map(item => {
		assert.ok(item.expression.kind === LuaSyntaxKind.IdentifierExpression);
		return item.expression.name;
	}), ['alias', 'build', 'value', 'object', 'object', 'key', 'left', 'right', 'condition', 'maybe']);
	assert.equal(evaluation.filter(item => item.kind === 'access').length, 2);
	assert.equal(evaluation.filter(item => item.kind === 'operation').length, 2);
	assert.equal(evaluation.filter(item => item.kind === 'vararg').length, 1);
});

test('compiled execution demonstrates why a binding-preserving move is not an evaluation-order guarantee', () => {
	const source = `local serial=0
local next_value<const> = function() serial=serial+1; return serial end
local from={ {duration_ticks=next_value()}, {duration_ticks=next_value()} }
local to={}`;
	const file = buildLuaFileSemanticData(source, 'evaluation.lua');
	const from = file.chunk.body[2], to = file.chunk.body[3];
	assert.ok(from.kind === LuaSyntaxKind.LocalAssignmentStatement && to.kind === LuaSyntaxKind.LocalAssignmentStatement);
	const table = from.values[0], target = to.values[0];
	assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression && target.kind === LuaSyntaxKind.TableConstructorExpression);
	const expression = table.fields[0].value;
	assert.equal(collectLuaSourceEvaluation(file, expression).filter(item => item.kind === 'call').length, 1);
	const model = new EditorTextModel({domain:0,path:file.file,source:{type:'lua',resid:'evaluation'}}, 'lua', source);
	model.pushEditOperations(createLuaTableFieldTransfer(model.buffer, file.file, table.fields[0], target, 0).edits);
	assert.deepEqual(runCompiledLua(source + '\nreturn from[2].duration_ticks'), [2]);
	assert.deepEqual(runCompiledLua(model.buffer.getText() + '\nreturn from[1].duration_ticks, to[1].duration_ticks'), [1, 2]);
	model.undo();
	assert.equal(model.buffer.getText(), source);
	model.dispose();
});
