import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { LuaProgramEditorPane } from '../../ide/workbench/contrib/lua_program/editor_pane';
import type { LuaProgramKind } from '../../ide/workbench/contrib/lua_program/source';
import type { EditorCommandId } from '../../ide/common/commands';
import { createActualSourcePanes } from '../helpers/source_panes';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../ide/language/lua/field_value_edit';

const PROGRAM = "local p=require('cartlib/progression'); p.compile_program({rules={{id='first',on='hit'},{id='second',on='land'}},filters={},handlers={}})";
const INPUT = "local p=require('cartlib/input/actioneffect/actioneffect_component'); p.factory({program={bindings={{on={press='a[jp]'},go={}}}}})";

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext, source = PROGRAM, kind: LuaProgramKind = 'progression', imports: readonly (readonly [string, string])[] = [],
	selection: readonly (string | number)[] = kind === 'input' ? ['bindings', 1, 'on', 'press'] : ['rules', 1, 'id']) {
	const f = createActualSourcePanes(t, false, [['program.lua', source], ['cartlib/progression.lua', ''],
		['cartlib/input/actioneffect/actioneffect_component.lua', ''], ...imports]);
	let contextId = f.sources.systemContextId;
	if (kind === 'input') {
		const system = f.sources.catalog.getContext(contextId);
		contextId = f.sources.catalog.admitContext({ ...system, admission: { id: 'program-input-fixture', projectRoot: '' },
			programDomain: 'cart', systemContextId: system.id }).id;
	}
	const resource = f.sources.catalog.resolveResource({ contextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(f.firstGroup, resource, kind); f.update();
	const input = f.firstGroup.model.activeTab!, pane = f.firstGroup.panes.activePane!;
	assert.ok(input.kind === 'lua_program' && pane instanceof LuaProgramEditorPane);
	f.firstGroup.model.pin(input);
	const select = (path: readonly (string | number)[]) => {
		f.editor.luaPrograms.refresh(input);
		input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === JSON.stringify(path));
		assert.ok(input.tree.selectionIndex >= 0);
		input.sourceSelection.select(input.tree.rows[input.tree.selectionIndex], input.sourceModels);
	};
	select(selection); pane.focus();
	const target = pane.commandTarget;
	const execute = (command: EditorCommandId, application: boolean) => {
		if (application) f.editor.commands.execute(command, target); else inputFocus.executeCommand(command, target);
	};
	const draft = (text: string) => {
		inputFocus.executeCommand('luaProgram.edit', target);
		const field = f.editor.textTarget, focused = inputFocus.target;
		assert.ok(field !== undefined && focused?.edit !== undefined && focused !== target);
		assert.equal(field.replaceText(0, field.readText().text.length, text), true);
		return focused;
	};
	return { ...f, input, pane, target, select, execute, draft, model: input.workingCopy };
}

for (const application of [false, true]) for (const valid of [false, true])
	test(`Lua Program ${application ? 'application' : 'native'} Remove accepts only a valid owning draft (${valid})`, t => {
		const f = fixture(t), draft = f.draft(valid ? "'accepted'" : '(');
		f.execute('luaProgram.remove', application);
		assert.equal(draft.edit!.pending, !valid);
		assert.equal(f.model.buffer.getText(), valid ? PROGRAM.replace("id='first',", '') : PROGRAM);
		if (valid) assert.equal(f.input.tree.selectionIndex, -1);
	});

for (const application of [false, true]) for (const valid of [false, true])
	for (const command of ['luaProgram.edit', 'luaProgram.add'] as const)
		test(`${command} ${application ? 'application' : 'native'} is presentation with ordinary ${valid ? 'valid' : 'invalid'} blur`, t => {
			const f = fixture(t);
			let draft;
			if (command === 'luaProgram.add') {
				const property = f.input.sourceSelection.property!, locations = property.file.chunk.locations;
				f.select(['rules']);
				const control = new ValueInput<LuaFieldValueEdit>(f.target, { options: { singleLine: true, allowSpace: true },
					format: value => value.edit.text, invalidBlurMessage: 'Invalid draft cancelled.',
					parse: text => parseLuaFieldValueEdit(f.model.buffer, locations, property.field!, text),
				}, value => f.model.pushEditOperations([value.edit]));
				const initial = parseLuaFieldValueEdit(f.model.buffer, locations, property.field!, "'first'");
				assert.ok('value' in initial);
				control.setValue(initial.value); control.layout(f.firstBounds); control.field.focusTarget.focus();
				control.field.replaceText(0, control.field.text.length, valid ? "'accepted'" : '(');
				draft = control.field.focusTarget;
				t.after(() => { control.cancel(); control.field.focusTarget.release(); control.dispose(); });
			} else draft = f.draft(valid ? "'accepted'" : '(');
			f.execute(command, application);
			assert.equal(draft.edit!.pending, false);
			assert.equal(f.model.buffer.getText(), valid ? PROGRAM.replace("id='first'", "id='accepted'") : PROGRAM);
			if (command === 'luaProgram.add') assert.equal(f.firstPart.quickInput.visible, true);
			else {
				assert.notEqual(inputFocus.target, f.target);
				assert.equal(f.editor.textTarget!.readText().text, valid ? "'accepted'" : "'first'");
			}
		});

for (const application of [false, true]) for (const valid of [false, true])
	test(`Lua Program ${application ? 'application' : 'native'} Test Input seeds its prompt after ordinary ${valid ? 'valid' : 'invalid'} blur`, t => {
		const f = fixture(t, INPUT, 'input'), draft = f.draft(valid ? "'b[jp]'" : '(');
		f.execute('luaProgram.testInput', application);
		assert.equal(draft.edit!.pending, false);
		assert.equal(f.model.buffer.getText(), valid ? INPUT.replace("'a[jp]'", "'b[jp]'") : INPUT);
		assert.equal(f.firstPart.quickInput.visible, true);
		assert.equal(f.firstPart.quickInput.field.text, valid ? 'b[jp]' : 'a[jp]');
	});

for (const application of [false, true])
	test(`Lua Program ${application ? 'application' : 'native'} capture cannot revive explicit A to B to A intent during draft acceptance`, t => {
		const f = fixture(t); f.draft("'accepted'");
		let fired = false;
		t.after(f.model.onDidChangeContent(() => {
			if (fired) return; fired = true;
			f.select(['rules', 2, 'id']); f.select(['rules', 1, 'id']);
		}));
		f.execute('luaProgram.remove', application);
		assert.equal(fired, true);
		assert.equal(f.model.buffer.getText(), PROGRAM.replace("id='first'", "id='accepted'"));
	});

for (const application of [false, true])
	test(`Lua Program ${application ? 'application' : 'native'} source capture expires on same-input reattachment`, t => {
		const f = fixture(t); f.draft("'accepted'");
		let fired = false;
		t.after(f.model.onDidChangeContent(() => {
			if (fired) return; fired = true;
			f.firstGroup.openEditor(f.firstInput); f.firstGroup.activate(f.input.id);
		}));
		f.execute('luaProgram.remove', application);
		assert.equal(fired, true);
		assert.equal(f.model.buffer.getText(), PROGRAM.replace("id='first'", "id='accepted'"));
	});

test('Lua Program correspondence follows the authored array occurrence across insertion, not its old numbered path', t => {
	const f = fixture(t); f.select(['rules', 2, 'id']);
	const revision = f.input.sourceSelection.revision;
	const offset = f.model.buffer.getText().indexOf("{id='first'");
	f.model.pushEditOperations([{ offset, deleteLength: 0, text: "{id='inserted',on='new'}," }]);
	f.editor.luaPrograms.refresh(f.input);
	assert.equal(f.input.sourceSelection.revision, revision);
	assert.deepEqual(f.input.sourceSelection.property!.path, ['rules', 3, 'id']);
	assert.equal(f.input.sourceSelection.property!.value, 'second');
	inputFocus.executeCommand('luaProgram.remove', f.target);
	assert.ok(f.model.buffer.getText().includes("{id='first',on='hit'}"));
	assert.ok(f.model.buffer.getText().includes("{id='inserted',on='new'}"));
	assert.ok(f.model.buffer.getText().includes("{on='land'}"));
});

for (const kind of ['progression', 'input'] as const)
	test(`${kind} named metadata insertion preserves the selected array subject and exact source edit through Undo`, t => {
		const source = kind === 'progression' ? PROGRAM
			: "local p=require('cartlib/input/actioneffect/actioneffect_component'); p.factory({program={bindings={{on={press='a[jp]'},go={}},{on={press='b[jp]'},go={}}}}})";
		const collection = kind === 'progression' ? 'rules' : 'bindings';
		const selected = kind === 'progression' ? ['rules', 2, 'id'] : ['bindings', 2, 'on', 'press'];
		const f = fixture(t, source, kind, [], selected), revision = f.input.sourceSelection.revision;
		const offset = source.indexOf(`${collection}={`) + collection.length + 2;
		f.model.pushEditOperations([{ offset, deleteLength: 0, text: "metadata='retained'," }]);
		f.editor.luaPrograms.refresh(f.input);
		assert.equal(f.input.sourceSelection.revision, revision);
		assert.deepEqual(f.input.sourceSelection.property!.path, selected);
		const property = f.input.sourceSelection.property!;
		const edit = parseLuaFieldValueEdit(f.model.buffer, property.file.chunk.locations, property.field!, "'edited'");
		assert.ok('value' in edit);
		f.model.pushEditOperations([edit.value.edit]);
		const withMetadata = source.slice(0, offset) + "metadata='retained'," + source.slice(offset);
		assert.equal(f.model.buffer.getText(), withMetadata.replace(kind === 'progression' ? "id='second'" : "press='b[jp]'",
			kind === 'progression' ? "id='edited'" : "press='edited'"));
		f.model.history.undo(f.model);
		f.editor.luaPrograms.refresh(f.input);
		assert.equal(f.model.buffer.getText(), withMetadata);
		assert.deepEqual(f.input.sourceSelection.property!.path, selected);
		f.model.history.undo(f.model);
		f.editor.luaPrograms.refresh(f.input);
		assert.equal(f.model.buffer.getText(), source);
		assert.deepEqual(f.input.sourceSelection.property!.path, selected);
	});

test('Lua Program removed effective duplicate fields do not select the newly exposed same-named occurrence', t => {
	const source = PROGRAM.replace("id='first'", "id='shadowed',id='first'");
	const f = fixture(t, source), property = f.input.sourceSelection.property!;
	const start = f.model.buffer.offsetAt(property.file.chunk.locations.range(property.field!.span).start.line - 1,
		property.file.chunk.locations.range(property.field!.span).start.column - 1);
	f.model.pushEditOperations([{ offset: start, deleteLength: "id='first',".length, text: '' }]);
	f.editor.luaPrograms.refresh(f.input);
	assert.equal(f.input.sourceSelection.property, undefined);
	assert.equal(f.input.tree.selectionIndex, -1);
	assert.ok(f.input.tree.rows.some(row => row.element.value === 'shadowed'));
});

for (const application of [false, true])
	test(`Lua Program ${application ? 'application' : 'native'} Add maps its table after prompt edits and writes only on acceptance`, async t => {
		const f = fixture(t); f.select(['rules']);
		f.execute('luaProgram.add', application);
		assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.model.buffer.getText(), PROGRAM);
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- independent source edit\n' }]);
		f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, "{id='added',on='new'}");
		await f.firstPart.quickInput.accept(); f.update();
		assert.equal(f.firstPart.quickInput.visible, false);
		const ids = f.input.tree.rows.filter(row => row.element.path.length === 3 && row.element.path[2] === 'id').map(row => row.element.value);
		assert.deepEqual(ids, ['first', 'second', 'added']);
		assert.ok(f.model.buffer.getText().startsWith('-- independent source edit\n'));
	});

