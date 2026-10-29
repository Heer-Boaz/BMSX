import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

/** An actual source-backed inspector draft, alongside the retained inactive Source tab. */
function sceneDraft(t: TestContext, text: string) {
	configureFontVariant('tiny');
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource, { pinned: true }); f.update();
	const scene = f.firstGroup.model.activeTab, pane = f.firstGroup.panes.activePane;
	assert.ok(scene instanceof SceneEditorInput && pane instanceof SceneEditorPane);
	selectSceneOutlineRow(scene.view.hierarchy, 1); scene.view.section = 'details'; f.update();
	const control = pane.control.details.controls[0], field = control.field;
	assert.equal(field.readOnly, false); assert.equal(field.focusTarget.focus(), true);
	assert.equal(field.focusTarget.textInput!.replaceText(0, field.text.length, text), true);
	assert.equal(control.pending, true);
	return { ...f, scene, pane, control, field };
}

test('copy owner publishes an independent pinned view over the exact sender model and history', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, model = f.firstInput.workingCopy;
	f.first.focus();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared history\n' }]);
	f.firstInput.context.view.cursorRow = 1; f.firstInput.context.view.cursorColumn = 7;
	const view = captureCodeEditorView(f.firstInput), text = model.buffer.getText(), version = model.version;
	const groups = parts.groups.length, documents = parts.documents.length;
	let coherent = true, publications = 0;
	t.after(parts.onDidChange(() => {
		if (parts.documents.length === documents) return;
		const receiver = parts.documents[documents].activeGroup;
		publications++; coherent = coherent && receiver.model.activeTab !== null && receiver.panes.activePane?.input === receiver.model.activeTab;
	}));
	const copied = await parts.copyEditor(f.firstGroup, f.firstInput);
	assert.ok(copied instanceof CodeEditorInput && copied !== f.firstInput && copied.workingCopy === model);
	const receiver = parts.findGroup(copied)!;
	assert.equal(parts.groups.length, groups + 1); assert.equal(parts.documents.length, documents + 1);
	assert.ok(receiver !== f.firstGroup && receiver.panes.activePane?.input === copied && receiver.model.previewTab === null);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup && f.firstGroup.panes.activePane === f.first);
	assert.deepEqual(captureCodeEditorView(copied), view);
	assert.ok(publications > 0 && coherent); assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	model.undo(); assert.equal(model.buffer.getText(), f.source);
});

test('copy command accepts the actual Scene field before refreshing and capturing its view', async t => {
	const f = sceneDraft(t, '123456789'), model = f.scene.workingCopy, original = model.buffer.getText(), version = model.version;
	f.editor.commands.execute('window.copyEditor', f.pane.commandTarget); await setImmediate(); f.update();
	const copied = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(copied instanceof SceneEditorInput && copied !== f.scene && copied.workingCopy === model);
	assert.equal(model.buffer.getText(), original.replace('x = 11', 'x = 123456789')); assert.equal(model.version, version + 1);
	assert.equal(f.control.pending, false); assert.equal(copied.view.details.properties[0].descriptor.value, 123456789);
	assert.deepEqual(copied.view.authoring.selectionRange, f.scene.view.authoring.selectionRange);
	model.undo(); assert.equal(model.buffer.getText(), original);
	model.redo(); assert.equal(model.buffer.getText(), original.replace('x = 11', 'x = 123456789'));
});

test('invalid native sender draft vetoes copying before view production or prospective window construction', async t => {
	const f = sceneDraft(t, '-'), parts = f.editor.editorParts, model = f.scene.workingCopy;
	const text = model.buffer.getText(), version = model.version, documents = parts.documents.length, groups = parts.groups.length;
	const create = t.mock.method(f.scene, 'createView'), attach = t.mock.method(f.editor.surfaces, 'attach');
	assert.equal(await parts.copyEditor(f.firstGroup, f.scene), undefined);
	assert.equal(create.mock.callCount(), 0); assert.equal(attach.mock.callCount(), 0);
	assert.equal(parts.documents.length, documents); assert.equal(parts.groups.length, groups);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.control.pending, true); assert.ok(inputFocus.target === f.field.focusTarget);
});

