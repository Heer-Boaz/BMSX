import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { DiskWorkspaceRecordProvider } from '../../ide/node/workspace_records';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceDirectoryModel } from '../../ide/workspace/directory_model';
import { WORKSPACE_METADATA_DIR, WorkspaceRecords } from '../../ide/workspace/records';
import type { WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function fixture(t: TestContext, files: WorkspaceRecordProvider = new MemoryWorkspaceFiles('workspace'), projectRoot = 'fixture/project') {
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('fixture/system', ''),
		[createLuaSourceRegistry(projectRoot, ''), null], 0);
	const records = new WorkspaceRecords(files), model = new WorkspaceDirectoryModel(records, sources.catalog);
	const root = model.rootForContext(TEST_CARTRIDGE_CONTEXT_IDS[0])!; assert.ok(root !== undefined);
	t.after(async () => { model.dispose(); sources.catalog.dispose(); await records.close(); });
	return { files, records, model, root, catalog: sources.catalog };
}

test('physical directory inventory includes raw files and empty folders without admitting semantic resources or reading file contents', async t => {
	const files = new MemoryWorkspaceFiles('workspace');
	await files.createDirectory('fixture/project/empty');
	await files.write('fixture/project/notes.txt', { contents: 'not a cartridge asset', updatedAt: 1 }, false);
	await files.write('fixture/project/nested/texture.png', { contents: 'raw fixture bytes', updatedAt: 2 }, false);
	const f = fixture(t, files), reads = t.mock.method(files, 'readDirectory'), contents = t.mock.method(files, 'read');
	assert.equal(f.model.get(f.root, ''), undefined); assert.equal(f.model.children(f.root, ''), undefined);
	assert.equal(reads.mock.callCount(), 0);
	await f.model.resolve(f.root, '');
	const snapshot = f.model.get(f.root, ''); assert.ok(snapshot?.status === 'ready');
	assert.deepEqual(snapshot.entries.map(entry => [entry.name, entry.type]).sort(), [['empty', 'directory'], ['nested', 'directory'], ['notes.txt', 'file']]);
	const children = f.model.children(f.root, '')!;
	assert.deepEqual(children.map(entry => [entry.path, entry.workspacePath]).sort(),
		[['empty', 'fixture/project/empty'], ['nested', 'fixture/project/nested'], ['notes.txt', 'fixture/project/notes.txt']]);
	assert.equal(f.model.get(f.root, 'nested'), undefined); assert.equal(reads.mock.callCount(), 1);
	await f.model.resolve(f.root, 'empty');
	assert.deepEqual(f.model.children(f.root, 'empty'), []);
	assert.equal(contents.mock.callCount(), 0); assert.equal(f.catalog.resources.length, 0);
	assert.equal(files.records.size, 2, 'an empty folder has no sentinel source file');
});

test('private workspace metadata remains real provider state but never enters the public project namespace or triggers directory reloads', async t => {
	const files = new MemoryWorkspaceFiles('workspace');
	await files.createDirectory(`fixture/project/${WORKSPACE_METADATA_DIR}`);
	await files.write('fixture/project/authored.txt', { contents: 'authored bytes', updatedAt: 1 }, false);
	const raw = await files.readDirectory('fixture/project');
	assert.ok(raw!.some(entry => entry.name === WORKSPACE_METADATA_DIR));
	const f = fixture(t, files), reads = t.mock.method(files, 'readDirectory');
	await f.model.resolve(f.root, '');
	assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path), ['authored.txt']);
	const acknowledged = f.model.children(f.root, ''), count = reads.mock.callCount();
	await f.records.write(`fixture/project/${WORKSPACE_METADATA_DIR}/studio/session.json`, { contents: 'private recovery', updatedAt: 2 }, true);
	await f.records.createDirectory(`fixture/project/${WORKSPACE_METADATA_DIR}/saves`);
	await setImmediate();
	assert.equal(reads.mock.callCount(), count); assert.ok(f.model.children(f.root, '') === acknowledged);
	assert.equal((await files.read(`fixture/project/${WORKSPACE_METADATA_DIR}/studio/session.json`))!.contents, 'private recovery');
	const mkdir = t.mock.method(files, 'createDirectory');
	await assert.rejects(async () => f.model.createDirectory(f.model.directory(f.root, ''), WORKSPACE_METADATA_DIR));
	await assert.rejects(async () => f.model.createDirectory(f.model.directory(f.root, ''), `uncreated/${WORKSPACE_METADATA_DIR}/child`));
	assert.equal(mkdir.mock.callCount(), 0); assert.equal(await files.readDirectory('fixture/project/uncreated'), null);
});