test('Lua Program Add cannot retarget an imported table through alias replacement and restoration', async t => {
	const source = "local p=require('cartlib/progression');local spec=require('definitions');p.compile_program({rules=spec.first,filters={},handlers={}})";
	const f = fixture(t, source, 'progression', [['definitions.lua', 'return {first={},second={}}']], ['rules']);
	f.select(['rules']); inputFocus.executeCommand('luaProgram.add', f.target);
	const imported = [...f.input.sourceModels.values()].find(model => model.resource.path === 'definitions.lua')!;
	const before = imported.buffer.getText();
	const offset = f.model.buffer.getText().indexOf('spec.first') + 'spec.'.length;
	f.model.pushEditOperations([{ offset, deleteLength: 5, text: 'second' }]); f.editor.luaPrograms.refresh(f.input);
	f.model.pushEditOperations([{ offset, deleteLength: 6, text: 'first' }]); f.editor.luaPrograms.refresh(f.input);
	assert.equal(f.input.sourceSelection.property, undefined);
	f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, "{id='wrong'}");
	await f.firstPart.quickInput.accept();
	assert.equal(imported.buffer.getText(), before);
	assert.equal(f.model.buffer.getText(), source);
});

for (const [change, replacement] of [['replace', 'second'], ['suffix', 'first_more'], ['interior', 'frost']] as const)
	test(`Lua Program ${change} member retargeting cannot revive a pending Add without an intermediate refresh`, async t => {
		const source = "local p=require('cartlib/progression');local spec=require('definitions');p.compile_program({rules=spec.first,filters={},handlers={}})";
		const f = fixture(t, source, 'progression', [['definitions.lua', 'return {first={},second={},first_more={},frost={}}']], ['rules']);
		inputFocus.executeCommand('luaProgram.add', f.target);
		const imported = [...f.input.sourceModels.values()].find(model => model.resource.path === 'definitions.lua')!, before = imported.buffer.getText();
		const offset = source.indexOf('spec.first') + 'spec.'.length;
		if (change === 'suffix') {
			f.model.pushEditOperations([{ offset: offset + 5, deleteLength: 0, text: '_more' }]);
			f.model.pushEditOperations([{ offset: offset + 5, deleteLength: 5, text: '' }]);
		} else if (change === 'interior') {
			f.model.pushEditOperations([{ offset: offset + 1, deleteLength: 3, text: 'ros' }]);
			f.model.pushEditOperations([{ offset: offset + 1, deleteLength: 3, text: 'irs' }]);
		} else {
			f.model.pushEditOperations([{ offset, deleteLength: 5, text: replacement }]);
			f.model.pushEditOperations([{ offset, deleteLength: replacement.length, text: 'first' }]);
		}
		assert.equal(f.input.sourceSelection.available, false);
		f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, "{id='wrong'}");
		await f.firstPart.quickInput.accept();
		assert.equal(imported.buffer.getText(), before); assert.equal(f.model.buffer.getText(), source);
	});

