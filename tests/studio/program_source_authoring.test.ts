import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';
import { actionStringScenarioSource } from '../../ide/workbench/contrib/scenario_lab/actionstring';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind, LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { resourceIdentityKey } from '../../ide/common/resource';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramProperty } from '../../ide/workbench/contrib/lua_program/source';
import { createWorkbenchPropertyTree } from '../../ide/workbench/ui/property_tree';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldsInsertionEdits, formatLuaTableFieldSource, validateLuaTableFieldExpression } from '../../ide/language/lua/table_field_insertion';
import { createLuaTableFieldRemovalEdits, readLuaExpressionPreview, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { parseLuaFieldValueEdit } from '../../ide/language/lua/field_value_edit';
import { newLuaSource } from '../../ide/workbench/contrib/resources/create/source_templates';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { programEntryTemplate, programFieldTemplates } from '../../ide/workbench/contrib/lua_program/schema';
import { LuaProgramSourceSelection } from '../../ide/workbench/contrib/lua_program/source_selection';

function project(source: string, imports: readonly { path: string; source: string }[] = []) {
	const file = buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua' });
	const files = [file, ...imports.map(item => buildResourceLuaSemanticFixtureFile(item.source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: item.path }))];
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture(files,
		['cartlib/progression', 'cartlib/input/actioneffect/actioneffect_component', 'cartlib/actioneffects']));
	const models = new Map(files.map(file => [file.file, new EditorTextModel({ contextLabel: 'fixture-source', sourceFilePath: file.resource.path,
		location: { kind: 'workspace' as const, path: file.resource.path }, ...file.resource,
		source: { resid: file.resource.path, type: 'lua' } }, 'lua', file.source)]));
	const occurrence = collectLuaPrograms(file.resource, snapshot)[0];
	const tree = createWorkbenchPropertyTree<LuaProgramProperty>();
	if (occurrence !== undefined) projectLuaProgram(tree, occurrence, new LuaSourceReader(snapshot), file => models.get(file.file)!, models, new LuaProgramSourceSelection(), () => true);
	return { occurrence, snapshot, tree, models };
}

