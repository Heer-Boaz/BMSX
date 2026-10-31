import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { resourceIdentityKey } from '../../ide/common/resource';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { navigationState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { TextEditorInput } from '../../ide/workbench/common/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import type { ScenePrimarySnapshot } from '../../ide/workbench/contrib/scene_editor/primary_snapshot';
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { captureWorkspaceDirtySources } from '../../ide/workbench/services/working_copy/source_recovery';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import { initializeWorkspaceStorage, restoreWorkspaceStorageSession } from '../../ide/workbench/workspace/storage';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import type { KeyValueStorage } from '../../ide/workspace/key_value_storage';
import { joinWorkspacePaths } from '../../ide/workspace/path';
import { readLocalWorkspaceRecord, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE } from '../../ide/workspace/records';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SOURCE = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('viewport proof with a deliberately long scene name', {
	objects = { { member_id = 'other', definition_id = 'actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 7, 8, 9 } } } },
})\n`;

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const identity = { contextId: f.sources.systemContextId, path: 'scene.lua' };
	const model = () => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.sources.catalog.resolveResource(identity)!);
	const open = (index: number) => {
		const copy = model(), document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(() => ({ model: copy, subject: { document, sourceVersion: copy.version, scene: document.scenes[index] } }), inputFocus.target!);
	};
	const checkpoint = (): WorkspaceAutosavePayload => {
		const mainWorkspace = f.editor.mainWorkspace.serialize();
		const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
		workspaceDirtyRecords.clear();
		for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
		return JSON.parse(JSON.stringify({ mainWorkspace, dirtyFiles: dirty.dirtyFiles,
			filesBrowser: f.editor.resourcePanel.serialize(),
			editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
			fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	};
	const restore = (payload: WorkspaceAutosavePayload) => applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload);
	t.after(() => { workspaceDirtyRecords.clear(); clearWorkspaceSourceCaches(); });
	f.first.focus();
	return { ...f, identity, model, open, checkpoint, restore };
}

for (const clearSelection of [false, true]) test(`primary recovery shares one dirty canonical model and preserves exact subject and selection (cleared: ${clearSelection})`, async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const original = f.editor.mainWorkspace.primary; assert.ok(original instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(original.view.hierarchy, 1), true);
	const copy = f.model();
	copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained draft\n' }]);
	original.view.refresh();
	if (clearSelection) assert.equal(selectSceneOutlineRow(original.view.hierarchy, -1), true);

	f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(copy));
	f.editor.mainWorkspace.focusPrimary(clearSelection ? 'hierarchy' : 'details');
	const payload = f.checkpoint(), source = copy.buffer.getText();
	assert.equal(payload.dirtyFiles.length, 1); assert.equal(workspaceDirtyRecords.size, 1);
	const snapshot: ScenePrimarySnapshot = JSON.parse(payload.mainWorkspace.primary!.value);
	assert.equal(snapshot.view.selected === undefined, clearSelection);
	assert.equal(payload.mainWorkspace.activeClient, 'primary');
	await f.restore(payload);
	const restored = f.editor.mainWorkspace.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.ok(restored !== original);
	assert.ok(restored.consumer.subject === restored.consumer.document!.scenes[1]);
	assert.equal(restored.consumer.selection === undefined, clearSelection);
	if (!clearSelection) {
		const selection = restored.consumer.selection; assert.ok(selection?.kind === 'member');
		assert.ok(selection.entry === restored.consumer.subject!.objects[0]);
		assert.equal(restored.view.preferredPart, 'details');
	}
	const code = f.editor.editorParts.main.activeGroup.model.activeTab; assert.ok(code?.kind === 'code_editor');
	assert.ok(code.workingCopy === restored.consumer.workingCopy);
	assert.ok(code.workingCopy !== copy);
	assert.equal(code.workingCopy.buffer.getText(), source); assert.equal(code.workingCopy.dirty, true);
	assert.equal(code.workingCopy.canUndo, false);
	assert.equal([...editorTextModelService.models].filter(model => model.identity.path === 'scene.lua').length, 1);
	assert.equal([...f.editor.editorParts.groups].flatMap(group => [...group.model.tabs]).filter(input => input.kind === 'scene_editor').length, 0);
	assert.ok(inputFocus.admittedTarget !== null && restored.scope.contains(inputFocus.admittedTarget.scope));
});

test('unbound Main is distinct from an unavailable persisted primary reference', async t => {
	const f = fixture(t), payload = f.checkpoint();
	assert.equal(payload.mainWorkspace.primary, null);
	await f.restore(payload);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.equal([...f.editor.mainWorkspace.workingCopyConsumers()].length, 0);
	assert.equal(f.editor.mainWorkspace.serialize().primary, null);
});

test('Main-primary foreground recovery restores persisted MRU and stacking without focusing a document', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	f.first.focus(); f.second.focus(); f.editor.mainWorkspace.focusPrimary();
	const payload = f.checkpoint();
	assert.equal(payload.mainWorkspace.activeClient, 'primary');
	assert.deepEqual(payload.editorParts.mru, [0, 2, 1]);
	await f.restore(payload);
	const parts = f.editor.editorParts, primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.deepEqual(parts.serialize(f.editor.editorInputSerializers).mru, payload.editorParts.mru);
	assert.ok(parts.activePart === parts.main);
	assert.ok(inputFocus.admittedTarget !== null && primary.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(navigationState.activeOwner === f.editor.mainWorkspace);
	const order: string[] = [];
	t.mock.method(parts.documents[0].activeGroup.panes.activePane!, 'draw', () => { order.push('first'); });
	t.mock.method(parts.documents[1].activeGroup.panes.activePane!, 'draw', () => { order.push('second'); });
	t.mock.method(primary.hierarchy, 'draw', () => { order.push('primary hierarchy'); });
	t.mock.method(primary.details, 'draw', () => { order.push('primary Details'); });
	f.paint();
	assert.ok(order.indexOf('first') < order.indexOf('second'));
	assert.ok(order.indexOf('second') < order.indexOf('primary hierarchy'));
	assert.ok(order.indexOf('second') < order.indexOf('primary Details'));
});

test('clearing primary with a Main Source view persists unbound document foreground and restores its focus', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(f.model()));
	f.editor.mainWorkspace.focusPrimary();
	assert.equal(await f.editor.mainWorkspace.clearPrimary(f.editor.editorParts.closeController), true);
	const payload = f.checkpoint();
	assert.equal(payload.mainWorkspace.primary, null);
	assert.equal(payload.mainWorkspace.activeClient, 'documents');
	await f.restore(payload);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	const parts = f.editor.editorParts, group = parts.main.activeGroup, code = group.model.activeTab;
	assert.ok(code?.kind === 'code_editor');
	assert.equal(code.workingCopy.identity.path, 'scene.lua');
	assert.ok(parts.activePart === parts.main);
	assert.ok(inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.ok(navigationState.activeOwner === group);
});

for (const missing of [false, true]) test(`primary recovery preserves an unavailable exact target without namesake rebinding (missing resource: ${missing})`, async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const payload = f.checkpoint(), original = payload.mainWorkspace.primary!;
	const resource = f.sources.catalog.resolveResource(f.identity)!;
	const record = f.sources.catalog.resolveLuaSource(f.identity)!.record;
	if (missing) f.sources.catalog.resourceByIdentity.delete(resourceIdentityKey(f.identity));
	else { record.src = record.base_src = `-- changed generation\n${SOURCE}`; }
	await f.restore(payload);
	const unavailable = f.editor.mainWorkspace.primary; assert.ok(unavailable instanceof UnavailableScenePrimaryClient);
	assert.equal(unavailable.getWorkingCopies().length, missing ? 0 : 1);
	assert.equal([...editorTextModelService.models].filter(model => model.identity.path === 'scene.lua').length, missing ? 0 : 1);
	const saved = f.checkpoint(), reference: ScenePrimarySnapshot = JSON.parse(saved.mainWorkspace.primary!.value);
	assert.equal(reference.subject.availability, 'unavailable');
	assert.deepEqual(reference.subject.range, (JSON.parse(original.value) as ScenePrimarySnapshot).subject.range);
	f.sources.catalog.resourceByIdentity.set(resourceIdentityKey(f.identity), resource);
	record.src = record.base_src = SOURCE;
	await f.restore(saved);
	const stillUnavailable = f.editor.mainWorkspace.primary; assert.ok(stillUnavailable instanceof UnavailableScenePrimaryClient);
	assert.equal(stillUnavailable.getWorkingCopies().length, 1);
	assert.equal((JSON.parse(stillUnavailable.serialize().value) as ScenePrimarySnapshot).subject.availability, 'unavailable');
});

test('a restored floating document retains foreground while Main recovers independently in the background', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	f.second.focus();
	const payload = f.checkpoint();
	assert.ok(payload.editorParts.active !== 0);
	await f.restore(payload);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
	const active = f.editor.editorParts.activePart;
	assert.ok(active !== f.editor.editorParts.main);
	assert.equal(active.activeGroup.model.activeTab?.kind, 'code_editor');
	assert.ok(inputFocus.admittedTarget !== null && active.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.editor.mainWorkspace.serialize().activeClient, payload.mainWorkspace.activeClient);
});

test('new document intent during dirty-model admission retains its group and foreground while primary recovery stays independent', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	f.model().pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered source\n' }]);
	const payload = f.checkpoint();
	let incoming: CodeEditorInput | undefined;
	const unbind = editorTextModelService.onDidAddModel(model => {
		if (model.identity.path !== 'scene.lua') return;
		unbind();
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'first.lua' })!;
		incoming = new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource));
		f.editor.editorParts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	await f.restore(payload);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
	assert.ok(incoming !== undefined && f.editor.editorParts.main.activeGroup.model.activeTab === incoming);
	assert.equal(f.editor.editorParts.documents.length, 0);
	assert.ok(inputFocus.admittedTarget !== null && f.editor.editorParts.main.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.editor.mainWorkspace.serialize().activeClient, 'documents');
});

test('a newer primary request across deserialization wins without blocking independent document hydration', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const payload = f.checkpoint();
	let ready!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { ready = resolve; }), begun = new Promise<void>(resolve => { entered = resolve; });
	const deserialize = f.editor.restorePrimaryClient.bind(f.editor);
	const delayed = t.mock.method(f.editor, 'restorePrimaryClient', async (...args: Parameters<typeof deserialize>) => {
		entered(); await gate; return deserialize(...args);
	});
	const recovery = f.restore(payload); await begun;
	assert.equal(await f.open(0), true);
	const newer = f.editor.mainWorkspace.primary; assert.ok(newer instanceof ScenePrimaryClient);
	ready(); await recovery; delayed.mock.restore();
	assert.ok(f.editor.mainWorkspace.primary === newer);
	assert.ok(newer.consumer.subject === newer.consumer.document!.scenes[0]);
	assert.equal(f.editor.editorParts.documents.length, payload.editorParts.documents.length);
	assert.ok(inputFocus.admittedTarget !== null && newer.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(navigationState.activeOwner === f.editor.mainWorkspace);
});

for (const floating of [false, true]) test(`a foreground document interaction after hydration supersedes only older primary restore focus (floating: ${floating})`, async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const payload = f.checkpoint();
	let ready!: () => void, entered!: () => void, documentsReady!: () => void;
	const gate = new Promise<void>(resolve => { ready = resolve; }), begun = new Promise<void>(resolve => { entered = resolve; });
	const documents = new Promise<void>(resolve => { documentsReady = resolve; });
	const deserialize = f.editor.restorePrimaryClient.bind(f.editor);
	const delayed = t.mock.method(f.editor, 'restorePrimaryClient', async (...args: Parameters<typeof deserialize>) => {
		entered(); await gate; return deserialize(...args);
	});
	const parts = f.editor.editorParts;
	const unbind = parts.onDidChange(() => {
		if (parts.documents.length === payload.editorParts.documents.length
			&& parts.documents.every(part => part.activeGroup.panes.activePane !== null)) documentsReady();
	});
	t.after(unbind);
	const recovery = f.restore(payload); await begun; await documents;
	const previousClient = f.editor.mainWorkspace.serialize().activeClient;
	const target = floating ? parts.documents[1] : parts.main;
	if (!floating) {
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'first.lua' })!;
		target.activeGroup.openEditor(new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource)));
	}
	target.focus();
	assert.ok(inputFocus.admittedTarget !== null && target.scope.contains(inputFocus.admittedTarget.scope));
	ready(); await recovery; delayed.mock.restore();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
	assert.ok(parts.activePart === target);
	assert.ok(inputFocus.admittedTarget !== null && target.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.editor.mainWorkspace.serialize().activeClient, floating ? previousClient : 'documents');
	assert.ok(navigationState.activeOwner === target.activeGroup);
});

test('final shutdown persists primary state and its canonical dirty source before controls are retired', async t => {
	const f = fixture(t), values = new Map<string, string>();
	const storage: KeyValueStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
	const files = new MemoryWorkspaceFiles(), context = f.sources.catalog.getContext(f.sources.systemContextId).admission;
	await initializeWorkspaceStorage(storage, f.host.clock, context, 'primary-checkpoint', f.sources.catalog, files, { log() {} });
	await restoreWorkspaceStorageSession(f.editor, f.sources.catalog, f.ide.debugger, null);
	assert.equal(await f.open(1), true);
	f.model().pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- final unsaved edit\n' }]);
	const expected = f.editor.mainWorkspace.serialize(), source = f.model().buffer.getText();
	const statePath = joinWorkspacePaths(context.projectRoot, WORKSPACE_METADATA_DIR, 'studio', context.id, 'primary-checkpoint', WORKSPACE_STATE_FILE);
	t.after(() => {
		const record = readLocalWorkspaceRecord(storage, context.projectRoot, statePath); assert.ok(record !== null);
		const payload: WorkspaceAutosavePayload = JSON.parse(record.contents);
		assert.deepEqual(payload.mainWorkspace.primary, expected.primary);
		assert.equal(payload.dirtyFiles.length, 1);
		assert.ok([...values.values()].some(value => JSON.parse(value).contents === source));
	});
});

test('a newer Main clear during initial model retirement supersedes older primary recovery', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const payload = f.checkpoint();
	let clearing: Promise<boolean> | undefined;
	const unbind = editorTextModelService.onDidRemoveModel(model => {
		if (model.identity.path !== 'scene.lua') return;
		unbind();
		clearing = f.editor.mainWorkspace.clearPrimary(f.editor.editorParts.closeController, null);
	});
	t.after(unbind);
	await f.restore(payload);
	assert.ok(clearing !== undefined);
	assert.equal(await clearing, true);
	assert.ok(f.editor.mainWorkspace.primary === undefined);
	assert.equal(f.editor.editorParts.documents.length, payload.editorParts.documents.length);
});

test('a newer Home document during initial model retirement survives independently of primary recovery', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const payload = f.checkpoint();
	let incoming: HomeInput | undefined;
	const unbind = editorTextModelService.onDidRemoveModel(model => {
		if (model.identity.path !== 'scene.lua') return;
		unbind();
		incoming = new HomeInput(null);
		f.editor.editorParts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	await f.restore(payload);
	assert.ok(incoming !== undefined && f.editor.editorParts.main.activeGroup.model.activeTab === incoming);
	assert.equal(f.editor.editorParts.documents.length, 0);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
});

test('a newer Home document during initial group retirement is not overwritten by older recovery', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.model()));
	const payload = f.checkpoint();
	let incoming: HomeInput | undefined;
	const unbind = parts.onDidChange(() => {
		if (parts.documents.length !== 0 || parts.main.activeGroup.model.activeTab !== null) return;
		unbind();
		incoming = new HomeInput(null);
		parts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	await f.restore(payload);
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 0);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
});

for (const action of ['visibility', 'filter', 'disclosure'] as const) test(`new browser ${action} during initial model retirement supersedes only older browser recovery`, async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const panel = f.editor.resourcePanel;
	panel.show();
	panel.queuePendingSelection(f.identity); panel.applyPendingSelection();
	const file = panel.files.selectedNode; assert.ok(file?.element.kind === 'file');
	if (action === 'visibility') panel.hide();
	const payload = f.checkpoint(), collapsed = file.collapsed, filter = panel.getFilterMode();
	let changed = false;
	const unbind = editorTextModelService.onDidRemoveModel(model => {
		if (model.identity.path !== 'scene.lua') return;
		unbind(); changed = true;
		if (action === 'visibility') panel.show();
		else if (action === 'filter') panel.toggleFilterMode();
		else panel.toggleFileDisclosure(file);
	});
	t.after(unbind);
	await f.restore(payload);
	assert.equal(changed, true);
	if (action === 'visibility') assert.equal(panel.visible, true);
	else if (action === 'filter') assert.notEqual(panel.getFilterMode(), filter);
	else {
		const current = panel.files.tree.rows.find(node => node.element.kind === 'file' && node.element.path === f.identity.path);
		assert.ok(current !== undefined); assert.equal(current.collapsed, !collapsed);
	}
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
	assert.equal(f.editor.editorParts.documents.length, payload.editorParts.documents.length);
});

test('outgoing model observers resolve and edit the complete recovered canonical generation before document hydration', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const departing = f.model();
	departing.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered dirty source\n' }]);
	const payload = f.checkpoint(), recoveredSource = departing.buffer.getText(), newerEdit = '-- newer Source edit\n';
	let admitted: ReturnType<typeof f.model> | undefined, incoming: CodeEditorInput | undefined, observedSource: string | undefined;
	const unbind = editorTextModelService.onDidRemoveModel(model => {
		if (model !== departing) return;
		unbind();
		admitted = f.model(); observedSource = admitted.buffer.getText();
		admitted.pushEditOperations([{ offset: 0, deleteLength: 0, text: newerEdit }]);
		incoming = new CodeEditorInput(admitted);
		f.editor.editorParts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	await f.restore(payload);
	assert.equal(observedSource, recoveredSource);
	assert.ok(admitted !== undefined && admitted !== departing && f.model() === admitted);
	assert.ok(incoming !== undefined && f.editor.editorParts.main.activeGroup.model.activeTab === incoming);
	assert.ok(incoming.workingCopy === admitted);
	assert.equal(admitted.buffer.getText(), newerEdit + recoveredSource); assert.equal(admitted.dirty, true);
	assert.ok(admitted.undo() !== null);
	assert.equal(admitted.buffer.getText(), recoveredSource); assert.equal(admitted.dirty, true);
	assert.ok(admitted.redo() !== null);
	assert.equal(admitted.buffer.getText(), newerEdit + recoveredSource);
	assert.equal(f.editor.editorParts.documents.length, 0);
	// New source bytes invalidate the persisted exact Scene proof, not the newer Source view.
	assert.ok(f.editor.mainWorkspace.primary instanceof UnavailableScenePrimaryClient);
});

test('recovery layout retires a primary gesture only after canonical sources and semantic owners agree', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const departing = f.model(), recoveredSource = `-- recovered canonical source\n${SOURCE}`;
	departing.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered canonical source\n' }]);
	const payload = f.checkpoint();
	assert.ok(departing.undo() !== null); f.update();
	const project = getOrCreateSemanticProject(editorTextModelService, f.identity.contextId);
	project.synchronizeSources(f.sources.catalog);
	assert.equal(project.getSnapshot().getFileData(resourceIdentityKey(f.identity))!.source, SOURCE);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	let observed: { readonly model: ReturnType<typeof f.model>; readonly source: string; readonly analysis: string } | undefined;
	pointerCapture.beginRoute(primary.hierarchy.scope.surfaceScope, { valid: true, insideViewport: true, viewportX: 10, viewportY: 100,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() {
		const model = f.model(), current = getOrCreateSemanticProject(editorTextModelService, f.identity.contextId);
		current.synchronizeSources(f.sources.catalog);
		observed = { model, source: model.buffer.getText(), analysis: current.getSnapshot().getFileData(resourceIdentityKey(f.identity))!.source };
	} });
	await f.restore(payload);
	assert.ok(observed !== undefined && observed.model !== departing && observed.model === f.model());
	assert.equal(observed.source, recoveredSource);
	assert.equal(observed.analysis, recoveredSource, 'layout callbacks cannot consume the departing semantic generation with recovered working-copy bytes');
});

for (const boundary of ['model-will-clear', 'primary-scope-retirement'] as const) test(`new Home and canonical Source admitted by ${boundary} do not retain departing document consumers`, async t => {
	const f = fixture(t); assert.equal(await f.open(1), true);
	const previous = f.editor.mainWorkspace.primary; assert.ok(previous instanceof ScenePrimaryClient);
	const parts = f.editor.editorParts, oldInputs = [f.firstInput, f.secondInput];
	const oldModels = new Set(editorTextModelService.models), payload = f.checkpoint();
	let incoming: HomeInput | undefined, source: CodeEditorInput | undefined;
	const admit = () => {
		unbind();
		const group = parts.main.activeGroup;
		source = new CodeEditorInput(f.model()); group.openEditor(source, { preserveFocus: true });
		incoming = new HomeInput(null); group.openEditor(incoming);
	};
	const unbind = boundary === 'model-will-clear' ? editorTextModelService.onWillClear(admit) : previous.scope.onDidRetireContext(admit);
	t.after(unbind);
	await f.restore(payload);
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.ok(source !== undefined && parts.main.activeGroup.model.findById(source.id) === source);
	assert.ok(source.workingCopy === f.model() && !oldModels.has(source.workingCopy));
	assert.equal(source.workingCopy.buffer.getText(), SOURCE);
	for (const group of parts.groups) for (const input of group.model.tabs) {
		if (input instanceof TextEditorInput) for (const model of input.getWorkingCopies()) assert.ok(!oldModels.has(model));
		assert.ok(!oldInputs.some(old => old === input));
	}
	for (const consumer of f.editor.mainWorkspace.workingCopyConsumers())
		for (const model of consumer.getWorkingCopies()) assert.ok(!oldModels.has(model));
	assert.equal(parts.documents.length, 0);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.workingCopy === source.workingCopy);
});