for (const application of [false, true]) test(`Lua Program ${application ? 'application' : 'native'} accepted whole table edit continues its actual selected field into Add`, async t => {
	const f = fixture(t); f.select(['rules']);
	const revision = f.input.sourceSelection.revision;
	f.draft("{ {id='replacement',on='new'} }");
	f.execute('luaProgram.add', application);
	assert.equal(f.input.sourceSelection.revision, revision);
	assert.equal(f.firstPart.quickInput.visible, true);
	f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, "{id='added',on='other'}");
	await f.firstPart.quickInput.accept(); f.update();
	assert.deepEqual(f.input.tree.rows.filter(row => row.element.path.length === 3 && row.element.path[2] === 'id').map(row => row.element.value), ['replacement', 'added']);
});

test('Lua Program accepted array scalar edits continue by authored coordinates through native Undo and Redo, not external replacement', t => {
	const source = "local p=require('cartlib/progression');p.compile_program({rules={},filters={{'first'}},handlers={}})";
	const f = fixture(t, source, 'progression', [], ['filters', 1, 1]);
	const revision = f.input.sourceSelection.revision;
	f.draft("'second'"); f.key('Enter');
	assert.equal(f.input.sourceSelection.revision, revision); assert.equal(f.input.sourceSelection.property!.value, 'second');
	inputFocus.executeCommand('undo', f.target); f.update();
	assert.equal(f.input.sourceSelection.property!.value, 'first');
	inputFocus.executeCommand('redo', f.target); f.update();
	assert.equal(f.input.sourceSelection.property!.value, 'second');
	const start = f.model.buffer.getText().indexOf("'second'");
	f.model.pushEditOperations([{ offset: start, deleteLength: 8, text: "'external'" }]); f.editor.luaPrograms.refresh(f.input);
	assert.equal(f.input.sourceSelection.property, undefined); assert.equal(f.input.tree.selectionIndex, -1);
});

