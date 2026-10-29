import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { captureWorkspaceDirtySources } from '../../ide/workbench/services/working_copy/source_recovery';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { WorkspaceAutosaveChange, type WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords, workspaceState } from '../../ide/workbench/workspace/state';
import { initializeWorkspaceStorage, requestWorkspaceAutosave, restoreWorkspaceStorageSession, runWorkspaceAutosaveTick } from '../../ide/workbench/workspace/storage';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import type { KeyValueStorage } from '../../ide/workspace/key_value_storage';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SCENES = [
	"local scenes = require('cartlib/world/scene_library')",
	...Array.from({ length: 48 }, (_, index) => `scenes.register('scene_${index}_${'long_'.repeat(20)}', { objects = { { member_id = 'member', definition_id = 'actor' } } })`),
].join('\n');

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENES], ['cartlib/world/scene_library.lua', 'return {}'],
		...Array.from({ length: 40 }, (_, index) => [`folder_${index}/child.lua`, 'return {}'] as const)]);
	const panel = f.editor.resourcePanel;
	const resource = (path: string) => f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource('scene.lua'));
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	panel.show(); f.update(); panel.queuePendingSelection(resource('scene.lua')); panel.applyPendingSelection();
	const file = panel.files.selectedNode!; assert.equal(file.element.kind, 'file'); panel.toggleFileDisclosure(file);
	const definitions = panel.files.tree.rows.filter(node => node.element.kind === 'definition' && node.element.content.kind === 'scene');
	panel.setSelectionIndex(panel.files.tree.rows.indexOf(definitions[32]));
	// Selection and the reader's manually chosen position are independent persisted intent.
	panel.setScroll(3.5); panel.setHScroll(4.25); panel.split.ratio = 0.35; f.update();
	assert.ok(panel.scroll > 0 && panel.hscroll > 0);
	const checkpoint = (): WorkspaceAutosavePayload => {
		const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
		workspaceDirtyRecords.clear();
		for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
		return JSON.parse(JSON.stringify({ filesBrowser: panel.serialize(), mainWorkspace: f.editor.mainWorkspace.serialize(),
			dirtyFiles: dirty.dirtyFiles, editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
			fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize() }));
	};
	const restore = (payload: WorkspaceAutosavePayload) => applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload);
	t.after(() => { workspaceDirtyRecords.clear(); clearWorkspaceSourceCaches(); });
	return { ...f, panel, resource, model, primary, checkpoint, restore };
}

function selectedDefinition(node: WorkbenchTreeNode<FileElement> | null) {
	assert.ok(node !== null && node.element.kind === 'definition');
	return node.element.content;
}

test('workspace recovery restores the exact browser declaration and manual reading independently of Main and document groups', async t => {
	const f = await fixture(t), panel = f.panel;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered canonical draft\n' }]);
	panel.refresh(); f.second.focus();
	const payload = f.checkpoint(), source = f.model.buffer.getText(), selected = selectedDefinition(panel.files.selectedNode);
	const range = { ...selected.range }, primarySelection = f.primary.consumer.captureSourceReference().selected;
	assert.equal(payload.dirtyFiles.length, 1);
	panel.navigateFiles('home'); panel.toggleFilterMode(); panel.setScroll(0); panel.split.ratio = 0.5;
	await f.restore(payload); f.update();
	const restored = selectedDefinition(panel.files.selectedNode), primary = f.editor.mainWorkspace.primary;
	assert.ok(restored !== selected); assert.deepEqual(restored.range, range);
	assert.equal(restored.kind, 'scene'); assert.equal(restored.ownerResource.path, 'scene.lua');
	assert.equal(panel.scroll, payload.filesBrowser.view.scroll); assert.equal(panel.hscroll, payload.filesBrowser.view.hscroll);
	assert.equal(panel.getFilterMode(), payload.filesBrowser.filter); assert.equal(panel.split.ratio, payload.filesBrowser.widthRatio);
	assert.ok(primary instanceof ScenePrimaryClient); assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[0]);
	assert.deepEqual(primary.consumer.captureSourceReference().selected, primarySelection);
	assert.equal(primary.consumer.workingCopy.buffer.getText(), source); assert.equal(primary.consumer.workingCopy.dirty, true);
	assert.equal([...editorTextModelService.models].filter(model => model.identity.path === 'scene.lua').length, 1);
	const parts = f.editor.editorParts.serialize(f.editor.editorInputSerializers);
	assert.deepEqual(parts.main.layout, payload.editorParts.main.layout);
	assert.deepEqual(parts.documents.map(part => part.layout), payload.editorParts.documents.map(part => part.layout));
	assert.ok(inputFocus.admittedTarget !== panel.focusTarget);
	assert.ok(f.editor.editorParts.activePart !== f.editor.editorParts.main);
	f.paint();
	assert.equal(panel.scroll, payload.filesBrowser.view.scroll); assert.equal(panel.hscroll, payload.filesBrowser.view.hscroll);
});

