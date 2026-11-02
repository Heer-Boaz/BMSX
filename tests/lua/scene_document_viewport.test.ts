import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';
import { inputFocus } from '../../ide/input/focus';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { SceneNavigationLocation } from '../../ide/workbench/contrib/scene_editor/scene_navigation';

test('a Scene document retains its viewport reading when its pane detaches and reattaches', t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const input = new SceneEditorInput(model, f.ide.sceneSources, f.sources.catalog);
	const group = f.editor.editorParts.main.activeGroup;
	assert.ok(group.openEditor(input)); f.update();
	const pane = group.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	assert.ok(pane.control.view === input.view.viewport);
	input.view.viewport.camera.setMode('3d');
	const camera = input.view.viewport.camera.capture();
	assert.ok(group.openEditor(new CodeEditorInput(model))); f.update();
	assert.ok(group.activate(input.id)); f.update();
	const restored = group.panes.activePane; assert.ok(restored instanceof SceneEditorPane);
	assert.ok(restored.control.view === input.view.viewport);
	assert.deepEqual(input.view.viewport.camera.capture(), camera);
	assert.equal(model.dirty, false);
});

test('retiring a Scene viewport cannot unregister commands from a reentrant replacement', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), docA = f.ide.sceneSources.get(a), docB = f.ide.sceneSources.get(b);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model: a,
		subject: { document: docA, sourceVersion: a.version, scene: docA.scenes[0] } }), inputFocus.target), true);
	f.update();
	const first = f.editor.mainWorkspace.primary!.input, group = f.editor.editorParts.findGroup(first)!;
	const code = new CodeEditorInput(b); assert.ok(group.openEditor(code));
	const second = new SceneEditorInput(b, f.ide.sceneSources, f.sources.catalog, undefined,
		{ document: docB, sourceVersion: b.version, scene: docB.scenes[0] });
	assert.ok(group.openEditor(second)); assert.equal(group.activate(first.id), true); f.update();
	const pane = group.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	const oldTarget = pane.commandTarget; let reentered = false;
	const unbind = f.editor.mainWorkspace.onDidChange(() => {
		if (!reentered && f.editor.mainWorkspace.primary === undefined) { reentered = true; group.activate(second.id); }
	});
	t.after(unbind);
	group.activate(code.id);
	assert.equal(reentered, true);
	const current = group.panes.activePane; assert.ok(current instanceof SceneEditorPane && current.input === second);
	assert.notEqual(current.commandTarget, oldTarget);
	assert.ok(current.commandTarget.getCommand('sceneViewport.view2d'));
	assert.ok(current.commandTarget.getCommand('sceneViewport.view3d'));
});

for (const origin of ['stage', 'hierarchy'] as const) test(`Scene ${origin} Source navigation keeps the stage visible in its actual editor group`, async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary!;
	const group = f.editor.editorParts.findGroup(primary.input)!;
	const pane = group.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	if (origin === 'hierarchy') {
		const client = primary as ScenePrimaryClient;
		assert.equal(client.hierarchy.control.focusTarget.focus(), true);
		assert.notEqual(await f.editor.navigation.openSource(f.editor.mainWorkspace, { target: client.hierarchy.control.focusTarget }), undefined);
	} else assert.notEqual(await f.editor.navigation.openSource(group, { target: pane.control.focusTarget }), undefined);
	f.update();
	assert.ok(group.panes.activePane === pane && pane.input === primary.input);
	assert.ok(f.editor.editorParts.groups.some(other => other !== group && other.model.activeTab instanceof CodeEditorInput
		&& other.model.activeTab.workingCopy === model));
	assert.ok(f.editor.mainWorkspace.primary === primary);
});

