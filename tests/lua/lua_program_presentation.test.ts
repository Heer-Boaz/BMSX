import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { LuaProgramEditorPane } from '../../ide/workbench/contrib/lua_program/editor_pane';
import { createActualSourcePanes } from '../helpers/source_panes';

const PROGRAM = "local p=require('cartlib/progression'); p.compile_program({rules={{id='first',on='hit'}},filters={},handlers={}})";

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['program.lua', PROGRAM], ['replacement.lua', PROGRAM], ['cartlib/progression.lua', '']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(f.firstGroup, resource, 'progression'); f.update();
	const input = f.firstGroup.model.activeTab!, pane = f.firstGroup.panes.activePane!;
	assert.ok(input.kind === 'lua_program' && pane instanceof LuaProgramEditorPane);
	f.firstGroup.model.pin(input);
	input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === '["rules",1,"id"]');
	assert.ok(input.tree.selectionIndex >= 0);
	input.sourceSelection.select(input.tree.rows[input.tree.selectionIndex], input.sourceModels);
	pane.focus();
	const target = pane.commandTarget;
	const draft = (text: string) => {
		f.editor.commands.execute('luaProgram.edit', target);
		const field = f.editor.textTarget, focused = inputFocus.target;
		assert.ok(field !== undefined && focused?.edit !== undefined && focused !== target);
		assert.equal(field.replaceText(0, field.readText().text.length, text), true);
		return focused;
	};
	return { ...f, input, pane, target, draft };
}

for (const retained of [false, true]) for (const valid of [false, true])
	test(`Lua Program Live ${retained ? 'retained instance' : 'instance chooser'} uses ordinary ${valid ? 'valid' : 'invalid'} draft blur`, t => {
		const f = fixture(t), model = f.input.workingCopy, version = model.version;
		if (retained) f.input.instance = f.editor.luaPrograms.guest.identity(1);
		const draft = f.draft(valid ? '31' : '(');
		let changes = 0;
		t.after(model.onDidChangeContent(() => { changes++; }));
		f.editor.commands.execute('luaProgram.live', f.target);
		assert.equal(draft.edit!.pending, false);
		assert.notEqual(inputFocus.target, draft);
		assert.equal(model.buffer.getText(), valid ? PROGRAM.replace("id='first'", 'id=31') : PROGRAM);
		assert.equal(model.version, version + (valid ? 1 : 0));
		assert.equal(changes, valid ? 1 : 0);
		assert.equal(f.input.liveVisible, retained);
		assert.equal(f.firstPart.quickInput.visible, !retained);
		if (!retained) assert.equal(inputFocus.target, f.firstPart.quickInput.field.focusTarget);
		else assert.equal(inputFocus.target, f.target);
		f.firstPart.quickInput.hide();
		if (valid) {
			assert.ok(model.history.undo(model) !== null);
			assert.equal(model.buffer.getText(), PROGRAM);
			assert.equal(model.canUndo, false);
		}
	});

test('Lua Program Authoring focuses its actual receiving pane and ends its runtime interaction without changing source', t => {
	const f = fixture(t), model = f.input.workingCopy, version = model.version;
	f.input.inspectRuntime(f.editor.commands.transport); f.input.interaction.running = true; f.update();
	f.second.focus();
	f.editor.commands.execute('luaProgram.authoring', f.target);
	assert.equal(f.input.liveVisible, false);
	assert.equal(f.input.interaction.transport, null); assert.equal(f.input.interaction.running, false);
	assert.ok(inputFocus.admittedTarget !== null && f.pane.inputScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.firstPart.quickInput.visible, false);
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), PROGRAM); assert.equal(model.canUndo, false);
});

for (const command of ['luaProgram.live', 'luaProgram.authoring'] as const)
	for (const reattach of [false, true])
		test(`${command} cannot present a replacement installed by focus${reattach ? ' across the same input reattachment' : ''}`, t => {
			const f = fixture(t);
			if (command === 'luaProgram.authoring') f.input.inspectRuntime(f.editor.commands.transport);
			const action = f.target.getCommand(command)!;
			assert.equal(action.isEnabled(), true);
			const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'replacement.lua' })!;
			f.editor.luaPrograms.openResource(f.firstGroup, resource, 'progression');
			const replacement = f.firstGroup.model.activeTab!;
			assert.ok(replacement.kind === 'lua_program');
			f.firstGroup.model.pin(replacement); f.firstGroup.activate(f.input.id); f.update();
			if (command === 'luaProgram.authoring') {
				// A live pane without runtime rows admits its action bar rather than a hidden tree.
				f.pane.focus();
			}
			const receiving = f.pane.commandTarget;
			f.second.focus();
			let rebound = false;
			const unbind = receiving.onDidFocus(() => {
				unbind(); rebound = true;
				f.firstGroup.activate(replacement.id);
				if (reattach) f.firstGroup.activate(f.input.id);
			});
			t.after(unbind);
			action.run();
			assert.equal(rebound, true);
			assert.equal(f.input.liveVisible, command === 'luaProgram.authoring');
			assert.equal(replacement.liveVisible, false);
			assert.equal(f.firstPart.quickInput.visible, false);
			assert.equal(f.input.workingCopy.buffer.getText(), PROGRAM);
			assert.equal(replacement.workingCopy.buffer.getText(), PROGRAM);
		});

test('Lua Program Live cannot continue after its draft publication replaces the attached input', t => {
	const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'replacement.lua' })!;
	f.editor.luaPrograms.openResource(f.firstGroup, resource, 'progression');
	const replacement = f.firstGroup.model.activeTab!;
	assert.ok(replacement.kind === 'lua_program');
	f.firstGroup.model.pin(replacement); f.firstGroup.activate(f.input.id); f.update();
	const draft = f.draft('31');
	let replaced = false;
	const unbind = f.input.workingCopy.onDidChangeContent(() => {
		unbind(); replaced = true; f.firstGroup.activate(replacement.id);
	});
	t.after(unbind);
	f.editor.commands.execute('luaProgram.live', f.target);
	assert.equal(replaced, true);
	assert.ok(f.firstGroup.panes.activePane === f.pane && f.pane.input === replacement);
	assert.notEqual(inputFocus.target, draft);
	assert.equal(f.input.liveVisible, false); assert.equal(replacement.liveVisible, false);
	assert.equal(f.firstPart.quickInput.visible, false);
	assert.equal(f.input.workingCopy.buffer.getText(), PROGRAM.replace("id='first'", 'id=31'));
	assert.equal(replacement.workingCopy.buffer.getText(), PROGRAM);
});