test('Lua Program accepted grouped array values retain their surviving authored field envelope', t => {
	const source = "local p=require('cartlib/progression');p.compile_program({rules={},filters={{('first')}},handlers={}})";
	const f = fixture(t, source, 'progression', [], ['filters', 1, 1]), revision = f.input.sourceSelection.revision;
	f.draft("'second'"); f.key('Enter');
	assert.equal(f.model.buffer.getText(), source.replace("'first'", "'second'"));
	assert.equal(f.input.sourceSelection.revision, revision); assert.equal(f.input.sourceSelection.property!.value, 'second');
});

test('Lua Program source acquisition publishes complete roots and preserves later explicit selection without admitting reentrant source commands', t => {
	const f = fixture(t, PROGRAM, 'progression', [['later.lua', 'return {}']]);
	const root = f.input.tree.roots[0], revision = f.input.sourceRevision;
	let acquired = false;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource.path !== 'later.lua') return;
		acquired = true;
		assert.equal(f.input.sourceProjecting, true); assert.equal(f.input.sourceRevision, revision);
		assert.ok(f.input.tree.roots[0] === root, 'acquisition callbacks see the previous complete topology, never a partial build');
		f.select(['rules', 2, 'id']);
		inputFocus.executeCommand('luaProgram.remove', f.target);
	}));
	const source = PROGRAM.replace('handlers={}', "handlers=require('later')");
	const offset = PROGRAM.indexOf('handlers={}');
	f.model.pushEditOperations([{ offset, deleteLength: 'handlers={}'.length, text: "handlers=require('later')" }]);
	f.editor.luaPrograms.refresh(f.input); f.editor.luaPrograms.refresh(f.input);
	assert.equal(acquired, true); assert.equal(f.input.sourceProjecting, false);
	assert.equal(f.input.sourceSelection.property!.value, 'second');
	assert.equal(f.model.buffer.getText(), source);
	assert.notEqual(f.input.tree.roots[0].identity, root.identity, 'completed source projection has a new native gesture attachment');
});

