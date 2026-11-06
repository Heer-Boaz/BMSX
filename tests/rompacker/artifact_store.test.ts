import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { link, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { RomArtifact } from '../../toolchain/ts/rompack/build_manifest';
import { RomArtifactStore } from '../../scripts/rompacker/artifacts';
import { withArtifactStoreLock } from '../../scripts/rompacker/artifact_lock';
import { publishArtifact as publish } from '../helpers/rom_artifact';

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-artifact-store-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return new RomArtifactStore(root);
}

test('publication shares immutable output bytes but exports remain independent writable files', async t => {
	const store = await fixture(t), first = await publish(store, 1), second = await publish(store, 2);
	const a = join(store.directory(first.id), 'system/bios.rom'), b = join(store.directory(second.id), 'system/bios.rom');
	assert.equal((await stat(a)).ino, (await stat(b)).ino);
	assert.equal((await stat(a)).mode & 0o222, 0);
	const output = join(store.root, 'export'); await store.withSharedAccess(() => store.export(first, output));
	const copy = join(output, 'system/bios.rom');
	assert.notEqual((await stat(copy)).ino, (await stat(a)).ino); assert.ok(((await stat(copy)).mode & 0o200) !== 0);
	await writeFile(copy, 'an external mutable export');
	assert.equal(await readFile(a, 'utf8'), 'identical BIOS bytes'); assert.equal(await readFile(b, 'utf8'), 'identical BIOS bytes');
});

test('concurrent identical publication converges on one immutable bundle and one blob per distinct output', async t => {
	const store = await fixture(t);
	const [first, second] = await Promise.all([publish(store, 1), publish(store, 1)]);
	assert.equal(first.id, second.id); assert.equal((await readdir(join(store.root, 'artifacts'))).length, 1);
	assert.equal((await readdir(join(store.root, 'blobs'))).length, 2);
	assert.equal(await readFile(join(store.directory(first.id), 'test.rom'), 'utf8'), 'cartridge test 1');
});

test('a rejected export removes its private temporary copy without changing an existing destination', async t => {
	const store = await fixture(t), artifact = await publish(store, 1), output = join(store.root, 'export');
	await mkdir(join(output, 'test.rom'), { recursive: true });
	await assert.rejects(store.withSharedAccess(() => store.export(artifact, output)));
	assert.equal((await stat(join(output, 'test.rom'))).isDirectory(), true);
	assert.equal((await readdir(output)).some(name => name.endsWith('.tmp')), false);
});

test('existing files are fully verified and deduplicated without changing a receipt or artifact path', async t => {
	const store = await fixture(t), first = await publish(store, 1, 'test', true), second = await publish(store, 2, 'test', true);
	const paths = [first, second].map(artifact => join(store.directory(artifact.id), 'system/bios.rom'));
	const receipts = await Promise.all([first, second].map(artifact => readFile(join(store.directory(artifact.id), 'artifact.json'), 'utf8')));
	const before = await store.deduplicate(false);
	assert.equal(before.linkedFiles, 0); assert.ok(before.storedBytes > before.uniqueBytes);
	assert.notEqual((await stat(paths[0])).ino, (await stat(paths[1])).ino);
	const result = await store.deduplicate(true); assert.equal(result.linkedFiles, 1);
	assert.equal((await stat(paths[0])).ino, (await stat(paths[1])).ino);
	assert.deepEqual(await Promise.all([first, second].map(artifact => readFile(join(store.directory(artifact.id), 'artifact.json'), 'utf8'))), receipts);
	assert.equal((await store.deduplicate(true)).linkedFiles, 0);
});

test('a mismatching existing payload fails before maintenance changes any file', async t => {
	const store = await fixture(t), first = await publish(store, 1, 'test', true);
	await writeFile(join(store.directory(first.id), 'test.rom'), 'changed outside the store');
	await assert.rejects(store.deduplicate(true), /differs from its receipt/);
	assert.equal((await stat(join(store.directory(first.id), 'system/bios.rom'))).nlink, 1);
});

test('a mismatching canonical blob cannot replace a verified existing artifact during deduplication', async t => {
	const store = await fixture(t), first = await publish(store, 1, 'test', true);
	await mkdir(join(store.root, 'blobs'));
	await writeFile(join(store.root, 'blobs', first.system.outputs[0].digest), 'different bytes');
	await assert.rejects(store.deduplicate(true), /Shared artifact content differs/);
	assert.equal(await readFile(join(store.directory(first.id), 'system/bios.rom'), 'utf8'), 'identical BIOS bytes');
});

