import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { captureWorkspaceDirtySources } from '../../ide/workbench/services/working_copy/source_recovery';
import { WorkspaceAutosaveChange, type WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { workspaceDirtyRecords, workspaceState } from '../../ide/workbench/workspace/state';
import { initializeWorkspaceStorage, requestWorkspaceAutosave, restoreWorkspaceStorageSession, runWorkspaceAutosaveTick } from '../../ide/workbench/workspace/storage';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { joinWorkspacePaths } from '../../ide/workspace/path';
import { WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE, workspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

async function fixture(t: TestContext) {
	const admitted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
	t.after(() => release.resolve());
	const f = createActualSourcePanes(t), files = new MemoryWorkspaceFiles('workspace'), storage = new MemoryStorage();
	const context = f.sources.catalog.getContext(f.sources.systemContextId).admission, session = 'storage-lifetime';
	await files.write('first.lua', { contents: f.source, updatedAt: 1 }, false);
	await files.write('second.lua', { contents: f.otherSource, updatedAt: 2 }, false);
	const writes = t.mock.method(files, 'write');
	await initializeWorkspaceStorage(storage, f.host.clock, context, session, f.sources.catalog, files, { log() {} });
	await restoreWorkspaceStorageSession(f.editor, f.sources.catalog, f.ide.debugger, null);
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved recovery source\n' }]);
	const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
	workspaceDirtyRecords.clear();
	for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({
		dirtyFiles: dirty.dirtyFiles, editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		mainWorkspace: f.editor.mainWorkspace.serialize(), filesBrowser: f.editor.resourcePanel.serialize(),
		fontVariant: f.editor.fontVariant, breakpoints: f.ide.debugger.breakpoints.serialize(),
	}));
	const serializer = f.editor.editorInputSerializers.code_editor;
	f.editor.editorInputSerializers.code_editor = {
		serialize: serializer.serialize.bind(serializer),
		async deserialize(value) {
			const input = await serializer.deserialize(value);
			admitted.resolve();
			await release.promise;
			return input;
		},
	};
	const restoring = restoreWorkspaceStorageSession(f.editor, f.sources.catalog, f.ide.debugger, payload);
	await admitted.promise;
	const model = editorTextModelService.get(f.firstInput.workingCopy.identity)!;
	const statePath = joinWorkspacePaths(context.projectRoot, WORKSPACE_METADATA_DIR, 'studio', context.id, session, WORKSPACE_STATE_FILE);
	return { ...f, files, storage, context, model, draft: model.buffer.getText(), statePath, writes, release, restoring };
}

test('a current frontend restore acknowledges storage binding and checkpoints its dirty working copy', { timeout: 10000 }, async t => {
	const f = await fixture(t), cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.release.resolve();
	assert.equal(await f.restoring, true);
	assert.ok(editorTextModelService.get(f.model.identity) === f.model && f.model.dirty);
	assert.equal(f.model.buffer.getText(), f.draft);
	await runWorkspaceAutosaveTick();
	const recovered: WorkspaceAutosavePayload = JSON.parse(f.files.records.get(f.statePath)!.contents);
	assert.deepEqual(recovered.dirtyFiles.map(entry => ({ contextId: entry.contextId, path: entry.path })), [f.model.identity]);
	assert.ok([...f.files.records.values()].some(record => record.contents === f.draft));
	assert.equal(f.files.records.get('first.lua')!.contents, f.source);
	assert.equal(f.writes.mock.calls.some(call => call.arguments[0] === 'first.lua' || call.arguments[0] === 'second.lua'), false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('a delayed frontend restore cannot rebind recovery storage after frontend shutdown', { timeout: 10000 }, async t => {
	const f = await fixture(t), cycles = f.host.runtime.machine.scheduler.nowCycles;
	await f.editor.shutdown();
	assert.equal(workspaceState.context, null);
	f.release.resolve();
	assert.equal(await f.restoring, false);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.All);
	assert.equal(workspaceState.requestedRevision, 0);
	assert.equal(workspaceState.autosaveHandle, null);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(f.files.records.get('first.lua')!.contents, f.source);
	assert.equal(f.writes.mock.calls.some(call => call.arguments[0] === 'first.lua' || call.arguments[0] === 'second.lua'), false);
	const recovered: WorkspaceAutosavePayload = JSON.parse(f.files.records.get(f.statePath)!.contents);
	assert.deepEqual(recovered.dirtyFiles.map(entry => ({ contextId: entry.contextId, path: entry.path })), [f.model.identity]);
	assert.ok([...f.files.records.values()].some(record => record.contents === f.draft));
});

test('a delayed frontend restore retains its records owner rather than a reused file provider', { timeout: 10000 }, async t => {
	const f = await fixture(t), records = workspaceRecords!, cycles = f.host.runtime.machine.scheduler.nowCycles;
	await initializeWorkspaceStorage(f.storage, f.host.clock, f.context, 'replacement-storage', f.sources.catalog, f.files, { log() {} });
	assert.ok(workspaceRecords !== records && workspaceRecords!.provider === records.provider);
	assert.equal(records.acceptingOperations, false);
	assert.equal(f.editor.isClosing, false);
	const writes = f.writes.mock.callCount();
	f.release.resolve();
	const restored = await f.restoring;
	assert.ok(editorTextModelService.get(f.model.identity) === f.model && f.model.dirty);
	assert.equal(f.model.buffer.getText(), f.draft);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later retained edit\n' }]);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.All);
	await runWorkspaceAutosaveTick();
	assert.equal(workspaceState.requestedRevision, 0);
	assert.equal(workspaceState.autosaveHandle, null);
	assert.equal(f.writes.mock.callCount(), writes, 'a retired restore cannot checkpoint an old frontend into the replacement storage session');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(f.files.records.get('first.lua')!.contents, f.source);
	assert.equal(f.model.dirty, true);
	assert.equal(restored, false);
});