test('opening another Scene retains a dirty document without a save decision', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua');
	const open = (copy: typeof a) => {
		const document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(() => ({ model: copy,
			subject: { document, sourceVersion: copy.version, scene: document.scenes[0] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(a), true); f.update();
	a.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved scene A\n' }]);
	const text = a.buffer.getText();
	let settled = false;
	const opening = open(b).then(result => { settled = true; return result; });
	await Promise.resolve();
	const immediate = settled;
	if (!immediate) { f.key('Escape'); await opening; }
	assert.equal(immediate, true, 'switching scenes does not wait for Save, Discard or Cancel');
	assert.equal(await opening, true); f.update();
	assert.equal(f.editor.mainWorkspace.primary?.input.workingCopy, b);
	assert.equal(await open(a), true); f.update();
	assert.equal(f.editor.mainWorkspace.primary?.input.workingCopy, a);
	assert.equal(a.buffer.getText(), text); assert.equal(a.dirty, true); assert.equal(a.canUndo, true);
});

test('closing one of two Scene occurrences in a dirty source retains its shared working copy', async t => {
	const source = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('other', { objects = {} })\n`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary!.input;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty shared source\n' }]);
	const text = model.buffer.getText(); assert.equal(await open(1), true); f.update();
	const second = f.editor.mainWorkspace.primary!.input, group = f.editor.editorParts.findGroup(second)!;
	assert.notEqual(first, second); assert.ok(group.model.contains(first));
	assert.equal(await group.close(second.id), true); f.update();
	assert.ok(group.model.contains(first)); assert.equal(model.buffer.getText(), text); assert.equal(model.dirty, true);
});

test('an invalid attached Details draft blocks opening another Scene', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua');
	const open = (copy: typeof a) => {
		const document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(() => ({ model: copy,
			subject: { document, sourceVersion: copy.version, scene: document.scenes[0] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(a), true); f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0];
	assert.equal(primary.details.attached, true); assert.equal(field.field.readOnly, false);
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '-', true);
	assert.equal(await open(b), false);
	assert.ok(f.editor.mainWorkspace.primary === primary);
	assert.equal(field.pending, true); assert.equal(a.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('viewport keyboard undo and redo follow the attached Scene document after a Details edit', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '123', true); f.key('Enter');
	const changed = model.buffer.getText(); assert.notEqual(changed, SCENE_VIEWPORT_SOURCE);
	const pane = f.editor.editorParts.findGroup(primary.input)!.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	pane.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	f.key('KeyZ', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(model.buffer.getText(), changed);
});

test('closing the last dirty Scene document asks and Cancel retains it', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary!, input = primary.input;
	const group = f.editor.editorParts.findGroup(input)!, part = f.editor.editorParts.partForGroup(group);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	const text = model.buffer.getText(), closing = group.close(input.id);
	assert.equal(part.actionPrompt.visible, true); part.actionPrompt.close('cancel');
	assert.equal(await closing, false);
	assert.ok(group.model.contains(input)); assert.ok(f.editor.mainWorkspace.primary === primary);
	assert.equal(model.buffer.getText(), text); assert.equal(model.dirty, true);
});

test('a reentrant invalid Details draft vetoes viewport retirement during tab activation', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua');
	const open = (copy: typeof a) => {
		const document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(() => ({ model: copy,
			subject: { document, sourceVersion: copy.version, scene: document.scenes[0] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(a), true); assert.equal(await open(b), true); assert.equal(await open(a), true); f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const group = f.editor.editorParts.findGroup(primary.input)!;
	const other = group.model.tabs.find(input => input instanceof SceneEditorInput && input.workingCopy === b)!;
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {},
		cancelPointer() { setFieldText(field.field, '-', true); } }, undefined, group.focusScope.surfaceScope);
	assert.equal(group.activate(other.id), false);
	assert.ok(group.model.activeTab === primary.input && f.editor.mainWorkspace.primary === primary);
	assert.equal(field.pending, true); assert.equal(a.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('a group-scope draft published by capture cancellation is admitted before blur', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	const other = new CodeEditorInput(f.secondInput.workingCopy);
	assert.ok(group.openEditor(other)); assert.equal(group.activate(f.firstInput.id), true);
	const target = inputFocus.createTarget(group.focusTarget, group.focusScope);
	let pending = false, cancelled = false;
	target.edit = { get pending() { return pending; }, commit: () => false, cancel: () => { cancelled = true; } };
	target.bindKeyboard(() => {}); assert.equal(target.focus(), true);
	pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {},
		cancelPointer() { pending = true; } }, undefined, group.focusScope.surfaceScope);
	assert.equal(group.activate(other.id), false);
	assert.ok(group.model.activeTab === f.firstInput && inputFocus.target === target);
	assert.equal(pending, true); assert.equal(cancelled, false);
});

test('two visible Scene groups bind companions only on admitted interaction', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), docA = f.ide.sceneSources.get(a), docB = f.ide.sceneSources.get(b);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model: a,
		subject: { document: docA, sourceVersion: a.version, scene: docA.scenes[0] } }), inputFocus.target), true);
	f.update();
	const first = f.editor.mainWorkspace.primary; assert.ok(first instanceof ScenePrimaryClient);
	const groupA = f.editor.editorParts.findGroup(first.input)!;
	const groupB = f.editor.editorParts.splitGroup(groupA, 'right')!;
	const second = new SceneEditorInput(b, f.ide.sceneSources, f.sources.catalog, undefined,
		{ document: docB, sourceVersion: b.version, scene: docB.scenes[0] });
	const focused = inputFocus.target;
	assert.ok(groupB.openEditor(second, { preserveFocus: true })); f.update();
	assert.ok(f.editor.mainWorkspace.primary === first && inputFocus.target === focused);
	assert.ok(groupA.panes.activePane instanceof SceneEditorPane && groupB.panes.activePane instanceof SceneEditorPane);
	assert.equal(groupB.activate(second.id), true); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === second);
	assert.equal(groupA.activate(first.input.id), true); f.update();
	const active = f.editor.mainWorkspace.primary; assert.ok(active instanceof ScenePrimaryClient && active.input === first.input);
	assert.equal(selectSceneOutlineRow(active.view.hierarchy, 1), true); f.update();
	const field = active.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '-', true);
	assert.equal(groupB.activate(second.id), false);
	assert.ok(f.editor.mainWorkspace.primary === active && inputFocus.target === field.field.focusTarget);
	assert.equal(field.pending, true); assert.equal(a.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	const bounds = groupB.panes.contentBounds;
	f.editor.dispatchPointer({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
		buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.ok(f.editor.mainWorkspace.primary === active && inputFocus.target === field.field.focusTarget);
	assert.equal(field.pending, true); assert.equal(a.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	f.editor.dispatchPointer({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
		buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	setFieldText(field.field, '12', true);
	f.editor.dispatchPointer({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
		buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.ok(f.editor.mainWorkspace.primary?.input === second);
	assert.ok(a.buffer.getText().includes('x = 12, y = -22'));
});

test('workspace restore rebinds the actual Scene document after companion focus', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const original = f.editor.mainWorkspace.primary; assert.ok(original instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(original.view.hierarchy, 1), true); f.update();
	f.editor.mainWorkspace.focusPrimary('details'); f.update();
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: [], filesBrowser: f.editor.resourcePanel.serialize(), editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload); f.update();
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	const group = f.editor.editorParts.findGroup(restored.input)!;
	assert.ok(group.panes.activePane instanceof SceneEditorPane && group.panes.activePane.input === restored.input);
	assert.equal(restored.input.workingCopy.identity.path, model.identity.path);
	assert.equal(restored.view.authoring.selection?.kind, 'member');
});

test('workspace restore does not bind a background Scene over the last interacted Scene', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), docA = f.ide.sceneSources.get(a), docB = f.ide.sceneSources.get(b);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model: a,
		subject: { document: docA, sourceVersion: a.version, scene: docA.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const first = f.editor.editorParts.findGroup(primary.input)!;
	const second = f.editor.editorParts.splitGroup(first, 'right')!;
	const input = new SceneEditorInput(b, f.ide.sceneSources, f.sources.catalog, undefined,
		{ document: docB, sourceVersion: b.version, scene: docB.scenes[0] });
	assert.ok(second.openEditor(input, { preserveFocus: true })); f.update();
	f.editor.mainWorkspace.focusPrimary('hierarchy'); f.update();
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: [], filesBrowser: f.editor.resourcePanel.serialize(), editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload); f.update();
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.equal(restored.input.workingCopy.identity.path, a.identity.path);
});

test('workspace restore retains the interacted Scene companions while another window keeps Source focus', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), docA = f.ide.sceneSources.get(a), docB = f.ide.sceneSources.get(b);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model: a,
		subject: { document: docA, sourceVersion: a.version, scene: docA.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const first = f.editor.editorParts.findGroup(primary.input)!;
	const second = f.editor.editorParts.splitGroup(first, 'right')!;
	const background = new SceneEditorInput(b, f.ide.sceneSources, f.sources.catalog, undefined,
		{ document: docB, sourceVersion: b.version, scene: docB.scenes[0] });
	assert.ok(second.openEditor(background, { preserveFocus: true })); f.update();
	f.second.focus();
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: [], filesBrowser: f.editor.resourcePanel.serialize(), editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload); f.update();
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.equal(restored.input.workingCopy.identity.path, a.identity.path);
	const active = f.editor.editorParts.activePart;
	assert.ok(active !== f.editor.editorParts.main && active.activeGroup.model.activeTab?.kind === 'code_editor');
	assert.ok(inputFocus.admittedTarget !== null && active.scope.contains(inputFocus.admittedTarget.scope));
});

test('workspace restore follows the last interacted Scene across windows rather than the foreground Source part', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', "local scenes = require('cartlib/world/scene_library')\nscenes.register('other', { objects = {} })"],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), docA = f.ide.sceneSources.get(a), docB = f.ide.sceneSources.get(b);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model: a,
		subject: { document: docA, sourceVersion: a.version, scene: docA.scenes[0] } }), inputFocus.target), true);
	f.update();
	const first = f.editor.editorParts.findGroup(f.editor.mainWorkspace.primary!.input)!;
	const second = f.editor.editorParts.splitGroup(first, 'right')!;
	const input = new SceneEditorInput(b, f.ide.sceneSources, f.sources.catalog, undefined,
		{ document: docB, sourceVersion: b.version, scene: docB.scenes[0] });
	assert.ok(second.openEditor(input));
	assert.equal(f.editor.editorParts.moveEditor(second, input, { kind: 'window' }), true); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === input);
	const sourceGroup = f.editor.editorParts.sideGroup(first); assert.ok(sourceGroup !== undefined);
	assert.ok(sourceGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy))); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === input);
	f.editor.deactivate();
	assert.ok(f.editor.mainWorkspace.companionInput === input);
	f.editor.activate(); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === input);
	assert.ok(f.editor.editorParts.activePart === f.editor.editorParts.main);
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab instanceof CodeEditorInput);
	const sceneGroup = f.editor.editorParts.findGroup(input)!;
	const transient = new HostErrorInput('synthetic transient');
	const persisted = new CodeEditorInput(f.firstInput.workingCopy);
	sceneGroup.model.add(transient); sceneGroup.model.add(persisted);
	sceneGroup.model.moveToGap(transient, 0); sceneGroup.model.moveToGap(persisted, 1);
	assert.equal(f.editor.editorParts.captureEditorLocation(input).input, 1);
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: [], filesBrowser: f.editor.resourcePanel.serialize(), editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload); f.update();
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.equal(restored.input.workingCopy.identity.path, b.identity.path);
	assert.ok(f.editor.editorParts.activePart === f.editor.editorParts.main);
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab instanceof CodeEditorInput);
	const restoredA = [...f.editor.editorParts.groups].flatMap(group => [...group.model.tabs])
		.find(candidate => candidate instanceof SceneEditorInput && candidate.workingCopy.identity.path === a.identity.path);
	assert.ok(restoredA instanceof SceneEditorInput);
	const paneA = f.editor.editorParts.findGroup(restoredA)!.panes.activePane;
	assert.ok(paneA instanceof SceneEditorPane); paneA.focus();
	assert.ok(f.editor.mainWorkspace.primary?.input === restoredA);
	f.editor.deactivate(); f.editor.activate(); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === restoredA);
});

test('closing the suspended Scene revokes its companion relation before resuming', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const input = f.editor.mainWorkspace.primary!.input, group = f.editor.editorParts.findGroup(input)!;
	f.editor.deactivate();
	assert.ok(f.editor.mainWorkspace.companionInput === input);
	assert.equal(await group.close(input.id), true);
	assert.equal(f.editor.mainWorkspace.companionInput, undefined);
	f.editor.activate(); f.update();
	assert.equal(f.editor.mainWorkspace.primary, undefined);
});

test('Back reopens the exact closed Scene occurrence after source positions change', async t => {
	const source = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('other', { objects = {} })\n`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary!.input;
	resetNavigationHistoryState();
	assert.equal(await open(1), true); f.update();
	const second = f.editor.mainWorkspace.primary!.input, group = f.editor.editorParts.findGroup(second)!;
	assert.equal(await group.close(first.id), true);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved source\n' }]);
	await f.editor.navigation.goBackward(); f.update();
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.notEqual(restored.input, first);
	assert.ok(restored.input.view.authoring.subject === f.ide.sceneSources.get(model).scenes[0]);
	assert.ok(group.model.contains(restored.input) && group.model.contains(second));
});

test('Back never guesses a replacement for a closed Scene occurrence removed from source', async t => {
	const source = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('other', { objects = {} })\n`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary!.input;
	resetNavigationHistoryState(); assert.equal(await open(1), true); f.update();
	const second = f.editor.mainWorkspace.primary!.input, group = f.editor.editorParts.findGroup(second)!;
	assert.equal(await group.close(first.id), true);
	const range = luaSourceRangeToTextRange(model.buffer, f.ide.sceneSources.get(model).scenes[0].range);
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '{}' }]);
	const text = model.buffer.getText();
	await f.editor.navigation.goBackward(); f.update();
	assert.ok(f.editor.mainWorkspace.primary?.input === second);
	assert.ok(group.model.activeTab === second && !group.model.contains(first));
	assert.equal(model.buffer.getText(), text);
});

test('a closed Scene history occurrence follows the same document when reopened and moved', async t => {
	const source = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('other', { objects = {} })\n`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary!.input; assert.ok(first instanceof SceneEditorInput);
	const group = f.editor.editorParts.findGroup(first)!, location = new SceneNavigationLocation(first, group, f.editor.sceneEditor);
	t.after(() => location.dispose());
	assert.equal(await open(1), true); assert.equal(await group.close(first.id), true);
	assert.equal(await open(0), true); f.update();
	const reopened = f.editor.mainWorkspace.primary!.input; assert.ok(reopened instanceof SceneEditorInput);
	assert.notEqual(reopened, first);
	assert.equal(f.editor.editorParts.moveEditor(group, reopened, { kind: 'split', group, direction: 'right' }), true); f.update();
	const movedGroup = f.editor.editorParts.findGroup(reopened); assert.ok(movedGroup !== undefined && movedGroup !== group);
	assert.ok(f.editor.mainWorkspace.primary?.input === reopened);
	assert.equal(await location.restore({ isCurrent: () => true, preserveFocus: false }), true); f.update();
	assert.ok(movedGroup.model.activeTab === reopened && movedGroup.panes.activePane?.input === reopened);
});

test('moving a Scene document to a window moves its stage and retains the matching companions', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const input = f.editor.mainWorkspace.primary!.input; assert.ok(input instanceof SceneEditorInput);
	const source = f.editor.editorParts.findGroup(input)!;
	assert.equal(f.editor.editorParts.moveEditor(source, input, { kind: 'window' }), true); f.update();
	const destination = f.editor.editorParts.findGroup(input)!;
	assert.notEqual(destination, source);
	assert.notEqual(f.editor.editorParts.partForGroup(destination), f.editor.editorParts.main);
	const pane = destination.panes.activePane; assert.ok(pane instanceof SceneEditorPane && pane.input === input);
	assert.ok(f.editor.mainWorkspace.primary?.input === input);
	assert.ok(pane.control.view === input.view.viewport);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(primary.hierarchy.control.focusTarget.focus(), true);
	assert.notEqual(await f.editor.navigation.openSource(f.editor.mainWorkspace, { target: primary.hierarchy.control.focusTarget }), undefined);
	f.update();
	const window = f.editor.editorParts.partForGroup(destination);
	assert.ok(window.groups.some(group => group !== destination && group.model.activeTab instanceof CodeEditorInput
		&& group.model.activeTab.workingCopy === model));
	assert.ok(destination.panes.activePane === pane && f.editor.mainWorkspace.primary === primary);
});

test('a closed Scene history occurrence follows its editor group to a window', async t => {
	const source = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('other', { objects = {} })\n`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary!.input; assert.ok(first instanceof SceneEditorInput);
	const group = f.editor.editorParts.findGroup(first)!, location = new SceneNavigationLocation(first, group, f.editor.sceneEditor);
	t.after(() => location.dispose());
	assert.equal(await open(1), true); assert.equal(await group.close(first.id), true);
	const second = f.editor.mainWorkspace.primary!.input;
	assert.equal(f.editor.editorParts.moveGroup(group, { kind: 'window' }), true); f.update();
	const moved = f.editor.editorParts.findGroup(second)!; assert.notEqual(moved, group);
	assert.equal(await location.restore({ isCurrent: () => true, preserveFocus: false }), true); f.update();
	const restored = moved.model.activeTab; assert.ok(restored instanceof SceneEditorInput);
	assert.ok(restored.view.authoring.subject === f.ide.sceneSources.get(model).scenes[0]);
});