test('program source recognition resolves cartlib imports and reexports rather than same-named functions', () => {
	const f = project("local compile = require('bridge'); local fake = { compile_program = function() end }; compile({rules={},filters={},handlers={}}); fake.compile_program({})", [{ path: 'bridge.lua', source: "return require('cartlib/progression').compile_program" }]);
	assert.equal(collectLuaPrograms({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua' }, f.snapshot).length, 1);
	assert.equal(f.occurrence.kind, 'progression');
	assert.equal(f.tree.rows.length, 4);
});

test('program property values display proved decoded strings while retaining exact authored expressions', () => {
	const values = [
		["'ready'", 'ready'],
		['"say \\"Hi\\""', 'say "Hi"'],
		["[=[O'Brien`Fx]=]", "O'Brien`Fx"],
		["''", ''],
		['alias', 'aliased'],
		['names.event', 'hit`event'],
		['prefix .. names.event', '/hit`event'],
		["'part' .. '-' .. 'suffix'", 'part-suffix'],
	] as const;
	const source = `local p=require('cartlib/progression')
local names=require('names')
local alias='aliased'
local prefix='/'
p.compile_program({rules={${values.map(([expression]) => `{id=${expression}}`).join(',')}},filters={},handlers={}})`;
	const f = project(source, [{ path: 'names.lua', source: "return { event = 'hit`event' }" }]);
	assert.equal(f.occurrence.file.syntaxError, null);
	for (let index = 0; index < values.length; index++) {
		const [expression, value] = values[index];
		const property = f.tree.rows.find(row => row.element.key === JSON.stringify(['rules', index + 1, 'id']))!.element;
		const model = f.models.get(property.file.file)!;
		// Exact value content is the projection's data contract, including empty strings and embedded punctuation.
		assert.equal(property.value, value);
		assert.equal(property.expression, property.field!.value, 'display does not replace the authored AST with a synthesized literal');
		assert.equal(readLuaSourceRange(model.buffer, property.file.chunk.locations.range(property.expression.span)), expression);
		assert.equal(readLuaExpressionPreview(model.buffer, property.file.chunk.locations, property.expression), expression,
			'source-expression preview remains a source representation');
	}
	assert.equal(f.models.get(f.occurrence.file.file)!.buffer.getText(), source);
});

test('program properties keep unknown and non-string expressions as their original source previews', () => {
	const expressions = ["external or 'fallback'", "make_id('shown')", 'names.unknown', "'/' .. 3", '17', 'false'];
	const f = project(`local p=require('cartlib/progression'); local names=require('names');
p.compile_program({rules={${expressions.map(expression => `{id=${expression}}`).join(',')}},filters={},handlers={}})`,
	[{ path: 'names.lua', source: 'return external' }]);
	for (let index = 0; index < expressions.length; index++) {
		const property = f.tree.rows.find(row => row.element.key === JSON.stringify(['rules', index + 1, 'id']))!.element;
		assert.equal(property.value, expressions[index], 'unproved expressions keep their source punctuation, not a guessed semantic value');
	}
});

test('imported authored tables stay attached to their original shared models', () => {
	const f = project("local p = require('cartlib/progression'); local spec = require('spec'); p.compile_program(spec)", [{ path: 'spec.lua', source: "return { rules = { {id='r', on='hit', set={{key='done',value=true}}} }, filters={}, handlers={} }" }]);
	const property = f.tree.rows.find(row => row.element.key === '["rules",1,"on"]')!.element;
	assert.equal(property.file.file, resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'spec.lua' }));
	assert.ok(property.container!.structural);
	const model = f.models.get(resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'spec.lua' }))!, before = model.buffer.getText();
	model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, property.file.chunk, property.container!.table, property.container!.table.fields.length, ['apply_once = true']));
	assert.ok(model.buffer.getText().includes('apply_once = true'));
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
	const entry = f.tree.rows.find(row => row.element.key === '["rules",1]')!.element;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, entry.file.chunk.locations, entry.file.chunk.tokens, entry.field!));
	assert.equal(buildResourceLuaSemanticFixtureFile(model.buffer.getText(), model.resource).syntaxError, null);
	model.history.undo(model);
	assert.equal(model.buffer.getText(), before);
});

