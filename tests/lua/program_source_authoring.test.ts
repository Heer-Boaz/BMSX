import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';
import { actionStringScenarioSource } from '../../ide/workbench/contrib/scenario_lab/actionstring';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { semanticSnapshot } from './semantic_test_harness';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramProperty } from '../../ide/workbench/contrib/lua_program/source';
import { createWorkbenchPropertyTree } from '../../ide/workbench/ui/property_tree';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldInsertionEdits, validateLuaTableFieldExpression } from '../../ide/language/lua/table_field_insertion';
import { createLuaTableFieldRemovalEdits } from '../../ide/language/lua/source_edits';
import { newLuaSource } from '../../ide/workbench/contrib/resources/create/source_templates';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';

function project(source: string, imports: readonly { path: string; source: string }[] = []) {
	const file = buildLuaFileSemanticData(source, 'entry.lua');
	const snapshot = semanticSnapshot(file, ...imports.map(item => buildLuaFileSemanticData(item.source, item.path)));
	const models = new Map(snapshot.files.map(file => [file.file, new EditorTextModel({ domain: 0, path: file.file, source: { resid: file.file, type: 'lua' } }, 'lua', file.source)]));
	const occurrence = collectLuaPrograms({ domain: 0, path: file.file }, snapshot)[0];
	const tree = createWorkbenchPropertyTree<LuaProgramProperty>();
	if (occurrence !== undefined) projectLuaProgram(tree, occurrence, new LuaSourceReader(snapshot), file => models.get(file.file)!);
	return { occurrence, snapshot, tree, models };
}

test('program source recognition resolves cartlib imports and reexports rather than same-named functions', () => {
	const f = project("local compile = require('bridge'); local fake = { compile_program = function() end }; compile({rules={},filters={},handlers={}}); fake.compile_program({})", [{ path: 'bridge.lua', source: "return require('cartlib/progression').compile_program" }]);
	assert.equal(collectLuaPrograms({ domain: 0, path: 'entry.lua' }, f.snapshot).length, 1);
	assert.equal(f.occurrence.kind, 'progression');
	assert.equal(f.tree.rows.length, 4);
});

test('imported authored tables stay attached to their original shared models', () => {
	const f = project("local p = require('cartlib/progression'); local spec = require('spec'); p.compile_program(spec)", [{ path: 'spec.lua', source: "return { rules = { {id='r', on='hit', set={{key='done',value=true}}} }, filters={}, handlers={} }" }]);
	const property = f.tree.rows.find(row => row.element.key === 'root/rules/[1]/on')!.element;
	assert.equal(property.file.file, 'spec.lua');
	assert.ok(property.container!.structural);
	const model = f.models.get('spec.lua')!, before = model.buffer.getText();
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, property.file.chunk, property.container!.table, property.container!.table.fields.length, 'apply_once = true'));
	assert.ok(model.buffer.getText().includes('apply_once = true'));
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
	const entry = f.tree.rows.find(row => row.element.key === 'root/rules/[1]')!.element;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, entry.file.chunk.locations, entry.file.chunk.tokens, entry.field!));
	assert.equal(buildLuaFileSemanticData(model.buffer.getText(), 'spec.lua').syntaxError, null);
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
});

test('mutated and dynamically constructed programs are not reconstructed into editable defaults', () => {
	const dynamic = project("local p=require('cartlib/progression'); p.compile_program(build_spec())");
	assert.equal(dynamic.tree.roots[0].element.table, undefined);
	const mutated = project("local p=require('cartlib/progression'); local rules={}; rules[1] = make_rule(); p.compile_program({rules=rules,filters={},handlers={}})");
	const rules = mutated.tree.rows.find(row => row.element.key === 'root/rules')!.element;
	assert.equal(rules.table!.structural, false);
});

test('input actionstrings resolve written constants and preserve the original expression for edits', () => {
	const f = project("local c=require('cartlib/input/actioneffect/actioneffect_component'); local pattern='a[jp]'; c.factory({program={bindings={{on={press=pattern},go={press={['emit.event']='hit'}}}}}})");
	const press = f.tree.rows.find(row => row.element.key === 'root/bindings/[1]/on/press')!.element;
	assert.equal(press.expression.kind, LuaSyntaxKind.IdentifierExpression);
	assert.equal(press.valueExpression!.kind, LuaSyntaxKind.StringLiteralExpression);
	assert.equal(press.table, undefined);
});

test('human Lua fragments cannot consume untouched field punctuation', () => {
	assert.equal(validateLuaTableFieldExpression("function(owner) owner.count = owner.count + 1 end"), "function(owner) owner.count = owner.count + 1 end");
	assert.throws(() => validateLuaTableFieldExpression('5 -- dangling comment'));
	assert.throws(() => validateLuaTableFieldExpression('5; other = 6'));
});

test('new modules are canonical source recognized by their actual editors', () => {
	for (const kind of ['progression', 'input'] as const) {
		const source = newLuaSource(kind, 'program.lua');
		assert.equal(project(source).occurrence.kind, kind);
	}
	const effect = newLuaSource('action_effect', 'effects/chime.lua');
	const file = buildLuaFileSemanticData(effect, 'effects/chime.lua');
	const definition = buildBehaviorSourceDocument({domain: 0, path: file.file}, semanticSnapshot(file)).definitions[0];
	assert.equal(definition.behaviorKind, 'action_effect');
});

test('new module and input-experiment source passes the normal cart lint', async () => {
	for (const kind of ['action_effect', 'progression', 'input'] as const) {
		await lintCartSources({sources: [{path: `carts/example/${kind}.lua`, text: newLuaSource(kind, `${kind}.lua`)}]});
	}
	await lintCartSources({sources: [{path: 'carts/example/tests/actionstring_assert.lua',
		text: actionStringScenarioSource('a[jp]', "{player=1,clock=clock.frame,steps={{key='KeyX',down=true,expect=true,max_ticks=30}}}")}]});
});