test('Lua Program identical restored text republishes native source attachments and permits a fresh explicit selection without reviving the old Add', async t => {
	const source = "local p=require('cartlib/progression');local spec=require('definitions');p.compile_program({rules=spec.first,filters={},handlers={}})";
	const f = fixture(t, source, 'progression', [['definitions.lua', 'return {first={},first_more={}}']], ['rules']);
	inputFocus.executeCommand('luaProgram.add', f.target);
	const old = f.input.tree.rows[f.input.tree.selectionIndex], generation = f.input.sourceGeneration;
	const offset = source.indexOf('spec.first') + 'spec.first'.length;
	f.model.pushEditOperations([{ offset, deleteLength: 0, text: '_more' }]);
	f.model.pushEditOperations([{ offset, deleteLength: 5, text: '' }]);
	assert.equal(f.input.sourceGeneration, generation + 2); assert.equal(f.input.sourceSelection.available, false);
	f.editor.luaPrograms.refresh(f.input); f.select(['rules']);
	assert.equal(f.input.publishedSourceGeneration, f.input.sourceGeneration);
	assert.equal(f.input.sourceSelection.available, true);
	assert.notEqual(f.input.tree.rows[f.input.tree.selectionIndex].identity, old.identity);
	const imported = [...f.input.sourceModels.values()].find(model => model.resource.path === 'definitions.lua')!, before = imported.buffer.getText();
	f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, "{id='old intent'}");
	await f.firstPart.quickInput.accept();
	assert.equal(imported.buffer.getText(), before);
	inputFocus.executeCommand('luaProgram.add', f.target);
	assert.equal(f.firstPart.quickInput.visible, true);
});
