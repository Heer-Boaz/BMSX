import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { inputFocus } from '../../ide/input/focus';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { captureEditorActionPresentation } from '../../ide/commands/actions';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

async function fixture(t: TestContext, main = false, text = '123') {
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	if (main) {
		const document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	} else f.editor.sceneEditor.openResource(f.firstGroup, resource, { pinned: true });
	f.update();
	const client = main ? f.editor.mainWorkspace.primary : undefined, pane = f.firstGroup.panes.activePane;
	assert.ok(client instanceof ScenePrimaryClient || pane instanceof SceneEditorPane);
	const hierarchy = client instanceof ScenePrimaryClient ? client.view.hierarchy : (pane as SceneEditorPane).control.view.hierarchy;
	selectSceneOutlineRow(hierarchy, 1);
	if (client instanceof ScenePrimaryClient) { client.hierarchy.update(); client.details.update(); }
	else { (pane as SceneEditorPane).control.view.section = 'details'; f.update(); }
	const control = client instanceof ScenePrimaryClient ? client.details.control.controls[0] : (pane as SceneEditorPane).control.details.controls[0];
	const target = client instanceof ScenePrimaryClient ? client.commandTarget : pane!.commandTarget;
	control.field.focusTarget.focus(); setFieldText(control.field, text, true);
	return { ...f, model, control, target, client };
}

for (const valid of [true, false]) test(`Save presentation and execution address the active subject's ${valid ? 'valid' : 'invalid'} pending draft`, async t => {
	const f = await fixture(t, false, valid ? '123' : '-');
	assert.equal(f.model.dirty, false); assert.equal(f.control.pending, true);
	assert.equal(f.editor.commands.isEnabled('save', f.target), true, 'semantic action context sees its own concrete pending field');
	assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined, 'presentation does not publish or save a draft');
	f.editor.commands.execute('save', f.target);
	const saved = f.ide.textFileSaves.latestOperation(f.model);
	assert.equal(f.control.pending, !valid);
	if (!valid) {
		assert.equal(saved, undefined); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
		assert.equal(inputFocus.target, f.control.field.focusTarget);
	} else {
		assert.ok(saved !== undefined);
		assert.equal(saved.snapshot.source, SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
		await saved.completion;
		assert.equal(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy), undefined);
	}
});

for (const valid of [true, false]) test(`explicit background Save leaves an unrelated ${valid ? 'valid' : 'invalid'} foreground draft alone`, async t => {
	const f = await fixture(t, false, valid ? '123' : '-'), model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- save this retained subject\n' }]);
	const source = model.buffer.getText(), version = f.model.version;
	assert.equal(f.editor.commands.isEnabled('save', f.target, f.firstInput), true);
	f.editor.commands.execute('save', f.target, f.firstInput);
	const saved = f.ide.textFileSaves.latestOperation(model); assert.ok(saved !== undefined);
	assert.equal(saved.snapshot.source, source); await saved.completion;
	assert.equal(f.control.pending, true); assert.equal(f.model.version, version);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined);
	assert.equal(inputFocus.target, f.control.field.focusTarget);
});

test('Save cannot reacquire an implicit subject after acceptance activates another tab and returns', async t => {
	const f = await fixture(t), subject = f.firstGroup.model.activeTab!;
	let armed = true;
	t.after(f.model.onDidChangeContent(() => {
		if (!armed) return;
		armed = false; f.firstGroup.activate(f.firstInput.id); f.firstGroup.activate(subject.id);
	}));
	f.editor.commands.execute('save', f.target);
	assert.equal(armed, false); assert.equal(f.control.pending, false);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
	assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined);
	assert.equal(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy), undefined);
	assert.equal(f.firstGroup.model.activeTab, subject);
});

test('Save rechecks service admission after accepting its concrete field', async t => {
	const f = await fixture(t); let accepting = true;
	t.mock.getter(f.ide.textFileSaves, 'acceptingSaves', () => accepting);
	t.after(f.model.onDidChangeContent(() => { accepting = false; }));
	f.editor.commands.execute('save', f.target);
	assert.equal(f.control.pending, false); assert.equal(f.model.dirty, true);
	assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined);
});

for (const explicit of [false, true]) test(`Save accepts its ${explicit ? 'explicit' : 'implicit'} subject independently of a different receiver`, async t => {
	const f = await fixture(t), other = f.secondInput.workingCopy;
	other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unrelated unsaved receiver\n' }]);
	f.editor.commands.execute('save', f.target, explicit ? f.firstGroup.model.activeTab! : undefined, f.second.commandTarget);
	const saved = f.ide.textFileSaves.latestOperation(f.model); assert.ok(saved !== undefined);
	assert.equal(saved.snapshot.source, SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
	assert.equal(f.control.pending, false); await saved.completion;
	assert.equal(f.ide.textFileSaves.latestOperation(other), undefined); assert.equal(other.dirty, true);
	assert.equal(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy), undefined);
});

for (const command of ['reboot', 'hot-resume'] as const) for (const valid of [true, false])
	test(`Main ${command} ${valid ? 'accepts' : 'rejects'} its actual pending inspector before dirty discovery`, async t => {
		const f = await fixture(t, true, valid ? '123' : '-');
		t.mock.getter(f.host.execution, 'launchPending', () => false);
		assert.equal(f.model.dirty, false);
		f.editor.commands.execute(command, f.target);
		assert.equal(f.control.pending, !valid);
		assert.equal(f.editor.actionPrompt.visible, valid, 'only the accepted source enters the unsaved-source decision');
		if (!valid) {
			assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
			return;
		}
		assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
		f.editor.actionPrompt.close('secondary'); await setImmediate();
		const operation = command === 'reboot' ? f.ide.boots.latestOperation : f.ide.hotResumes.latestOperation;
		assert.ok(operation !== null);
		const snapshot = operation.sourceSnapshots.find(snapshot => snapshot.path === f.model.resource.path);
		assert.ok(snapshot !== undefined); assert.equal(snapshot.source, f.model.buffer.getText());
		assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined, 'the no-save branch still uses accepted source');
	});

for (const command of ['reboot', 'hot-resume'] as const)
	test(`Main ${command} does not borrow an unrelated document attachment during acceptance`, async t => {
		const f = await fixture(t, true);
		t.mock.getter(f.host.execution, 'launchPending', () => false);
		t.after(f.model.onDidChangeContent(() => f.editor.editorParts.main.activeGroup.openEditor(f.firstInput.createView(), { preserveFocus: true })));
		f.editor.commands.execute(command, f.target);
		assert.equal(f.control.pending, false); assert.equal(f.editor.actionPrompt.visible, true);
		f.editor.actionPrompt.close('cancel');
	});

test('runtime presentation retains Main through its own prompt, not a borrowed document or popup command context', async t => {
	const f = await fixture(t, true), presentation = captureEditorActionPresentation(f.target)!;
	assert.equal(presentation.isCurrent(), true);
	const prompt = f.editor.actionPrompt.show({ title: 'Decision', message: '', primary: 'Accept', secondary: 'Cancel', primaryEnabled: true, defaultChoice: 'primary' });
	assert.equal(presentation.isCurrent(), false, 'borrowed semantic command context is not physical ownership');
	f.editor.actionPrompt.close('cancel'); await prompt;
	assert.equal(presentation.isCurrent(), true);
	f.second.focus(); assert.equal(presentation.isCurrent(), false);
	f.client!.focus(); assert.equal(presentation.isCurrent(), true);
	f.client!.scope.retireContext(); assert.equal(presentation.isCurrent(), false);
});