test('directory resolve coalesces pending reads and cached observation never repeats I/O', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'); await files.createDirectory('fixture/project/empty');
	const f = fixture(t, files), reads = t.mock.method(files, 'readDirectory', async path => {
		await gate.promise; return MemoryWorkspaceFiles.prototype.readDirectory.call(files, path);
	});
	const first = f.model.resolve(f.root, ''), second = f.model.resolve(f.root, '');
	await setImmediate(); assert.equal(reads.mock.callCount(), 1); assert.equal(f.model.get(f.root, '')!.status, 'loading');
	gate.resolve(); await Promise.all([first, second]);
	const children = f.model.children(f.root, '');
	for (let index = 0; index < 100; index++) {
		assert.ok(f.model.children(f.root, '') === children); assert.equal(f.model.get(f.root, '')!.status, 'ready');
	}
	await f.model.resolve(f.root, ''); assert.equal(reads.mock.callCount(), 1);
});

test('two admitted project aliases share one physical read but retain their own projected root identities', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'); await files.createDirectory('fixture/project/empty');
	const f = fixture(t, files), context = f.catalog.getContext(f.root.contextId);
	f.catalog.admitContext({ ...context, admission: { id: 'fixture-directory-alias', projectRoot: context.projectRootPath } });
	const alias = f.model.rootForContext('fixture-directory-alias')!;
	const reads = t.mock.method(files, 'readDirectory', async path => { await gate.promise; return MemoryWorkspaceFiles.prototype.readDirectory.call(files, path); });
	const first = f.model.resolve(f.root, ''), second = f.model.resolve(alias, '');
	await setImmediate(); assert.equal(reads.mock.callCount(), 1); gate.resolve(); await Promise.all([first, second]);
	const local = f.model.children(f.root, '')!, other = f.model.children(alias, '')!;
	assert.ok(local !== other && local[0].root === f.root && other[0].root === alias);
	assert.equal(local[0].workspacePath, other[0].workspacePath);
	assert.ok(f.model.children(f.root, '') === local && f.model.children(alias, '') === other);
});

test('refresh status does not discard acknowledged directory membership; only a successful observation can remove an entry', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace');
	await files.write('fixture/project/keep.txt', { contents: 'keep', updatedAt: 1 }, false);
	await files.write('fixture/project/removed.txt', { contents: 'removed later', updatedAt: 1 }, false);
	const f = fixture(t, files); await f.model.resolve(f.root, '');
	const acknowledged = f.model.children(f.root, '');
	const failure = new Error('Fixture refresh permission denied');
	const read = t.mock.method(files, 'readDirectory', async () => { await gate.promise; throw failure; });
	const refresh = f.model.refresh(f.root, ''); await setImmediate();
	assert.equal(f.model.get(f.root, '')!.status, 'loading'); assert.ok(f.model.children(f.root, '') === acknowledged);
	gate.resolve(); await refresh;
	assert.equal(f.model.get(f.root, '')!.status, 'error'); assert.ok(f.model.children(f.root, '') === acknowledged);
	read.mock.restore(); await files.delete('fixture/project/removed.txt'); await f.model.refresh(f.root, '');
	assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path), ['keep.txt']);
});

test('missing and failed directory reads remain distinct from a successfully resolved empty directory', async t => {
	const files = new MemoryWorkspaceFiles('workspace'), f = fixture(t, files);
	const missingReads = t.mock.method(files, 'readDirectory');
	await f.model.resolve(f.root, ''); assert.equal(f.model.get(f.root, '')!.status, 'missing');
	await f.model.resolve(f.root, ''); assert.equal(missingReads.mock.callCount(), 1);
	missingReads.mock.restore();
	const failure = new Error('Fixture directory permission denied');
	const read = t.mock.method(files, 'readDirectory', async () => { throw failure; });
	await f.model.refresh(f.root, '');
	const failed = f.model.get(f.root, ''); assert.ok(failed?.status === 'error'); assert.equal(failed.error, failure);
	assert.equal(f.model.children(f.root, ''), undefined);
	await f.model.resolve(f.root, ''); assert.equal(read.mock.callCount(), 1, 'an explicit refresh, not frame observation, owns retry');
	read.mock.restore(); await files.createDirectory('fixture/project'); await f.model.refresh(f.root, '');
	assert.equal(f.model.get(f.root, '')!.status, 'ready'); assert.deepEqual(f.model.children(f.root, ''), []);
});