for (const draft of ['17', '-']) test(`inactive sender copy command does not precommit or veto unrelated native draft ${draft}`, async t => {
	const f = sceneDraft(t, draft), parts = f.editor.editorParts, model = f.scene.workingCopy;
	assert.ok(f.firstGroup.model.contains(f.firstInput));
	const version = model.version, create = f.firstInput.createView.bind(f.firstInput);
	let queried = false;
	t.mock.method(f.firstInput, 'createView', () => {
		queried = true;
		assert.equal(f.control.pending, true); assert.equal(f.control.error, ''); assert.equal(model.version, version);
		assert.ok(inputFocus.target === f.field.focusTarget);
		return create();
	});
	f.editor.commands.execute('window.copyEditor', f.pane.commandTarget, f.firstInput); await setImmediate(); f.update();
	const copied = parts.activeGroup.model.activeTab;
	assert.ok(queried && copied instanceof CodeEditorInput && copied.workingCopy === f.firstInput.workingCopy);
	assert.ok(f.firstGroup.model.activeTab === f.scene && f.firstGroup.panes.activePane === f.pane);
});

test('accepted sender draft cannot copy a newer attachment selected by its source publication', async t => {
	const f = sceneDraft(t, '17'), parts = f.editor.editorParts, documents = parts.documents.length, newer = new HostErrorInput('new attachment');
	const create = t.mock.method(f.scene, 'createView');
	const unsubscribe = f.scene.workingCopy.onDidChangeContent(() => { unsubscribe(); f.firstGroup.openEditor(newer); }); t.after(unsubscribe);
	assert.equal(await parts.copyEditor(f.firstGroup, f.scene), undefined);
	assert.equal(create.mock.callCount(), 0); assert.equal(parts.documents.length, documents);
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
	assert.ok(f.scene.workingCopy.buffer.getText().includes('x = 17'));
});

test('reentrant sender replacement during createView disposes its offer and all unpublished window controls', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, documents = parts.documents.length, groups = parts.groups.length;
	const provisional: WorkbenchSurface[] = [], attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'attach', options => { const surface = attach(options); provisional.push(surface); return surface; });
	const create = f.firstInput.createView.bind(f.firstInput), newer = new CodeEditorInput(f.secondInput.workingCopy);
	let disposed = 0;
	t.mock.method(f.firstInput, 'createView', () => {
		const offered = create(); offered.onWillDispose(() => disposed++);
		f.firstGroup.openEditor(newer, { pinned: true });
		return offered;
	});
	assert.equal(await parts.copyEditor(f.firstGroup, f.firstInput), undefined);
	assert.equal(disposed, 1); assert.equal(parts.documents.length, documents); assert.equal(parts.groups.length, groups);
	assert.ok(provisional.length > 0 && provisional.every(surface => surface.retired));
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
});

test('window construction callback closing the sender publishes no window and performs no source query', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, documents = parts.documents.length, groups = parts.groups.length;
	const provisional: WorkbenchSurface[] = [], attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	const create = t.mock.method(f.firstInput, 'createView');
	t.mock.method(f.editor.surfaces, 'attach', options => {
		const surface = attach(options); provisional.push(surface);
		f.firstPart.setOperation('close');
		return surface;
	});
	assert.equal(await parts.copyEditor(f.firstGroup, f.firstInput), undefined);
	assert.equal(create.mock.callCount(), 0); assert.equal(parts.documents.length, documents); assert.equal(parts.groups.length, groups);
	assert.ok(provisional.length > 0 && provisional.every(surface => surface.retired));
	f.firstPart.setOperation('none');
});

test('canonical source publication during view capture does not retire the unchanged sender attachment', async t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy, create = f.firstInput.createView.bind(f.firstInput);
	const text = model.buffer.getText(), version = model.version;
	t.mock.method(f.firstInput, 'createView', () => {
		const input = create();
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- published during capture\n' }]);
		return input;
	});
	const copied = await f.editor.editorParts.copyEditor(f.firstGroup, f.firstInput);
	assert.ok(copied instanceof CodeEditorInput && copied !== f.firstInput && copied.workingCopy === model);
	assert.equal(model.buffer.getText(), '-- published during capture\n' + text); assert.equal(model.version, version + 1);
	assert.ok(f.firstGroup.panes.activePane === f.first && f.first.input === f.firstInput);
	model.undo(); assert.equal(model.buffer.getText(), text);
});
