import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';
import { actionStringScenarioSource } from '../../ide/workbench/contrib/scenario_lab/actionstring';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { semanticSnapshot } from './semantic_test_harness';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramProperty } from '../../ide/workbench/contrib/lua_program/source';
import { createWorkbenchPropertyTree } from '../../ide/workbench/ui/property_tree';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldInsertionEdits, formatLuaTableFieldSource, validateLuaTableFieldExpression } from '../../ide/language/lua/table_field_insertion';
import { createLuaTableFieldRemovalEdits } from '../../ide/language/lua/source_edits';
import { newLuaSource } from '../../ide/workbench/contrib/resources/create/source_templates';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { programEntryTemplate, programFieldTemplates } from '../../ide/workbench/contrib/lua_program/schema';

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
	const property = f.tree.rows.find(row => row.element.key === '["rules",1,"on"]')!.element;
	assert.equal(property.file.file, 'spec.lua');
	assert.ok(property.container!.structural);
	const model = f.models.get('spec.lua')!, before = model.buffer.getText();
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, property.file.chunk, property.container!.table, property.container!.table.fields.length, 'apply_once = true'));
	assert.ok(model.buffer.getText().includes('apply_once = true'));
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
	const entry = f.tree.rows.find(row => row.element.key === '["rules",1]')!.element;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, entry.file.chunk.locations, entry.file.chunk.tokens, entry.field!));
	assert.equal(buildLuaFileSemanticData(model.buffer.getText(), 'spec.lua').syntaxError, null);
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
});

test('mutated and dynamically constructed programs are not reconstructed into editable defaults', () => {
	const dynamic = project("local p=require('cartlib/progression'); p.compile_program(build_spec())");
	assert.equal(dynamic.tree.roots[0].element.table, undefined);
	const mutated = project("local p=require('cartlib/progression'); local rules={}; rules[1] = make_rule(); p.compile_program({rules=rules,filters={},handlers={}})");
	const rules = mutated.tree.rows.find(row => row.element.key === '["rules"]')!.element;
	assert.equal(rules.table!.structural, false);
});

test('input actionstrings resolve written constants and preserve the original expression for edits', () => {
	const f = project("local c=require('cartlib/input/actioneffect/actioneffect_component'); local pattern='a[jp]'; c.factory({program={bindings={{on={press=pattern},go={press={['emit.event']='hit'}}}}}})");
	const press = f.tree.rows.find(row => row.element.key === '["bindings",1,"on","press"]')!.element;
	assert.equal(press.expression.kind, LuaSyntaxKind.IdentifierExpression);
	assert.equal(press.valueExpression!.kind, LuaSyntaxKind.StringLiteralExpression);
	assert.equal(press.table, undefined);
});

test('input component records never become invented programs and later program keys win', () => {
	for (const definition of ['{clock_source=1}', '{program=build_program()}', '{program={bindings={}},[get_key()]=build_program()}', '{program={bindings={}}}; opts.program=build_program()']) {
		const f = project(`local c=require('cartlib/input/actioneffect/actioneffect_component'); local opts=${definition}; c.factory(opts)`);
		assert.equal(f.tree.rows.length, 1);
		assert.equal(f.tree.roots[0].element.table, undefined);
		assert.equal(f.tree.roots[0].element.warning, true);
	}
	const f = project("local c=require('cartlib/input/actioneffect/actioneffect_component'); c.factory({program={ignored=true},program={bindings={}}})");
	assert.equal(f.tree.rows.length, 2);
	assert.deepEqual(f.tree.rows[1].element.path, ['bindings']);
});

test('written property identities distinguish literal slash names, array entries and effective duplicate keys', () => {
	const f = project("local p=require('cartlib/progression'); p.compile_program({rules={},filters={{}},handlers={},['when_all']={},when_all={},['rules/[1]/on']={shadow=1},extra={['[1]']='named','entry'}})");
	assert.equal(new Set(f.tree.rows.map(row => row.element.key)).size, f.tree.rows.length);
	assert.equal(f.tree.rows.filter(row => row.element.path.length === 1 && row.element.path[0] === 'when_all').length, 1);
	const unrelated = f.tree.rows.find(row => row.element.path[0] === 'rules/[1]/on')!.element;
	assert.deepEqual(programFieldTemplates('progression', unrelated), []);
	assert.equal(programEntryTemplate('progression', unrelated), undefined);
});

test('filter condition authoring adds a real condition entry rather than a map property', () => {
	const f = project(`local p=require('cartlib/progression')
local program, filters = p.compile_program({rules={},filters={{}},handlers={}})
p.mount('context', program)
assert(not p.matches('context', filters[1]))
p.set('context', 'flag', true)
assert(p.matches('context', filters[1]))`);
	const property = f.tree.rows.find(row => row.element.path.length === 2 && row.element.path[0] === 'filters')!.element;
	const target = property.table!, model = f.models.get(target.file.file)!;
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, target.file.chunk, target.table, 0, programEntryTemplate('progression', property)!));
	const next = project(model.buffer.getText());
	const condition = next.tree.rows.find(row => row.element.path.length === 3 && row.element.path[0] === 'filters')!.element;
	const names = new Set(programFieldTemplates('progression', condition).map(item => item.name));
	assert.ok(names.has('key') && names.has('equals'));
	assert.equal(condition.table!.table.fields.length, 2);
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(model.buffer.getText(), { optLevel, modules:
			['cartlib/progression', 'cartlib/event_matcher', 'cartlib/event_matcher_syntax']
				.map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })) });
		assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
	}
});

test('human Lua fragments cannot consume untouched field punctuation', () => {
	assert.equal(validateLuaTableFieldExpression("function(owner) owner.count = owner.count + 1 end"), "function(owner) owner.count = owner.count + 1 end");
	assert.throws(() => validateLuaTableFieldExpression('5 -- dangling comment'));
	assert.throws(() => validateLuaTableFieldExpression('5; other = 6'));
});

test('named field insertion preserves keyword and arbitrary string keys through the Lua grammar', () => {
	for (const name of ['not', 'mode', 'effect.trigger', "quote'key"]) {
		const f = project("local p=require('cartlib/progression'); p.compile_program({rules={},filters={},handlers={}})");
		const root = f.tree.roots[0].element.table!, model = f.models.get(root.file.file)!;
		model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, root.file.chunk, root.table,
			root.table.fields.length, formatLuaTableFieldSource(name, 'true')));
		const next = project(model.buffer.getText());
		assert.equal(next.occurrence.file.syntaxError, null);
		const field = next.tree.rows.find(row => row.element.path.length === 1 && row.element.path[0] === name)!.element;
		assert.equal(field.valueExpression!.kind, LuaSyntaxKind.BooleanLiteralExpression);
	}
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