test('a replacement admission at the same project path cannot reuse its retired root or pending observation', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'); await files.write('fixture/project/old.txt', { contents: 'old', updatedAt: 1 }, false);
	const f = fixture(t, files); let first = true;
	t.mock.method(files, 'readDirectory', async path => {
		const entries = await MemoryWorkspaceFiles.prototype.readDirectory.call(files, path);
		if (first) { first = false; await gate.promise; }
		return entries;
	});
	const oldRead = f.model.resolve(f.root, ''); await setImmediate();
	const context = f.catalog.getContext(f.root.contextId);
	f.catalog.contexts.delete(context.id); f.catalog.admitContext({ ...context, admission: { ...context.admission } });
	const current = f.model.rootForContext(context.id)!;
	assert.ok(current !== f.root); assert.equal(f.model.isCurrent(f.root), false); assert.equal(f.model.get(current, ''), undefined);
	files.records.delete('fixture/project/old.txt'); files.records.set('fixture/project/current.txt', { contents: 'current', updatedAt: 2 });
	const currentRead = f.model.resolve(current, ''); gate.resolve(); await Promise.all([oldRead, currentRead]);
	assert.deepEqual(f.model.children(current, '')!.map(entry => entry.path), ['current.txt']);
});

test('only acknowledged namespace mutations refresh a loaded parent; failed creates cannot publish a folder', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'); await files.createDirectory('fixture/project');
	const f = fixture(t, files); await f.model.resolve(f.root, '');
	await f.model.resolve(f.root, 'empty'); assert.equal(f.model.get(f.root, 'empty')!.status, 'missing');
	const events: unknown[] = []; f.records.onDidChange(event => events.push(event));
	t.mock.method(files, 'createDirectory', async path => {
		await gate.promise; await MemoryWorkspaceFiles.prototype.createDirectory.call(files, path);
	});
	const creating = f.model.createDirectory(f.model.directory(f.root, ''), 'empty');
	await setImmediate(); assert.equal(events.length, 0); assert.deepEqual(f.model.children(f.root, ''), []);
	assert.equal(f.model.get(f.root, 'empty')!.status, 'missing');
	gate.resolve(); const created = await creating; await f.model.resolve(f.root, '');
	assert.equal(created.workspacePath, 'fixture/project/empty'); assert.equal(events.length, 1);
	await f.model.resolve(f.root, 'empty'); assert.equal(f.model.get(f.root, 'empty')!.status, 'ready');
	assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path), ['empty']);
	await assert.rejects(f.model.createDirectory(f.model.directory(f.root, ''), 'empty'));
	assert.equal(events.length, 1); assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path), ['empty']);
	await f.records.write('fixture/project/raw.bin', { contents: 'exact bytes', updatedAt: 1 }, false); await f.model.resolve(f.root, '');
	assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path).sort(), ['empty', 'raw.bin']);
	await f.records.delete('fixture/project/raw.bin'); await f.model.resolve(f.root, '');
	assert.deepEqual(f.model.children(f.root, '')!.map(entry => entry.path), ['empty']);
});

test('retiring a directory owner cannot publish an old read into a replacement owner at the same source paths', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'); await files.createDirectory('fixture/project/old');
	const f = fixture(t, files);
	t.mock.method(files, 'readDirectory', async path => { await gate.promise; return MemoryWorkspaceFiles.prototype.readDirectory.call(files, path); });
	let publications = 0; f.model.onDidChange(() => { publications++; });
	const pending = f.model.resolve(f.root, ''); await setImmediate();
	f.model.dispose(); const retiredPublications = publications;
	const replacementFiles = new MemoryWorkspaceFiles('workspace'); await replacementFiles.createDirectory('fixture/project/current');
	const replacementRecords = new WorkspaceRecords(replacementFiles), replacement = new WorkspaceDirectoryModel(replacementRecords, f.catalog);
	t.after(async () => { replacement.dispose(); await replacementRecords.close(); });
	const root = replacement.rootForContext(f.root.contextId)!;
	assert.equal(f.model.isCurrent(f.root), false); assert.equal(replacement.isCurrent(f.root), false);
	await replacement.resolve(root, ''); gate.resolve(); await pending;
	assert.equal(publications, retiredPublications); assert.deepEqual(replacement.children(root, '')!.map(entry => entry.path), ['current']);
});

