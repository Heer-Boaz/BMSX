import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import type { EditorSourceLocationRequest } from '../../ide/editor/navigation/source_location';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ScenePrimaryBookmark } from '../../ide/workbench/contrib/scene_editor/primary_bookmark';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { captureWorkspaceDirtySources, restoreWorkspaceDirtyModels, type WorkingCopyRecoveryEntry } from '../../ide/workbench/services/working_copy/source_recovery';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import { buildWorkspaceDirtyEntryPath } from '../../ide/workspace/files';
import { createWorkspaceRecord } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const SAVED = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = { { member_id = 'same', definition_id = 'first' } } })
scenes.register('same', { objects = { { member_id = 'same', definition_id = 'second' } } })
`;

function fixture(t: TestContext) {
	const models = new EditorTextModelService(); t.after(() => models.clear());
	const sources = createScenarioTestSourceState(['first.lua', 'second.lua'].map(path =>
		createScenarioTestSourceRecord(path, 1, SAVED, `tests/fixtures/recovery/${path}`)));
	const catalog = sources.catalog, clock = new VirtualHeadlessClock();
	const first = catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'first.lua' })!;
	const second = catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'second.lua' })!;
	const root = catalog.getContext(first.contextId).projectRootPath;
	return { models, catalog, clock, first, second, root };
}

for (const equal of [false, true]) for (const baseline of [null, 'acknowledged filesystem baseline'])
	test(`recovery first publication includes canonical dirty state (equal bytes: ${equal}, acknowledged baseline: ${baseline !== null})`, t => {
		const { models, catalog, clock, first: resource, root } = fixture(t);
		const source = equal ? SAVED : `-- recovered dirty declaration\n${SAVED}`;
		const record = createWorkspaceRecord(clock, source);
		const entry: WorkingCopyRecoveryEntry = { contextId: resource.contextId, path: resource.path,
			updatedAt: record.updatedAt, savedSource: SAVED, persistedBaseline: baseline };
		const path = buildWorkspaceDirtyEntryPath(root, resource.contextId, resource.path);
		let additions = 0, contentChanges = 0;
		t.after(models.onDidChangeContent(() => { contentChanges++; }));
		t.after(models.onDidAddModel(model => {
			additions++;
			assert.equal(models.get(resource), model);
			assert.equal(model.buffer.getText(), source);
			assert.equal(model.lastSavedSource, SAVED);
			assert.equal(model.persistedBaseline, baseline);
			assert.equal(model.dirty, true, 'the recovery manifest owns dirty identity independently of byte equality');
			assert.equal(model.canUndo, false);
			t.after(model.onDidChangeContent(() => { contentChanges++; }));
		}));
		assert.equal(restoreWorkspaceDirtyModels(models, catalog, [entry], new Map([[path, record]])), true);
		const model = models.get(resource)!;
		assert.equal(additions, 1); assert.equal(contentChanges, 0, 'admission never replaces text after notifying source consumers');
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- new edit\n' }]);
		assert.ok(model.undo() !== null);
		assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true);
		assert.ok(model.redo() !== null);
		model.completeSave(model.createSnapshot()); assert.equal(model.dirty, false);
		assert.ok(model.undo() !== null);
		assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true);
	});

test('a recovery observer resolving a later dirty resource receives its already admitted canonical model', t => {
	const f = fixture(t), resources = [f.first, f.second];
	const records = new Map(resources.map(resource => [buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path),
		createWorkspaceRecord(f.clock, `-- recovered ${resource.path}\n${SAVED}`)]));
	const entries: WorkingCopyRecoveryEntry[] = resources.map(resource => ({ contextId: resource.contextId, path: resource.path,
		updatedAt: records.get(buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path))!.updatedAt,
		savedSource: SAVED, persistedBaseline: null }));
	const added: EditorTextModel[] = [];
	let input: CodeEditorInput | undefined;
	t.after(f.models.onDidAddModel(model => {
		added.push(model);
		assert.equal(f.models.get(model.identity), model);
		if (model.identity.path !== f.first.path) return;
		const later = f.models.get(f.second); assert.ok(later !== undefined && later.dirty);
		assert.equal(later.buffer.getText(), `-- recovered ${f.second.path}\n${SAVED}`);
		input = new CodeEditorInput(resolveLuaTextFileModel(f.models, f.catalog, f.second));
		t.after(() => input!.dispose());
		assert.equal(input.workingCopy, later);
	}));
	assert.equal(restoreWorkspaceDirtyModels(f.models, f.catalog, entries, records), true);
	assert.ok(input !== undefined);
	assert.equal(input.workingCopy, f.models.get(f.second));
	assert.deepEqual(added, [f.models.get(f.first), input.workingCopy]);
	assert.equal(input.workingCopy.dirty, true);
	assert.equal(input.workingCopy.lastSavedSource, SAVED);
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- user edit\n' }]);
	assert.ok(input.workingCopy.undo() !== null);
	assert.equal(input.workingCopy.buffer.getText(), `-- recovered ${f.second.path}\n${SAVED}`);
	assert.equal(f.models.get(f.second), input.workingCopy);
});

test('every departing-source callback resolves the complete recovered generation without replacing its new edits', t => {
	const f = fixture(t), departing = resolveLuaTextFileModel(f.models, f.catalog, f.first);
	resolveLuaTextFileModel(f.models, f.catalog, f.second);
	const resources = [f.first, f.second], baseline = 'acknowledged source generation';
	const records = new Map(resources.map(resource => [buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path),
		createWorkspaceRecord(f.clock, `-- recovered ${resource.path}\n${SAVED}`)]));
	const entries: WorkingCopyRecoveryEntry[] = resources.map(resource => ({ contextId: resource.contextId, path: resource.path,
		updatedAt: records.get(buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path))!.updatedAt,
		savedSource: SAVED, persistedBaseline: baseline }));
	const observations: { model: EditorTextModel; later: EditorTextModel; source: string; dirty: boolean }[] = [];
	const observe = (text: string) => {
		const model = resolveLuaTextFileModel(f.models, f.catalog, f.first), later = resolveLuaTextFileModel(f.models, f.catalog, f.second);
		observations.push({ model, later, source: model.buffer.getText(), dirty: model.dirty });
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text }]);
	};
	const releaseClear = f.models.onWillClear(() => observe('-- clear callback edit\n'));
	t.after(releaseClear);
	departing.onWillDispose(() => observe('-- disposal callback edit\n'));
	t.after(f.models.onDidRemoveModel(model => { if (model === departing) observe('-- removal callback edit\n'); }));
	let restored: boolean;
	try { restored = restoreWorkspaceDirtyModels(f.models, f.catalog, entries, records); }
	finally { releaseClear(); }
	assert.equal(restored, true);
	assert.equal(observations.length, 3, 'working-copy replacement publishes recovery before clearing or disposing the departing source');
	const current = f.models.get(f.first)!, later = f.models.get(f.second)!;
	for (const observed of observations) {
		assert.ok(observed.model === current && observed.later === later);
		assert.equal(observed.dirty, true);
	}
	assert.equal(observations[0].source, `-- recovered first.lua\n${SAVED}`);
	assert.equal(current.buffer.getText(), `-- removal callback edit\n-- disposal callback edit\n-- clear callback edit\n-- recovered first.lua\n${SAVED}`);
	assert.equal(later.buffer.getText(), `-- recovered second.lua\n${SAVED}`);
	assert.equal(current.lastSavedSource, SAVED); assert.equal(current.persistedBaseline, baseline); assert.equal(current.dirty, true);
	assert.ok(current.canUndo, 'edits made by a newer callback retain their canonical history');
});

for (const replacement of [false, true]) test(`clearing recovery during first publication ${replacement ? 'admits only the new generation afterward' : 'ends all remaining old generation notifications'}`, t => {
	const f = fixture(t), resources = [f.first, f.second];
	const records = new Map(resources.map(resource => [buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path),
		createWorkspaceRecord(f.clock, `-- old recovery ${resource.path}\n${SAVED}`)]));
	const entries: WorkingCopyRecoveryEntry[] = resources.map(resource => ({ contextId: resource.contextId, path: resource.path,
		updatedAt: records.get(buildWorkspaceDirtyEntryPath(f.root, resource.contextId, resource.path))!.updatedAt,
		savedSource: SAVED, persistedBaseline: null }));
	const next = createWorkspaceRecord(f.clock, `-- new recovery generation\n${SAVED}`);
	const nextEntry = { ...entries[1], updatedAt: next.updatedAt };
	const nextRecords = new Map([[buildWorkspaceDirtyEntryPath(f.root, f.second.contextId, f.second.path), next]]);
	const leading: EditorTextModel[] = [], trailing: EditorTextModel[] = [], removed: EditorTextModel[] = [];
	let retired: EditorTextModel[] = [], restarted = false;
	t.after(f.models.onDidRemoveModel(model => { removed.push(model); }));
	t.after(f.models.onDidAddModel(model => {
		leading.push(model); assert.equal(f.models.get(model.identity), model);
		if (restarted) return;
		restarted = true; retired = [...f.models.models];
		assert.equal(retired.length, 2, 'the entire generation is admitted before its first observer');
		f.models.clear();
		if (replacement) assert.equal(restoreWorkspaceDirtyModels(f.models, f.catalog, [nextEntry], nextRecords), true);
	}));
	t.after(f.models.onDidAddModel(model => {
		assert.equal(f.models.get(model.identity), model, 'an observer cannot receive a retired model');
		trailing.push(model);
	}));
	assert.equal(restoreWorkspaceDirtyModels(f.models, f.catalog, entries, records), false);
	assert.deepEqual(removed, retired);
	assert.equal(leading[0], retired[0]);
	if (replacement) {
		const current = f.models.get(f.second)!;
		assert.equal(current.buffer.getText(), next.contents); assert.equal(current.dirty, true);
		assert.equal(f.models.get(f.first), undefined);
		assert.deepEqual([...f.models.models], [current]);
		assert.deepEqual(leading, [retired[0], current]); assert.deepEqual(trailing, [current]);
	} else {
		assert.deepEqual([...f.models.models], []);
		assert.deepEqual(leading, [retired[0]]); assert.deepEqual(trailing, []);
	}
});

test('clear from the final recovery publication callback cannot report successful admission', t => {
	const f = fixture(t), record = createWorkspaceRecord(f.clock, SAVED);
	const entry: WorkingCopyRecoveryEntry = { contextId: f.first.contextId, path: f.first.path,
		updatedAt: record.updatedAt, savedSource: SAVED, persistedBaseline: null };
	const path = buildWorkspaceDirtyEntryPath(f.root, f.first.contextId, f.first.path);
	t.after(f.models.onDidAddModel(() => f.models.clear()));
	assert.equal(restoreWorkspaceDirtyModels(f.models, f.catalog, [entry], new Map([[path, record]])), false);
	assert.deepEqual([...f.models.models], []);
});

test('retiring recovered source during first publication aborts frontend document and breakpoint restoration', async t => {
	const f = createActualSourcePanes(t), copy = f.firstInput.workingCopy;
	workspaceDirtyRecords.clear(); t.after(() => workspaceDirtyRecords.clear());
	copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered frontend source\n' }]);
	const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
	for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({
		dirtyFiles: dirty.dirtyFiles, editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		mainWorkspace: f.editor.mainWorkspace.serialize(), filesBrowser: f.editor.resourcePanel.serialize(),
		fontVariant: f.editor.fontVariant, breakpoints: [{ ...copy.identity, lines: [1] }],
	}));
	assert.equal(payload.editorParts.documents.length, 2);
	let retired = false;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (retired || model.identity.contextId !== copy.identity.contextId || model.identity.path !== copy.identity.path) return;
		retired = true;
		editorTextModelService.clear();
	}));
	const restoreBreakpoints = t.mock.method(f.ide.debugger.breakpoints, 'restore');
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload);
	assert.equal(retired, true);
	assert.deepEqual([...editorTextModelService.models], [], 'the older session cannot reopen clean replacement models after source retirement');
	assert.equal(f.editor.editorParts.documents.length, 0, 'the old floating document arrangement has no admitted source generation');
	assert.equal(f.editor.editorParts.main.activeGroup.model.tabs.length, 0);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.equal(restoreBreakpoints.mock.callCount(), 0, 'breakpoint recovery belongs to the admitted frontend source generation');
});

for (const equal of [false, true]) test(`Scene and browser occurrences admitted by recovery observers retain Source and history authority (equal bytes: ${equal})`, async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SAVED], ['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const source = equal ? SAVED : `-- recovered canonical draft\n${SAVED}`;
	const baseline = 'previous acknowledged disk generation';
	const record = createWorkspaceRecord(f.host.clock, source);
	const entry: WorkingCopyRecoveryEntry = { contextId: resource.contextId, path: resource.path,
		updatedAt: record.updatedAt, savedSource: SAVED, persistedBaseline: baseline };
	const dirtyPath = buildWorkspaceDirtyEntryPath(f.sources.catalog.getContext(resource.contextId).projectRootPath, resource.contextId, resource.path);
	workspaceDirtyRecords.clear(); workspaceDirtyRecords.set(dirtyPath, record);
	t.after(() => workspaceDirtyRecords.clear());
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({
		dirtyFiles: [entry], editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		mainWorkspace: f.editor.mainWorkspace.serialize(), filesBrowser: f.editor.resourcePanel.serialize(),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize(),
	}));
	const panel = f.editor.resourcePanel;
	panel.show(); f.update();
	assert.equal(editorTextModelService.get(resource), undefined, 'passive discovery has not admitted a working copy');
	let primary: ScenePrimaryClient | undefined, browser: WorkbenchTreeNode<FileElement> | undefined;
	let bookmark: ScenePrimaryBookmark | undefined, request: EditorSourceLocationRequest | undefined, opening: Promise<boolean> | undefined;
	let additions = 0, replacements = 0;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.identity.contextId !== resource.contextId || model.identity.path !== resource.path) return;
		additions++;
		assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true);
		assert.equal(model.lastSavedSource, SAVED); assert.equal(model.persistedBaseline, baseline);
		t.after(model.onDidChangeContent(() => { replacements++; }));
		panel.refresh(); panel.queuePendingSelection(resource); panel.applyPendingSelection();
		const file = panel.files.selectedNode!; assert.equal(file.element.kind, 'file');
		if (file.collapsed) panel.toggleFileDisclosure(file);
		browser = file.children.filter(node => node.element.kind === 'definition' && node.element.content.kind === 'scene')[1];
		assert.ok(browser !== undefined);
		panel.setSelectionIndex(panel.files.tree.rows.indexOf(browser));
		const document = f.ide.sceneSources.get(model);
		opening = f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[1] } }), inputFocus.target!);
		const admitted = f.editor.mainWorkspace.primary; assert.ok(admitted instanceof ScenePrimaryClient); primary = admitted;
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
		primary.hierarchy.update(); primary.details.update();
		bookmark = new ScenePrimaryBookmark(primary.consumer, primary.view); t.after(() => bookmark!.dispose());
		request = primary.captureSourceLocation();
	}));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload);
	assert.equal(await opening, true); f.update();
	assert.ok(primary !== undefined && browser !== undefined && bookmark !== undefined && request !== undefined);
	assert.equal(additions, 1); assert.equal(replacements, 0);
	const model = editorTextModelService.get(resource)!;
	assert.ok(primary.consumer.workingCopy === model && primary.consumer.isCurrent);
	assert.equal(primary.consumer.availability, 'available');
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
	assert.equal(bookmark.isDisposed, false);
	assert.ok(bookmark.resolve(f.ide.sceneSources)?.scene === primary.consumer.subject);
	assert.ok(request.isCurrent!());
	const location = await request.readLocation();
	assert.ok(location !== undefined && location.model === model && location.modelVersion === model.version);
	panel.refresh(); assert.ok(panel.files.selectedNode === browser, 'the exact second namesake occurrence survives canonical admission');
	f.editor.mainWorkspace.focusPrimary('hierarchy');
	const result = await f.editor.navigation.openSource(f.editor.mainWorkspace, { target: primary.hierarchy.control.focusTarget, source: request });
	assert.ok(result !== undefined);
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === model);
	assert.ok(f.editor.mainWorkspace.primary === primary && panel.files.selectedNode === browser);
	assert.equal(bookmark.isDisposed, false); assert.equal(replacements, 0);
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true);
});