test('hidden browser recovery retains its unallocated reading intent until its real presentation is shown', async t => {
	const f = await fixture(t), panel = f.panel;
	const range = { ...selectedDefinition(panel.files.selectedNode).range };
	panel.hide(); f.second.focus(); const payload = f.checkpoint();
	await f.restore(payload);
	assert.equal(panel.visible, false); assert.deepEqual(panel.serialize().view, payload.filesBrowser.view);
	for (let frame = 0; frame < 20; frame++) panel.refresh();
	assert.deepEqual(panel.serialize().view, payload.filesBrowser.view);
	const primary = f.editor.mainWorkspace.primary, documents = f.editor.editorParts.serialize(f.editor.editorInputSerializers);
	panel.show(); f.update();
	assert.equal(panel.scroll, payload.filesBrowser.view.scroll); assert.equal(panel.hscroll, payload.filesBrowser.view.hscroll);
	assert.deepEqual(selectedDefinition(panel.files.selectedNode).range, range);
	assert.ok(f.editor.mainWorkspace.primary === primary);
	assert.deepEqual(f.editor.editorParts.serialize(f.editor.editorInputSerializers), documents);
});

test('changed source cannot restore a browser declaration by its unchanged name and raw range or steal selection after later publication', async t => {
	const f = await fixture(t), panel = f.panel, payload = f.checkpoint();
	const registry = f.sources.catalog.getContext(f.sources.systemContextId).luaSources, record = registry.path2lua['scene.lua'];
	registerLuaSourceRecord(registry, { ...record, src: `${SCENES}\n-- different source snapshot\n`, base_src: `${SCENES}\n-- different source snapshot\n`, update_timestamp: 1 });
	await f.restore(payload); f.update();
	assert.equal(panel.files.selectedNode, null);
	panel.queuePendingSelection(f.resource('first.lua')); panel.applyPendingSelection();
	const newer = panel.files.selectedNode; assert.ok(newer !== null && newer.element.kind === 'file');
	registerLuaSourceRecord(registry, { ...record, update_timestamp: 2 }); panel.refresh();
	assert.ok(panel.files.selectedNode === newer); assert.equal(newer.element.path, 'first.lua');
});

for (const action of ['selection', 'scroll', 'filter'] as const) test(`new browser ${action} during dirty-source admission supersedes saved recovery intent`, async t => {
	const f = await fixture(t), panel = f.panel;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovery rendezvous\n' }]);
	panel.refresh(); f.second.focus(); const payload = f.checkpoint();
	let changed = false, reading = 0, filter = panel.getFilterMode();
	const unbind = editorTextModelService.onDidAddModel(model => {
		if (model.identity.path !== 'scene.lua' || changed) return;
		changed = true; panel.refresh();
		if (action === 'selection') { panel.queuePendingSelection(f.resource('first.lua')); panel.applyPendingSelection(); }
		else if (action === 'scroll') { panel.setScroll(7.5); reading = panel.scroll; }
		else { panel.toggleFilterMode(); filter = panel.getFilterMode(); }
	});
	t.after(unbind);
	await f.restore(payload); f.update();
	assert.equal(changed, true);
	if (action === 'selection') {
		const selected = panel.files.selectedNode; assert.ok(selected !== null && selected.element.kind === 'file');
		assert.equal(selected.element.path, 'first.lua');
	} else if (action === 'scroll') {
		assert.ok(reading > 0); assert.notEqual(reading, payload.filesBrowser.view.scroll);
		assert.equal(panel.scroll, reading);
	}
	else assert.equal(panel.getFilterMode(), filter);
	assert.ok(inputFocus.admittedTarget !== panel.focusTarget);
});