test('a project admitted at the workspace root refreshes its already loaded child directory after a file is created', async t => {
	const files = new MemoryWorkspaceFiles('workspace'); await files.createDirectory('empty');
	const f = fixture(t, files, '');
	await f.model.resolve(f.root, ''); await f.model.resolve(f.root, 'empty');
	await f.records.write('empty/new.lua', { contents: 'return true\n', updatedAt: 1 }, false);
	await f.model.resolve(f.root, 'empty');
	assert.deepEqual(f.model.children(f.root, 'empty')!.map(entry => [entry.path, entry.workspacePath]), [['empty/new.lua', 'empty/new.lua']]);
});

test('WorkspaceRecords publishes mkdir admission before provider reentrancy and drains accepted work at close', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'), records = new WorkspaceRecords(files); t.after(() => records.close());
	let closing: Promise<void> | undefined, closed = false;
	t.mock.method(files, 'createDirectory', async path => {
		closing = records.close().then(() => { closed = true; });
		await gate.promise; await MemoryWorkspaceFiles.prototype.createDirectory.call(files, path);
	});
	const creating = records.createDirectory('fixture/project/accepted');
	await setImmediate(); assert.ok(closing !== undefined); assert.equal(closed, false);
	assert.throws(() => records.createDirectory('fixture/project/rejected'), /shutdown/);
	assert.throws(() => records.readDirectory('fixture/project'), /shutdown/);
	gate.resolve(); await creating; await closing;
	assert.equal(closed, true); assert.deepEqual(await files.readDirectory('fixture/project'), [{ name: 'accepted', type: 'directory' }]);
	assert.equal(files.records.size, 0);
});

test('retiring the directory presentation does not cancel an accepted physical folder creation', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const files = new MemoryWorkspaceFiles('workspace'), f = fixture(t, files);
	t.mock.method(files, 'createDirectory', async path => { await gate.promise; await MemoryWorkspaceFiles.prototype.createDirectory.call(files, path); });
	const creating = f.model.createDirectory(f.model.directory(f.root, ''), 'accepted/empty');
	await setImmediate(); f.model.dispose(); let closed = false;
	const closing = f.records.close().then(() => { closed = true; });
	await setImmediate(); assert.equal(closed, false); gate.resolve(); await creating; await closing;
	assert.deepEqual(await files.readDirectory('fixture/project/accepted'), [{ name: 'empty', type: 'directory' }]);
	assert.equal(files.records.size, 0);
});

test('real empty directories survive provider and model reopening, while file/directory collisions and project escapes fail', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-directory-owner-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const f = fixture(t, new DiskWorkspaceRecordProvider(directory));
	const created = await f.model.createDirectory(f.model.directory(f.root, ''), 'empty/nested');
	assert.equal(created.path, 'empty/nested');
	assert.deepEqual(f.model.children(f.root, 'empty')!.map(entry => entry.path), ['empty/nested']);
	await assert.rejects(f.model.createDirectory(f.model.directory(f.root, ''), 'empty/nested'));
	await f.records.write('fixture/project/file', { contents: 'not a directory', updatedAt: 1 }, false);
	await assert.rejects(f.model.createDirectory(f.model.directory(f.root, ''), 'file'));
	await assert.rejects(f.model.createDirectory(f.model.directory(f.root, ''), 'file/child'));
	await assert.rejects(async () => f.model.createDirectory(f.model.directory(f.root, ''), '../outside'));
	f.model.dispose(); await f.records.close();
	const records = new WorkspaceRecords(new DiskWorkspaceRecordProvider(directory)), reopened = new WorkspaceDirectoryModel(records, f.catalog);
	t.after(async () => { reopened.dispose(); await records.close(); });
	const root = reopened.rootForContext(f.root.contextId)!;
	await reopened.resolve(root, 'empty'); await reopened.resolve(root, 'empty/nested');
	assert.deepEqual(reopened.children(root, 'empty')!.map(entry => [entry.path, entry.type]), [['empty/nested', 'directory']]);
	assert.deepEqual(reopened.children(root, 'empty/nested'), []);
});