test('member-backed input programs retain their exact authored provider through exports and aliases', () => {
	const program = "{bindings={{on={press='a[jp]'},go={press={['emit.event']='hit'}}}}}";
	for (const [provider, member] of [
		[`return { input = ${program} }`, 'input'],
		[`return { input = { ignored = true }, input = ${program} }`, 'input'],
		[`local definitions = {}; definitions.input = ${program}; return definitions`, 'input'],
		[`local definitions = {}; local alias = definitions; alias.input = ${program}; return definitions`, 'input'],
		[`local definitions = { settings = { input = ${program} } }; return definitions`, 'settings.input'],
		[`local definitions = { settings = {} }; definitions.settings.input = ${program}; return definitions`, 'settings.input'],
	] as const) {
		const consumer = `local component = require('cartlib/input/actioneffect/actioneffect_component')
local definitions = require('definitions')
component.factory({program = definitions.${member}})`;
		const f = project(consumer, [{ path: 'definitions.lua', source: provider }]);
		const root = f.tree.roots[0].element, press = f.tree.rows.find(row => row.element.key === '["bindings",1,"on","press"]')!.element;
		const owner = f.models.get(resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definitions.lua' }))!;
		const address = resourceIdentityKey(owner.identity);
		assert.equal(root.table!.file.file, address);
		assert.equal(root.table!.structural, true);
		assert.equal(press.file.file, address);
		assert.equal(press.valueExpression!.kind, LuaSyntaxKind.StringLiteralExpression);
		const before = owner.buffer.getText(), table = root.table!;
		owner.pushEditOperations(createLuaTableFieldsInsertionEdits(owner.buffer, table.file.chunk, table.table, table.table.fields.length, ["eval = 'first'"]));
		const edited = project(consumer, [{ path: 'definitions.lua', source: owner.buffer.getText() }]);
		assert.ok(edited.tree.rows.some(row => row.element.path.length === 1 && row.element.path[0] === 'eval'));
		assert.equal(f.models.get(f.occurrence.file.file)!.buffer.getText(), consumer, 'editing the provider must not replace its consumer expression');
		owner.history.undo(owner);
		assert.equal(owner.buffer.getText(), before);
	}
});

test('input construction projects its admitted definition argument, not unrelated gameplay owner fields', () => {
	const source = `local input = require('cartlib/input/actioneffect/actioneffect_component')
local actor = {program = external}
input.new(actor, {program = {bindings = {{on = {press = 'a[jp]'}, go = {press = {['emit.event'] = 'hit'}}}}}})`;
	const f = project(source);
	assert.equal(f.occurrence.kind, 'input');
	assert.ok(f.tree.rows.some(row => row.element.key === '["bindings",1,"on","press"]'));
	assert.equal(f.tree.rows.some(row => row.element.path[0] === 'program'), false);
});

test('known member candidates never erase competing writes, dynamic storage or unknown base lanes', () => {
	for (const provider of [
		"local definitions={input={bindings={}}}; definitions.input=external; return definitions",
		"local definitions={input={bindings={}}}; definitions[key]=external; return definitions",
		"local definitions={input={bindings={}}}; local alias=external or definitions; alias.input={bindings={}}; return definitions",
		"local definitions=external or {input={bindings={}}}; return definitions",
		"local definitions={}; local shared={bindings={}}; definitions.input=shared; definitions.input=shared; return definitions",
		"local definitions={}; definitions.input=definitions.input; return definitions",
	]) {
		const f = project("local component=require('cartlib/input/actioneffect/actioneffect_component'); local definitions=require('definitions'); component.factory({program=definitions.input})",
			[{ path: 'definitions.lua', source: provider }]);
		assert.equal(f.tree.roots[0].element.table, undefined);
		assert.equal(f.tree.roots[0].element.warning, true);
	}
});

test('member-backed program descendant writes retain the written tables without granting structural editing', () => {
	const f = project("local component=require('cartlib/input/actioneffect/actioneffect_component'); local definitions=require('definitions'); component.factory({program=definitions.input})", [
		{ path: 'definitions.lua', source: 'local definitions={input={bindings={}}}; definitions.input.bindings[1]=external; return definitions' },
	]);
	assert.equal(f.tree.roots[0].element.table!.structural, false);
	const bindings = f.tree.rows.find(row => row.element.key === '["bindings"]')!.element;
	assert.equal(bindings.table!.structural, false);
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
	assert.equal(press.value, 'a[jp]');
	assert.equal(press.table, undefined);
	const model = f.models.get(press.file.file)!, before = model.buffer.getText();
	assert.equal(readLuaSourceRange(model.buffer, press.file.chunk.locations.range(press.field!.value.span)), 'pattern');
	const edit = parseLuaFieldValueEdit(model.buffer, press.file.chunk.locations, press.field!, "'b[jp]'");
	assert.ok('value' in edit);
	model.pushEditOperations([edit.value.edit]);
	assert.ok(model.buffer.getText().includes("local pattern='a[jp]'"), 'editing the displayed value cannot overwrite its aliased provider');
	assert.ok(model.buffer.getText().includes("on={press='b[jp]'}"));
	model.history.undo(model); assert.equal(model.buffer.getText(), before);
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

for (const kind of ['progression', 'input'] as const) {
	const collection = kind === 'progression' ? 'rules' : 'bindings';
	const source = (fields: string) => kind === 'progression'
		? `local p=require('cartlib/progression'); p.compile_program({rules={${fields}},filters={},handlers={}})`
		: `local p=require('cartlib/input/actioneffect/actioneffect_component'); p.factory({program={bindings={${fields}}}})`;

	test(`${kind} mixed constructor paths count only implicit array fields`, () => {
		const f = project(source("metadata='x',{id='first'},['note']='y',{id='second'},[9]={id='numeric'},[lookup]={id='computed'},{id='third'}"));
		const entries = f.tree.rows.filter(row => row.element.path.length === 2 && row.element.field?.kind === LuaTableFieldKind.Array);
		assert.deepEqual(entries.map(row => row.element.path), [[collection, 1], [collection, 2], [collection, 3]]);
		for (let index = 0; index < entries.length; index++) {
			assert.equal(entries[index].element.field, entries[index].parent!.element.table!.table.fields[[1, 3, 6][index]]);
		}
		assert.deepEqual(f.tree.rows.find(row => row.element.field?.kind === LuaTableFieldKind.ExpressionKey
			&& row.element.field.key.kind === LuaSyntaxKind.StringLiteralExpression)!.element.path, [collection, 'note']);
		const expressionEntries = f.tree.rows.filter(row => row.element.path.length === 2
			&& row.element.field?.kind === LuaTableFieldKind.ExpressionKey && row.element.field.key.kind !== LuaSyntaxKind.StringLiteralExpression);
		assert.deepEqual(expressionEntries.map(row => row.element.path), [
			[collection, { kind: 'expression-key', fieldIndex: 4 }], [collection, { kind: 'expression-key', fieldIndex: 5 }],
		]);
		assert.equal(new Set(f.tree.rows.map(row => row.element.key)).size, f.tree.rows.length);
	});

	test(`${kind} expression-key collapse belongs to its written occurrence, not the next implicit entry`, () => {
		const f = project(source("[7]={id='numeric'},{id='first'},[lookup]={id='computed'},{id='second'}"));
		const list = f.tree.roots[0].children.find(row => row.element.path[0] === collection)!;
		list.children[0].collapsed = true;
		list.children[3].collapsed = true;
		projectLuaProgram(f.tree, f.occurrence, new LuaSourceReader(f.snapshot), file => f.models.get(file.file)!,
			f.models, new LuaProgramSourceSelection(), () => true);
		const next = f.tree.roots[0].children.find(row => row.element.path[0] === collection)!;
		assert.equal(new Set(next.children.map(row => row.element.key)).size, 4);
		assert.deepEqual(next.children.map(row => row.collapsed), [true, false, false, true]);
		assert.deepEqual(next.children[1].element.path, [collection, 1]);
		assert.deepEqual(next.children[3].element.path, [collection, 2]);
	});

	test(`${kind} expression-key ancestry cannot grant named cartlib schema authoring`, () => {
		const f = project(source("[lookup]={on={},go={},when={},when_all={{}},set={{}},on={custom={{}},combo={steps={}}}}"));
		const computed = f.tree.roots[0].children.find(row => row.element.path[0] === collection)!.children[0];
		const visit = (node: typeof computed) => {
			assert.deepEqual(programFieldTemplates(kind, node.element), []);
			assert.equal(programEntryTemplate(kind, node.element), undefined);
			for (const child of node.children) visit(child);
		};
		visit(computed);
	});
}

test('filter condition authoring adds a real condition entry rather than a map property', () => {
	const f = project(`local p=require('cartlib/progression')
local program, filters = p.compile_program({rules={},filters={{}},handlers={}})
p.mount('context', program)
assert(not p.matches('context', filters[1]))
p.set('context', 'flag', true)
assert(p.matches('context', filters[1]))`);
	const property = f.tree.rows.find(row => row.element.path.length === 2 && row.element.path[0] === 'filters')!.element;
	const target = property.table!, model = f.models.get(target.file.file)!;
	model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, target.file.chunk, target.table, 0, [programEntryTemplate('progression', property)!]));
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
		model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, root.file.chunk, root.table,
			root.table.fields.length, [formatLuaTableFieldSource(name, 'true')]));
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
	const file = buildResourceLuaSemanticFixtureFile(effect, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'effects/chime.lua' });
	const definition = buildBehaviorSourceDocument(file.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file], ['cartlib/actioneffects']))).definitions[0];
	assert.equal(definition.behaviorKind, 'action_effect');
});

test('new module and input-experiment source passes the normal cart lint', async () => {
	for (const kind of ['action_effect', 'progression', 'input'] as const) {
		await lintCartSources({sources: [{path: `carts/example/${kind}.lua`, text: newLuaSource(kind, `${kind}.lua`)}]});
	}
	await lintCartSources({sources: [{path: 'carts/example/tests/actionstring_assert.lua',
		text: actionStringScenarioSource('a[jp]', "{player=1,clock=clock.frame,steps={{key='KeyX',down=true,expect=true,max_ticks=30}}}")}]});
});
