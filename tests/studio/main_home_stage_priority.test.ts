import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import { HomeInput, openHome } from '../../ide/workbench/contrib/home/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const parts = f.editor.editorParts, part = parts.main, group = part.activeGroup, main = f.editor.mainWorkspace;
	openHome(group, null, { pinned: false });
	const home = group.model.activeTab; assert.ok(home instanceof HomeInput);
	assert.equal(group.model.previewTab, home); assert.equal(part.hasDocumentContent, false);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	return { ...f, parts, part, group, main, home, primary, model };
}

test('opening a Scene admits its real document while retaining the startup Home preview', async t => {
	const f = await fixture(t), scene = f.primary.input;
	let disposed = false; t.after(f.home.onWillDispose(() => { disposed = true; }));
	assert.equal(f.group.model.activeTab, scene); assert.equal(f.group.model.previewTab, f.home);
	assert.ok(f.group.model.contains(f.home)); assert.equal(f.group.presented, true); assert.equal(f.part.contentPresented, true);
	assert.equal(f.group.panes.activePane?.input, scene);
	assert.ok(inputFocus.admittedTarget !== null && f.primary.viewportTarget.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(await f.group.close(scene.id), true); f.update();
	assert.equal(f.group.model.activeTab, f.home); assert.equal(f.group.panes.activePane?.input, f.home);
	assert.equal(f.main.primary, undefined); assert.equal(disposed, false);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.canUndo, false);
});

test('explicit Home promotes the retained startup input without destroying the Scene document', async t => {
	const f = await fixture(t), scene = f.primary.input;
	f.editor.commands.execute('home', f.primary.viewportTarget); f.update();
	assert.equal(f.group.model.activeTab, f.home); assert.equal(f.group.model.previewTab, null);
	assert.ok(f.group.model.contains(scene)); assert.equal(f.part.hasDocumentContent, true);
	assert.equal(f.main.primary, undefined); assert.ok(inputFocus.admittedTarget !== null && f.group.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.ok(f.group.openEditor(scene)); f.update();
	const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient); assert.equal(primary.input, scene);
});

for (const kind of ['source', 'tool'] as const)
	test(`an ordinary unpinned ${kind} can be opened and closed without destroying the Scene document`, async t => {
		const f = await fixture(t), scene = f.primary.input;
		const input = kind === 'source' ? new CodeEditorInput(f.firstInput.workingCopy) : new EventViewerInput(f.editor.events);
		f.group.openEditor(input, { pinned: false }); f.update();
		assert.equal(f.group.model.previewTab, input); assert.ok(f.group.model.contains(scene));
		assert.equal(f.group.panes.activePane?.input, input); assert.equal(f.main.primary, undefined);
		assert.equal(await f.group.close(input.id), true); f.update();
		assert.ok(f.group.model.contains(scene)); assert.equal(f.part.contentPresented, true);
		assert.ok(f.group.openEditor(scene)); f.update();
		const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient); assert.equal(primary.input, scene);
	});

test('moving canonical Source between groups preserves the real Scene document and working copy history', async t => {
	const f = await fixture(t), scene = f.primary.input;
	const input = new CodeEditorInput(f.firstInput.workingCopy), model = input.workingCopy;
	f.group.openEditor(input); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained edit\n' }]);
	const history = model.history, version = model.version, source = model.buffer.getText();
	let handoff = false;
	const release = f.group.onDidMoveEditor(() => {
		handoff = true; assert.equal(f.group.model.contains(input), false); assert.equal(f.secondGroup.model.contains(input), true);
	}); t.after(release);
	assert.equal(f.parts.moveEditor(f.group, input, { kind: 'group', group: f.secondGroup }), true); f.update();
	assert.equal(handoff, true); release(); assert.ok(f.group.model.contains(scene));
	assert.equal(f.secondGroup.model.activeTab, input); assert.equal(input.workingCopy, model);
	assert.equal(model.history, history); assert.equal(model.version, version); assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, true);
	assert.equal(f.parts.moveEditor(f.secondGroup, input, { kind: 'group', group: f.group }), true); f.update();
	assert.equal(f.group.model.activeTab, input); assert.ok(f.group.model.contains(scene));
	assert.equal(model.history, history); assert.equal(model.version, version);
});

test('whole-group adoption and departure preserve Scene and Home in their original document group', async t => {
	const f = await fixture(t), input = f.firstInput, scene = f.primary.input;
	assert.equal(f.parts.moveGroup(f.firstGroup, { kind: 'split', group: f.group, direction: 'right' }), true); f.update();
	const incoming = f.parts.findGroup(input)!;
	assert.ok(incoming !== f.group); assert.equal(f.parts.partForGroup(incoming), f.part);
	assert.ok(f.group.model.contains(scene)); assert.ok(f.group.model.contains(f.home));
	assert.equal(f.parts.moveGroup(incoming, { kind: 'window' }), true); f.update();
	assert.equal(f.part.groups.length, 1); assert.ok(f.group.model.contains(scene)); assert.ok(f.group.model.contains(f.home));
	const floating = f.parts.partForGroup(f.parts.findGroup(input)!);
	assert.notEqual(floating, f.part); assert.equal(floating.contentPresented, true);
	const homeWindow = f.parts.createDocument(); openHome(homeWindow.activeGroup, null, { pinned: false }); f.update();
	assert.equal(homeWindow.hasDocumentContent, false); assert.equal(homeWindow.contentPresented, true);
	assert.equal(homeWindow.activeGroup.presented, true);
});

test('group serialization retains implicit versus explicitly kept Home beside the Scene document', async t => {
	const f = await fixture(t), restored = new EditorTabGroupModel();
	t.after(() => restored.clear());
	const implicit = f.group.model.serialize(f.editor.editorInputSerializers);
	assert.equal(await restored.deserialize(implicit, f.editor.editorInputSerializers), true);
	assert.ok(restored.previewTab instanceof HomeInput); assert.equal(restored.activeTab?.kind, 'scene_editor');
	openHome(f.group, null);
	const explicit = f.group.model.serialize(f.editor.editorInputSerializers);
	assert.equal(await restored.deserialize(explicit, f.editor.editorInputSerializers), true);
	assert.equal(restored.previewTab, null); assert.ok(restored.activeTab instanceof HomeInput);
	assert.ok(restored.tabs.some(input => input.kind === 'scene_editor'));
});

test('idle document layout consumes published participation without probing input classification', async t => {
	const f = await fixture(t); let probes = 0;
	Object.defineProperty(f.home, 'isPlaceholder', { get: () => { probes++; return true; } });
	for (let frame = 0; frame < 100; frame++) { assert.equal(f.part.hasDocumentContent, true); f.update(); }
	assert.equal(probes, 0, 'classification is published by membership and pin changes, never frame layout');
	openHome(f.group, null); f.update();
	assert.ok(probes > 0); assert.equal(f.part.hasDocumentContent, true);
});
