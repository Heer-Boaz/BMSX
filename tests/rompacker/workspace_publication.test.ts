import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, open, readFile, readdir, rm, stat, symlink, utimes, writeFile, type FileHandle } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { handleWorkspaceRequest } from '../../scripts/dev/workspace_api.mjs';
import { HttpError } from '../../scripts/dev/http_security.mjs';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { collectCartSourceFiles } from '../../scripts/rompacker/cart_source_files';
import { DiskWorkspaceRecordProvider } from '../../ide/node/workspace_records';
import { discoverWorkspaceSourceFiles } from '../../ide/workspace/source_files';

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-workspace-publication-'));
	const server = createServer((request, response) => {
		void handleWorkspaceRequest(root, request, response, new URL(request.url!, 'http://localhost')).catch(error => {
			response.writeHead(error instanceof HttpError ? error.status : 500).end(error.message);
		});
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(async () => {
		server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	});
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const save = (path: string, contents: string, updatedAt: number, exclusive = false) => fetch(address, {
		method: 'PUT', headers: { 'Content-Type': 'application/json', ...(exclusive ? { 'If-None-Match': '*' } : {}) },
		body: JSON.stringify({ path, contents, updatedAt }),
	});
	const createDirectory = (path: string) => fetch(`${address}?directory=${encodeURIComponent(path)}`, { method: 'POST' });
	return { root, save, createDirectory };
}

test('directory creation persists an empty namespace entry with implicit parents and an exclusive final name', async t => {
	const { root, createDirectory } = await fixture(t), provider = new DiskWorkspaceRecordProvider(root);
	await provider.createDirectory('cart/new/empty');
	assert.deepEqual(await provider.readDirectory('cart/new'), [{ name: 'empty', type: 'directory' }]);
	assert.deepEqual(await provider.readDirectory('cart/new/empty'), []);
	assert.equal((await stat(join(root, 'cart/new/empty'))).isDirectory(), true);
	await assert.rejects(provider.createDirectory('cart/new/empty'), { code: 'EEXIST' });
	assert.equal((await createDirectory('cart/new/empty')).status, 412);
	assert.equal((await createDirectory('cart/http/empty')).status, 204);
	const reopened = new DiskWorkspaceRecordProvider(root);
	assert.deepEqual(await reopened.readDirectory('cart/http/empty'), []);
	assert.deepEqual((await prepareRomInputs([root], [])).resourceFiles, [], 'empty directories do not manufacture source records');
});

test('native and HTTP directory creation share final-name admission and preserve file collisions', async t => {
	const { root, createDirectory } = await fixture(t), provider = new DiskWorkspaceRecordProvider(root);
	const raced = await Promise.allSettled([provider.createDirectory('raced'), createDirectory('raced').then(response => {
		if (response.status !== 204) throw new Error(`Directory was refused: ${response.status}`);
	})]);
	assert.deepEqual(raced.map(result => result.status).sort(), ['fulfilled', 'rejected']);
	assert.deepEqual(await provider.readDirectory('raced'), []);
	await writeFile(join(root, 'file.lua'), 'return true\n');
	await assert.rejects(provider.createDirectory('file.lua'), { code: 'EEXIST' });
	await assert.rejects(provider.createDirectory('file.lua/child'));
	assert.equal((await createDirectory('file.lua')).status, 412);
	assert.equal((await createDirectory('file.lua/child')).ok, false);
	assert.equal(await readFile(join(root, 'file.lua'), 'utf8'), 'return true\n');
});

test('HTTP directory creation retains rooted path and symbolic-link admission', async t => {
	const { root, createDirectory } = await fixture(t);
	const outside = await mkdtemp(join(tmpdir(), 'bmsx-workspace-outside-'));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await symlink(outside, join(root, 'external'), 'dir');
	for (const [path, status] of [['../escape', 403], ['/absolute', 400], ['invalid\0path', 400], ['external/empty', 403], ['external', 403]] as const) {
		assert.equal((await createDirectory(path)).status, status);
	}
	assert.deepEqual(await readdir(outside), []);
	assert.deepEqual(await readdir(root), ['external']);
});

test('build capture during Save sees the previous complete file, then the newly published source and timestamp', async t => {
	const { root, save } = await fixture(t);
	const path = join(root, 'map.yaml'), previous = 'rooms: [old]\n', next = 'rooms: [new]\n';
	await writeFile(path, previous); await utimes(path, 100, 100); await chmod(path, 0o751);
	const reader = await open(path, 'r');
	t.after(() => reader.close());
	const prototype = Object.getPrototypeOf(reader), write = prototype.writeFile;
	const writing = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
	t.mock.method(prototype, 'writeFile', async function (this: FileHandle, ...args: unknown[]) {
		writing.resolve(); await resume.promise; return write.apply(this, args);
	});
	const saving = save('map.yaml', next, 200000);
	try {
		await writing.promise;
		const captured = await prepareRomInputs([root], []);
		assert.deepEqual(captured.resourceFiles, [path], 'staging files are not ROM inputs');
		assert.equal(captured.files.get(path)!.text, previous);
		assert.equal(captured.files.get(path)!.modifiedMs, 100000);
	} finally { resume.resolve(); }
	assert.equal((await saving).status, 204);
	const published = await prepareRomInputs([root], []);
	assert.deepEqual(published.resourceFiles, [path]);
	assert.equal(published.files.get(path)!.text, next);
	assert.equal(published.files.get(path)!.modifiedMs, 200000);
	assert.equal(await reader.readFile('utf8'), previous, 'an already opened input keeps its original inode and bytes');
	assert.equal((await stat(path)).mode & 0o777, 0o751);
	assert.deepEqual(await readdir(join(root, '.bmsx/saves')), []);
});

test('exclusive creation stays outside build inputs until the complete source is published', async t => {
	const { root, save } = await fixture(t);
	const handle = await open(root, 'r'), prototype = Object.getPrototypeOf(handle), write = prototype.writeFile;
	await handle.close();
	const writing = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
	t.mock.method(prototype, 'writeFile', async function (this: FileHandle, ...args: unknown[]) {
		writing.resolve(); await resume.promise; return write.apply(this, args);
	});
	const saving = save('new.yaml', 'rooms: [new]\n', 200000, true);
	try {
		await writing.promise;
		assert.deepEqual((await prepareRomInputs([root], [])).resourceFiles, []);
	} finally { resume.resolve(); }
	assert.equal((await saving).status, 204);
	assert.equal((await save('new.yaml', 'rooms: [other]\n', 300000, true)).status, 412);
	assert.equal(await readFile(join(root, 'new.yaml'), 'utf8'), 'rooms: [new]\n');
	assert.equal((await stat(join(root, 'new.yaml'))).mtimeMs, 200000);
	assert.deepEqual(await readdir(join(root, '.bmsx/saves')), []);
});

test('an incomplete failed Save never changes the previous source or publishes a new file', async t => {
	const { root, save } = await fixture(t);
	const path = join(root, 'map.yaml'), previous = 'rooms: [old]\n';
	await writeFile(path, previous); await utimes(path, 100, 100);
	const handle = await open(path, 'r'), prototype = Object.getPrototypeOf(handle), write = prototype.writeFile;
	await handle.close();
	t.mock.method(prototype, 'writeFile', async function (this: FileHandle) {
		await write.call(this, 'rooms: [');
		throw Object.assign(new Error('test disk full'), { code: 'ENOSPC' });
	});
	assert.equal((await save('map.yaml', 'rooms: [new]\n', 200000)).status, 500);
	assert.equal((await save('new.yaml', 'rooms: [new]\n', 200000, true)).status, 500);
	const captured = await prepareRomInputs([root], []);
	assert.deepEqual(captured.resourceFiles, [path]);
	assert.equal(captured.files.get(path)!.text, previous);
	assert.equal(captured.files.get(path)!.modifiedMs, 100000);
	assert.deepEqual(await readdir(join(root, '.bmsx/saves')), []);
});

test('atomic replacement does not bypass a read-only destination', async t => {
	const { root, save } = await fixture(t);
	const path = join(root, 'map.yaml');
	await writeFile(path, 'rooms: [old]\n'); await chmod(path, 0o444);
	assert.equal((await save('map.yaml', 'rooms: [new]\n', 200000)).status, 500);
	assert.equal(await readFile(path, 'utf8'), 'rooms: [old]\n');
	assert.equal((await stat(path)).mode & 0o777, 0o444);
});

test('direct disk saves publish bytes and timestamps together through the same owner', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-disk-publication-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const provider = new DiskWorkspaceRecordProvider(root);
	const path = join(root, 'entry.lua');
	await writeFile(path, 'return 1'); await utimes(path, 100, 100);
	const handle = await open(path, 'r'), prototype = Object.getPrototypeOf(handle), setTimes = prototype.utimes;
	await handle.close();
	const timestamping = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
	t.mock.method(prototype, 'utimes', async function (this: FileHandle, ...args: unknown[]) {
		timestamping.resolve(); await resume.promise; return setTimes.apply(this, args);
	});
	const saving = provider.write('entry.lua', { contents: 'return 2', updatedAt: 200000 }, true);
	try {
		await timestamping.promise;
		const files = collectCartSourceFiles([root]);
		assert.deepEqual(files, [path], 'filesystem source discovery excludes staging');
		assert.deepEqual(await discoverWorkspaceSourceFiles(provider, '', false), ['entry.lua'], 'Studio source discovery excludes staging');
		const captured = await prepareRomInputs([root], files);
		assert.deepEqual(captured.resourceFiles, [path]);
		assert.equal(captured.files.get(path)!.text, 'return 1');
		assert.equal(captured.files.get(path)!.modifiedMs, 100000);
	} finally { resume.resolve(); }
	await saving;
	assert.deepEqual(await provider.read('entry.lua'), { contents: 'return 2', updatedAt: 200000 });
	await assert.rejects(provider.write('entry.lua', { contents: 'return 3', updatedAt: 300000 }, false), /File already exists/);
	assert.deepEqual(await provider.read('entry.lua'), { contents: 'return 2', updatedAt: 200000 });
	assert.deepEqual(await readdir(join(root, '.bmsx/saves')), []);
});
