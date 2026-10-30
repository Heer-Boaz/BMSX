import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { navigationState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.second.commandTarget), true);
	const main = f.editor.mainWorkspace, parts = f.editor.editorParts, primary = main.primary;
	assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	const input = new CodeEditorInput(f.firstInput.workingCopy);
	parts.main.activeGroup.openEditor(input); f.update();
	return { ...f, model, main, parts, primary, input };
}

for (const client of ['primary', 'activity', 'documents'] as const)
	for (const entry of ['command', 'minimize', 'close', 'native retirement'] as const)
		test(`${entry} enters the Main family's retained ${client} client instead of choosing its document child`, async t => {
			const f = await fixture(t), selected = f.primary.consumer.selection;
			if (client === 'primary') f.main.focusPrimary('details');
			else if (client === 'activity') f.main.focusActivity();
			else f.parts.main.focus();
			const expected = inputFocus.admittedTarget;
			assert.ok(expected !== null);
			assert.ok(client === 'primary' ? f.primary.details.scope.contains(expected.scope)
				: client === 'activity' ? f.editor.problems.scope.contains(expected.scope)
				: f.parts.main.activeGroup.focusScope.contains(expected.scope));
			const documents = [...f.parts.main.activeGroup.model.tabs];
			f.second.focus();
			assert.ok(f.parts.activePart === f.secondPart);
			if (entry === 'command') f.editor.commands.execute('window.focusMain', f.second.commandTarget);
			else if (entry === 'minimize') f.parts.minimize(f.secondPart);
			else if (entry === 'close') assert.equal(await f.parts.close(f.secondPart), true);
			else f.secondPart.window!.detach();
			assert.ok(inputFocus.admittedTarget === expected);
			assert.ok(f.parts.activePart === f.parts.main);
			assert.ok(f.main.primary === f.primary && f.primary.consumer.selection === selected);
			assert.equal(f.parts.main.activeGroup.model.tabs.length, documents.length);
			assert.ok(f.parts.main.activeGroup.model.tabs.every((input, index) => input === documents[index]));
			assert.ok(f.parts.main.activeGroup.model.activeTab === f.input);
			assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
			if (client === 'primary') assert.ok(navigationState.activeOwner === f.main);
		});

test('explicit document entry still enters Main documents after physical Main reentry chooses the authored client', async t => {
	const f = await fixture(t);
	f.main.focusPrimary('hierarchy'); f.second.focus();
	f.editor.commands.execute('window.focusMain', f.second.commandTarget);
	assert.ok(inputFocus.admittedTarget !== null && f.primary.hierarchy.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.parts.main.focus(), true);
	assert.ok(inputFocus.admittedTarget !== null && f.parts.main.activeGroup.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.ok(f.main.primary === f.primary && f.parts.main.activeGroup.model.activeTab === f.input);
});

test('returning to another floating document still enters its retained local picker', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus();
	f.firstPart.quickInput.input('', '', 'retained draft', async value => value, () => {});
	const expected = f.firstPart.quickInput.field.focusTarget;
	assert.ok(inputFocus.admittedTarget === expected);
	f.second.focus(); parts.minimize(f.secondPart);
	assert.ok(inputFocus.admittedTarget === expected && parts.activePart === f.firstPart);
	assert.equal(f.firstPart.quickInput.visible, true);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('physical Main entry returns to its primary last-consumer decision without choosing a document', async t => {
	const f = await fixture(t);
	f.main.focusPrimary('details');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending primary source\n' }]);
	const source = f.model.buffer.getText();
	const closing = f.main.clearPrimary(f.parts.closeController);
	const expected = inputFocus.admittedTarget;
	assert.ok(expected !== null && f.main.scope.contains(expected.scope) && !f.primary.scope.contains(expected.scope));
	f.second.focus(); f.editor.commands.execute('window.focusMain', f.second.commandTarget);
	assert.ok(inputFocus.admittedTarget === expected && f.main.primary === f.primary);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.main.primary === f.primary);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
});

test('physical Main entry retains the document client local close decision', async t => {
	const f = createActualSourcePanes(t, false, [['pending.lua', 'return 1']]), parts = f.editor.editorParts;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'pending.lua' })!);
	const input = new CodeEditorInput(model), group = parts.main.activeGroup;
	group.openEditor(input); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending document source\n' }]);
	const closing = group.close(input.id), expected = parts.main.actionPrompt.focusTarget;
	assert.equal(parts.main.actionPrompt.visible, true); assert.ok(inputFocus.admittedTarget === expected);
	f.second.focus(); f.editor.commands.execute('window.focusMain', f.second.commandTarget);
	assert.ok(inputFocus.admittedTarget === expected && group.model.activeTab === input);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(group.model.activeTab === input); assert.equal(model.dirty, true);
});

for (const entry of ['minimize', 'close'] as const)
	test(`newer floating focus during ${entry} departure is not replaced by physical Main return`, async t => {
		const f = await fixture(t);
		f.main.focusPrimary('details'); f.second.focus();
		const unbind = f.second.commandTarget.onDidBlur(() => { unbind(); f.first.focus(); });
		t.after(unbind);
		if (entry === 'minimize') f.parts.minimize(f.secondPart);
		else assert.equal(await f.parts.close(f.secondPart), true);
		assert.ok(inputFocus.admittedTarget === f.first.commandTarget && f.parts.activePart === f.firstPart);
		assert.ok(f.main.primary === f.primary && f.parts.main.activeGroup.model.activeTab === f.input);
	});