test('a saved focused browser restores its native focus without activating its declaration or replacing Main', async t => {
	const f = await fixture(t), payload = f.checkpoint();
	assert.equal(payload.filesBrowser.focused, true);
	await f.restore(payload); f.update();
	assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[0]);
	assert.equal(f.editor.editorParts.groups.flatMap(group => group.model.tabs).filter(input => input.kind === 'scene_editor').length, 0);
});

test('a newer document interaction supersedes only saved browser focus, not passive browser reading recovery', async t => {
	const f = await fixture(t), panel = f.panel, state = JSON.parse(JSON.stringify(panel.serialize()));
	const request = panel.beginRestore();
	f.second.focus();
	request.restore(state); request.focus(); request.dispose();
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.deepEqual(panel.serialize().view, state.view);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

for (const recover of [false, true]) test(`inactive Files retains native focus without input authority through ${recover ? 'workspace recovery and ' : ''}reactivation`, async t => {
	const f = await fixture(t), panel = f.panel, payload = f.checkpoint();
	const x = panel.layout.contentLeft + 1, y = panel.layout.contentTop + 1;
	f.editor.deactivate(); f.update();
	if (recover) { await f.restore(payload); f.update(); }
	assert.equal(f.editor.isActive, false); assert.equal(f.editor.acceptsInput, false);
	assert.equal(panel.visible, true); assert.equal(panel.isVisible(), false);
	assert.ok(inputFocus.target === panel.focusTarget && inputFocus.admittedTarget === panel.focusTarget);
	assert.equal(panel.serialize().focused, true); assert.deepEqual(panel.serialize().view, payload.filesBrowser.view);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.deepEqual(f.editor.mainWorkspace.serialize().primary, payload.mainWorkspace.primary);
	const documents = f.editor.editorParts.serialize(f.editor.editorInputSerializers);
	assert.deepEqual(documents.main.layout, payload.editorParts.main.layout);
	assert.deepEqual(documents.documents.map(part => part.layout), payload.editorParts.documents.map(part => part.layout));
	assert.equal(f.editor.clipboardTarget, undefined); assert.equal(f.editor.textTarget, undefined);
	assert.equal(panel.focusTarget.guestInput, undefined); assert.equal(pointerCapture.guestBinding, undefined);
	const arrow = new KeyInputEvent('ArrowDown', KeyModifier.none);
	assert.equal(f.editor.dispatchKey(arrow), false); assert.equal(arrow.consumed, false);
	assert.equal(f.editor.dispatchWheel({ x, y, deltaX: 0, deltaY: 1, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: f.host.clock.now() }), false);
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.deepEqual(panel.serialize().view, payload.filesBrowser.view); assert.equal(pointerCapture.active, false);
	f.editor.activate(); f.update();
	assert.equal(f.editor.isActive, true); assert.equal(f.editor.acceptsInput, true);
	assert.ok(inputFocus.admittedTarget === panel.focusTarget); assert.deepEqual(panel.serialize().view, payload.filesBrowser.view);
	assert.ok(f.editor.mainWorkspace.primary === primary); assert.deepEqual(primary.serialize(), payload.mainWorkspace.primary);
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(pointerCapture.guestBinding, undefined);
	const selected = panel.files.selectedNode; f.key('ArrowDown');
	assert.ok(panel.files.selectedNode !== selected && inputFocus.admittedTarget === panel.focusTarget);
	assert.equal(f.editor.guestInputRecipient, null);
});

test('inactive recovery retains Main primary and preferred Details region until actual Main activation admits its native controls', async t => {
	const f = await fixture(t);
	f.editor.mainWorkspace.focusPrimary('details');
	const payload = f.checkpoint();
	assert.equal(payload.filesBrowser.focused, false); assert.equal(payload.editorParts.active, 0);
	assert.equal(payload.mainWorkspace.activeClient, 'primary'); assert.equal(payload.mainWorkspace.activeRegion, 'details');
	f.editor.deactivate(); f.update(); await f.restore(payload); f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(f.editor.isActive, false); assert.equal(f.editor.acceptsInput, false);
	assert.equal(primary.hierarchy.attached, false); assert.equal(primary.details.attached, false);
	assert.equal(primary.view.preferredRegion, 'details'); assert.deepEqual(primary.serialize(), payload.mainWorkspace.primary);
	const documents = f.editor.editorParts.serialize(f.editor.editorInputSerializers);
	assert.deepEqual(documents.main.layout, payload.editorParts.main.layout);
	assert.deepEqual(documents.documents.map(part => part.layout), payload.editorParts.documents.map(part => part.layout));
	assert.equal(pointerCapture.guestBinding, undefined);
	f.editor.activate(); f.update();
	assert.ok(f.editor.mainWorkspace.primary === primary); assert.equal(primary.view.preferredRegion, 'details');
	assert.ok(inputFocus.admittedTarget !== null && primary.details.scope.contains(inputFocus.admittedTarget.scope),
		`native focus: Files=${inputFocus.admittedTarget === f.panel.focusTarget}, Main=${inputFocus.admittedTarget === f.editor.mainWorkspace.focusTarget}, activeClient=${f.editor.mainWorkspace.serialize().activeClient}, Details attached=${primary.details.attached}`);
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(pointerCapture.guestBinding, undefined);
});

test('browser reading changes publish persistence intent without invalidating cached topology measurements', async t => {
	const f = await fixture(t), panel = f.panel;
	let changes = 0; t.after(panel.onDidChange(() => { changes++; }));
	const revision = panel.files.revision;
	panel.setScroll(panel.scroll + 1); panel.setHScroll(panel.hscroll + 1); panel.navigateFiles('up');
	assert.ok(changes > 0); assert.equal(panel.files.revision, revision);
	changes = 0; const saved = panel.serialize();
	for (let frame = 0; frame < 20; frame++) { panel.refresh(); panel.prepareLayout(); panel.serialize(saved); }
	assert.equal(changes, 0); assert.equal(panel.files.revision, revision);
});

test('browser-only autosave reuses dirty recovery and document/Main generations through the actual storage subscription', async t => {
	const f = await fixture(t), panel = f.panel, values = new Map<string, string>();
	const storage: KeyValueStorage = { getItem: key => values.get(key) ?? null,
		setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
	const context = f.sources.catalog.getContext(f.sources.systemContextId).admission;
	await initializeWorkspaceStorage(storage, f.host.clock, context, 'browser-checkpoint', f.sources.catalog, new MemoryWorkspaceFiles(), { log() {} });
	await restoreWorkspaceStorageSession(f.editor, f.sources.catalog, f.ide.debugger, null);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unrelated dirty canonical work\n' }]); panel.refresh();
	requestWorkspaceAutosave(WorkspaceAutosaveChange.All); await runWorkspaceAutosaveTick();
	let before = workspaceState.localGeneration!;
	const main = t.mock.method(f.editor.mainWorkspace, 'serialize'), documents = t.mock.method(f.editor.editorParts, 'serialize');
	for (const mutate of [() => panel.split.moveTo(panel.split.position + 20), () => panel.navigateFiles('up')]) {
		mutate(); await runWorkspaceAutosaveTick();
		const after = workspaceState.localGeneration!;
		assert.ok(after !== before); assert.ok(after.payload.filesBrowser !== before.payload.filesBrowser);
		assert.ok(after.payload.dirtyFiles === before.payload.dirtyFiles && after.dirtyRecords === before.dirtyRecords);
		assert.ok(after.payload.editorParts === before.payload.editorParts && after.payload.mainWorkspace === before.payload.mainWorkspace);
		assert.ok(after.payload.breakpoints === before.payload.breakpoints);
		assert.equal(main.mock.callCount(), 0); assert.equal(documents.mock.callCount(), 0);
		assert.deepEqual(after.payload.filesBrowser, panel.serialize());
		before = after;
	}
});
