import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';

test('project identity includes the working-copy owner and unchanged queries reuse each exact snapshot', t => {
	const first = new EditorTextModelService(), second = new EditorTextModelService();
	t.after(() => { first.clear(); second.clear(); });
	const resource = { domain: 0 as const, path: 'same.lua', source: { type: 'lua' as const, resid: 'same' } };
	const a = first.retain(resource, 'lua', 'return 1'), b = second.retain(resource, 'lua', 'return 2');
	const projectA = getOrCreateSemanticProject(first, 0), projectB = getOrCreateSemanticProject(second, 0);
	assert.notEqual(projectA, projectB);
	const snapshotA = projectA.getSnapshot(), snapshotB = projectB.getSnapshot();
	assert.equal(snapshotA.getFileData('same.lua')!.source, 'return 1');
	assert.equal(snapshotB.getFileData('same.lua')!.source, 'return 2');
	const parser = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	for (let query = 0; query < 1000; query++) {
		assert.equal(getOrCreateSemanticProject(first, 0).getSnapshot(), snapshotA);
		assert.equal(getOrCreateSemanticProject(second, 0).getSnapshot(), snapshotB);
	}
	assert.equal(parser.mock.callCount(), 0);
	a.pushEditOperations([{ offset: 7, deleteLength: 1, text: '3' }]);
	assert.equal(projectA.getSnapshot().getFileData('same.lua')!.source, 'return 3');
	assert.equal(projectB.getSnapshot(), snapshotB);
	assert.equal(b.version, 1);
	assert.equal(snapshotA.getFileData('same.lua')!.source, 'return 1', 'retained generations stay immutable');
});

test('model teardown retires only its projects and a reopened matching source cannot revive them', t => {
	const first = new EditorTextModelService(), second = new EditorTextModelService();
	t.after(() => { first.clear(); second.clear(); });
	const resource = { domain: 0 as const, path: 'same.lua', source: { type: 'lua' as const, resid: 'same' } };
	first.retain(resource, 'lua', 'return 1'); second.retain(resource, 'lua', 'return 2');
	const project = getOrCreateSemanticProject(first, 0), foreign = getOrCreateSemanticProject(second, 0);
	const old = project.getSnapshot(), other = foreign.getSnapshot();
	const dispose = t.mock.method(project, 'dispose'), foreignDispose = t.mock.method(foreign, 'dispose');
	first.clear();
	assert.equal(dispose.mock.callCount(), 1); assert.equal(foreignDispose.mock.callCount(), 0);
	const reopened = first.retain(resource, 'lua', 'return 3');
	assert.equal(reopened.version, 1);
	const replacement = getOrCreateSemanticProject(first, 0);
	assert.notEqual(replacement, project);
	assert.equal(replacement.getSnapshot().getFileData('same.lua')!.source, 'return 3');
	assert.equal(old.getFileData('same.lua')!.source, 'return 1');
	assert.equal(getOrCreateSemanticProject(second, 0).getSnapshot(), other);
});

test('domain reset and collection reset are owner-scoped with one model-lifetime subscription', t => {
	const first = new EditorTextModelService(), second = new EditorTextModelService();
	t.after(() => { first.clear(); second.clear(); });
	const subscribe = t.mock.method(first, 'onWillClear');
	const cartridge = getOrCreateSemanticProject(first, 0), system = getOrCreateSemanticProject(first, -1);
	const foreign = getOrCreateSemanticProject(second, 0);
	assert.notEqual(resetSemanticProject(first, 0), cartridge);
	assert.equal(getOrCreateSemanticProject(first, -1), system);
	for (let reset = 0; reset < 100; reset++) {
		resetSemanticProjects(first); getOrCreateSemanticProject(first, 0);
	}
	assert.notEqual(getOrCreateSemanticProject(first, -1), system);
	assert.equal(getOrCreateSemanticProject(second, 0), foreign);
	assert.equal(subscribe.mock.callCount(), 1, 'repeated explicit resets do not accumulate teardown observers');
});