test('pre-existing exports retain the matching older artifact rather than assuming the newest build is installed', async t => {
	const store = await fixture(t), old = await publish(store, 1), latest = await publish(store, 2);
	const output = join(store.root, 'export'); await store.withSharedAccess(() => store.export(old, output));
	assert.deepEqual(await store.withSharedAccess(() => store.retainExistingExports(output, false)), [old.id]);
	await store.withSharedAccess(() => store.retainExistingExports(output, true));
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: true })).removed, []);
	await store.withSharedAccess(async () => { await store.export(latest, output); await store.retainExport(latest, output); });
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: true })).removed, [old.id]);
});

test('retention keeps recent builds, latest recipes and live/publication references while retiring cache keys and orphan blobs', async t => {
	const store = await fixture(t), artifacts: RomArtifact[] = [];
	for (let version = 1; version <= 6; version++) artifacts.push(await publish(store, version));
	const other = await publish(store, 0, 'other');
	await store.withSharedAccess(async () => {
		await store.retain('sessions/live', artifacts[0].id); await store.retain('publications/site', artifacts[1].id);
	});
	await writeFile(join(store.root, 'actions', artifacts[2].system.key), artifacts[2].id);
	const planned = await store.collect({ keepRecent: 2, apply: false }); assert.equal(planned.removed.length, 2);
	assert.equal((await readdir(join(store.root, 'artifacts'))).length, 7);
	const result = await store.collect({ keepRecent: 2, apply: true });
	assert.deepEqual(new Set(result.removed), new Set([artifacts[2].id, artifacts[3].id]));
	for (const artifact of [artifacts[0], artifacts[1], artifacts[4], artifacts[5], other]) assert.equal((await store.read(artifact.id)).id, artifact.id);
	assert.equal(await store.find(artifacts[2].cart!.key), undefined); assert.equal(result.removedBlobs, 2);
	assert.ok((await store.find(artifacts[2].system.key)) !== undefined, 'a retained identical BIOS remains a cache hit');
	await store.withSharedAccess(() => store.release('sessions/live'));
	assert.deepEqual((await store.collect({ keepRecent: 2, apply: true })).removed, [artifacts[0].id]);
});

test('parallel readers coexist and exclusive collection waits without blocking the event loop', async t => {
	const store = await fixture(t), a = Promise.withResolvers<void>(), b = Promise.withResolvers<void>();
	const firstReady = Promise.withResolvers<void>(), secondReady = Promise.withResolvers<void>();
	const first = store.withSharedAccess(async () => { firstReady.resolve(); await a.promise; }); await firstReady.promise;
	const second = store.withSharedAccess(async () => { secondReady.resolve(); await b.promise; }); await secondReady.promise;
	let collected = false;
	const collection = withArtifactStoreLock(store.root, 'exclusive', async () => { collected = true; });
	a.resolve(); await first; assert.equal(collected, false);
	b.resolve(); await second; await collection; assert.equal(collected, true);
});

test('one collection retires abandoned publication stages and their otherwise unreferenced blobs', async t => {
	const store = await fixture(t), stage = store.staging('abandoned'), bytes = Buffer.from('unfinished publication');
	await store.withSharedAccess(async () => {
		await mkdir(stage, { recursive: true }); await mkdir(join(store.root, 'blobs'));
		await writeFile(join(stage, 'partial.rom'), bytes);
		await link(join(stage, 'partial.rom'), join(store.root, 'blobs', createHash('sha256').update(bytes).digest('hex')));
	});
	const result = await store.collect({ keepRecent: 1, apply: true });
	assert.equal(result.removedBlobs, 1); assert.equal(result.reclaimedBlobBytes, bytes.length);
	assert.deepEqual(await readdir(join(store.root, 'blobs')), []);
});

test('a killed reader process releases its collection lock without a stale PID file or manual recovery', { timeout: 10000 }, async t => {
	const store = await fixture(t), module = pathToFileURL(resolve('scripts/rompacker/artifact_lock.ts')).href;
	const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
		import { withArtifactStoreLock } from ${JSON.stringify(module)};
		await withArtifactStoreLock(${JSON.stringify(store.root)}, 'shared', async () => {
			process.send('ready'); setInterval(() => {}, 1000); await new Promise(() => {});
		});
	`], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
	const exited = once(child, 'exit');
	t.after(async () => { child.kill('SIGKILL'); await exited; });
	await once(child, 'message');
	const collection = store.collect({ keepRecent: 1, apply: true });
	child.kill('SIGKILL'); await exited; await collection;
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: false })).removed, []);
});
