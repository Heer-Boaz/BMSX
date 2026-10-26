import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { WorkspaceProjects } from '../../hosts/node/workspace/projects';
import type { StudioProjectAdmission } from '../../hosts/common/studio_projects';

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-project-admission-'));
	const owners = new Set<WorkspaceProjects>();
	t.after(async () => {
		await Promise.all([...owners].map(owner => owner.close()));
		await rm(directory, { recursive: true, force: true });
	});
	const root = join(directory, 'workspace'), stateDirectory = join(directory, 'studio-state');
	await mkdir(join(root, 'machine/bios'), { recursive: true });
	await mkdir(join(root, 'carts/alpha/src'), { recursive: true });
	await mkdir(join(root, 'carts/alpha/res/manifest'), { recursive: true });
	await mkdir(join(root, 'carts/beta'), { recursive: true });
	await writeFile(join(root, 'carts/alpha/src/main.lua'), 'return 1\n');
	await writeFile(join(root, 'carts/alpha/res/manifest/manifest.rommanifest'), 'title: Alpha\n');
	return { directory, root, stateDirectory, owners, databasePath: join(stateDirectory, 'source-contexts.sqlite'),
		open(storage = stateDirectory) {
			const owner = new WorkspaceProjects(root, storage);
			owners.add(owner);
			return owner;
		},
	};
}

test('source admission persists identity outside authored configuration and build generations', async t => {
	const f = await fixture(t);
	const projects = f.open();
	const first = await projects.resolveCartridge('alpha');
	assert.equal(first.cartridge.projectRoot, 'carts/alpha');
	assert.equal(first.system.projectRoot, 'machine/bios');
	assert.notEqual(first.cartridge.id, first.system.id);
	await assert.rejects(access(join(f.root, 'carts/alpha/entry.lua')), { code: 'ENOENT' });
	assert.deepEqual(await projects.resolveCartridge('alpha'), first);
	await writeFile(join(f.root, 'carts/alpha/src/main.lua'), 'return 2\n');
	await writeFile(join(f.root, 'carts/alpha/res/manifest/manifest.rommanifest'), 'title: Reconfigured\n');
	await writeFile(join(f.root, 'machine/bios/main.lua'), 'return "new BIOS generation"\n');
	await projects.close(); f.owners.delete(projects);
	assert.deepEqual(await f.open().resolveCartridge('alpha'), first);
	const independent = await f.open(join(f.directory, 'another-studio')).resolveCartridge('alpha');
	assert.notEqual(independent.cartridge.id, first.cartridge.id);
	assert.notEqual(independent.system.id, first.system.id);
});

test('target discovery assigns no source identities', async t => {
	const f = await fixture(t);
	await mkdir(join(f.root, 'carts/Invalid'));
	await writeFile(join(f.root, 'carts/not_a_directory'), 'not a project');
	const projects = f.open();
	assert.deepEqual(await projects.targets(), ['alpha', 'beta']);
	const database = new DatabaseSync(f.databasePath);
	try {
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM source_contexts').get()!.count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM system_selection').get()!.count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cartridge_selections').get()!.count, 0);
	} finally { database.close(); }
});

test('concurrent project admissions share the selected BIOS and retain distinct cartridge identities', async t => {
	const f = await fixture(t);
	const projects = f.open();
	const [alpha, beta, repeated] = await Promise.all([
		projects.resolveCartridge('alpha'), projects.resolveCartridge('beta'), projects.resolveCartridge('alpha'),
	]);
	assert.equal(alpha.system.id, beta.system.id);
	assert.notEqual(alpha.cartridge.id, beta.cartridge.id);
	assert.deepEqual(repeated, alpha);
	const restarted = f.open();
	assert.deepEqual(await restarted.resolveCartridge('alpha'), alpha);
	assert.deepEqual(await restarted.resolveCartridge('beta'), beta);
});

test('explicit selections distinguish contexts with identical roots and expose configured target aliases', async t => {
	const f = await fixture(t);
	const projects = f.open();
	const first = await projects.resolveCartridge('alpha');
	const duplicate = { id: randomUUID(), projectRoot: first.cartridge.projectRoot };
	const anotherSystem = { id: randomUUID(), projectRoot: first.system.projectRoot };
	const database = new DatabaseSync(f.databasePath);
	try {
		const insert = database.prepare('INSERT INTO source_contexts(id, project_root) VALUES (?, ?)');
		insert.run(duplicate.id, duplicate.projectRoot);
		insert.run(anotherSystem.id, anotherSystem.projectRoot);
		database.prepare('UPDATE system_selection SET context_id = ? WHERE singleton = 1').run(anotherSystem.id);
		database.prepare('INSERT INTO cartridge_selections(target, context_id) VALUES (?, ?)').run('alpha_variant', duplicate.id);
	} finally { database.close(); }
	const original = await projects.resolveCartridge('alpha');
	const variant = await projects.resolveCartridge('alpha_variant');
	assert.equal(original.cartridge.id, first.cartridge.id);
	assert.equal(variant.cartridge.id, duplicate.id);
	assert.equal(original.cartridge.projectRoot, variant.cartridge.projectRoot);
	assert.equal(original.system.id, anotherSystem.id);
	assert.equal(variant.system.id, anotherSystem.id);
	await assert.rejects(access(join(f.root, 'carts/alpha_variant')), { code: 'ENOENT' });
	assert.deepEqual(await projects.targets(), ['alpha', 'alpha_variant', 'beta']);
});

test('failed admission transaction leaves no partial contexts or selections', async t => {
	const f = await fixture(t);
	const projects = f.open();
	const database = new DatabaseSync(f.databasePath);
	try {
		database.exec(`CREATE TRIGGER reject_cartridge BEFORE INSERT ON cartridge_selections
			BEGIN SELECT RAISE(ABORT, 'fixture rejects cartridge admission'); END;`);
		await assert.rejects(projects.resolveCartridge('alpha'), /fixture rejects cartridge admission/);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM source_contexts').get()!.count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM system_selection').get()!.count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cartridge_selections').get()!.count, 0);
		database.exec('DROP TRIGGER reject_cartridge');
		const admitted = await projects.resolveCartridge('alpha');
		assert.deepEqual(await f.open().resolveCartridge('alpha'), admitted);
	} finally { database.close(); }
});

test('separate live owners preserve every admitted target without stale metadata overwrites', async t => {
	const f = await fixture(t);
	const a = f.open(), b = f.open();
	const alpha = await a.resolveCartridge('alpha');
	const beta = await b.resolveCartridge('beta');
	const gamma = await a.resolveCartridge('gamma');
	const restarted = f.open();
	assert.deepEqual(await restarted.resolveCartridge('alpha'), alpha);
	assert.deepEqual(await restarted.resolveCartridge('beta'), beta);
	assert.deepEqual(await restarted.resolveCartridge('gamma'), gamma);
	assert.equal(alpha.system.id, beta.system.id);
	assert.equal(beta.system.id, gamma.system.id);
});

test('separate processes synchronize first admission to the same committed identities', { timeout: 15000 }, async t => {
	const f = await fixture(t);
	const childPath = join(f.directory, 'admit.mjs');
	const ownerModule = new URL('../../hosts/node/workspace/projects.ts', import.meta.url).href;
	await writeFile(childPath, `import { WorkspaceProjects } from ${JSON.stringify(ownerModule)};
		process.send({ type: 'ready' });
		process.once('message', async () => {
			const owner = new WorkspaceProjects(process.argv[2], process.argv[3]);
			try { process.send({ type: 'admitted', value: await owner.resolveCartridge('alpha') }); }
			finally { await owner.close(); process.disconnect(); }
		});`);
	const children = [0, 1].map(() => {
		const child = fork(childPath, [f.root, f.stateDirectory], {
			execArgv: ['--import', createRequire(import.meta.url).resolve('tsx')], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		});
		const exited = once(child, 'exit');
		t.after(async () => { child.kill(); await exited; });
		let stderr = '';
		child.stderr!.on('data', bytes => { stderr += bytes; });
		const ready = Promise.withResolvers<void>(), admitted = Promise.withResolvers<StudioProjectAdmission>();
		child.on('message', (message: { type: string; value: StudioProjectAdmission }) => {
			if (message.type === 'ready') ready.resolve();
			else admitted.resolve(message.value);
		});
		child.once('error', error => { ready.reject(error); admitted.reject(error); });
		child.once('exit', code => {
			if (code !== 0) {
				const error = new Error(`Admission child exited ${code}: ${stderr}`);
				ready.reject(error); admitted.reject(error);
			}
		});
		return { child, ready: ready.promise, admitted: admitted.promise, exited };
	});
	const results = Promise.all(children.map(child => child.admitted));
	await Promise.all(children.map(child => child.ready));
	for (const child of children) child.child.send('admit');
	const [first, second] = await results;
	await Promise.all(children.map(child => child.exited));
	assert.deepEqual(first, second);
	assert.deepEqual(await f.open().resolveCartridge('alpha'), first);
});

test('malformed Studio database fails instead of admitting replacement identities', async t => {
	const f = await fixture(t);
	await mkdir(f.stateDirectory);
	const bytes = 'not a SQLite database';
	await writeFile(f.databasePath, bytes);
	assert.throws(() => f.open(), /not a database/);
	assert.equal(await readFile(f.databasePath, 'utf8'), bytes);
});

test('exclusive cartridge creation returns the persisted source admission without overwriting authored files', async t => {
	const f = await fixture(t);
	await mkdir(join(f.root, 'carts/emptycart/res/manifest'), { recursive: true });
	const source = '-- authored template\nreturn 1\n';
	await writeFile(join(f.root, 'carts/emptycart/entry.lua'), source);
	await writeFile(join(f.root, 'carts/emptycart/res/manifest/manifest.rommanifest'), 'title: Empty\n');
	const projects = f.open();
	const created = await projects.createCartridge('created');
	assert.equal(await readFile(join(f.root, created.entryPath), 'utf8'), source);
	const admitted = await f.open().resolveCartridge('created');
	assert.equal(created.sourceContextId, admitted.cartridge.id);
	assert.equal(created.projectRoot, admitted.cartridge.projectRoot);
	await writeFile(join(f.root, created.entryPath), '-- edited after creation\n');
	await assert.rejects(projects.createCartridge('created'), { code: 'EEXIST' });
	assert.equal(await readFile(join(f.root, created.entryPath), 'utf8'), '-- edited after creation\n');
});

test('close joins accepted successful and failed creations before releasing the admission database', async t => {
	const f = await fixture(t);
	await mkdir(join(f.root, 'carts/emptycart/res/manifest'), { recursive: true });
	const source = '-- creation accepted before close\nreturn 1\n';
	await writeFile(join(f.root, 'carts/emptycart/entry.lua'), source);
	await writeFile(join(f.root, 'carts/emptycart/res/manifest/manifest.rommanifest'), 'title: Empty\n');
	const projects = f.open();
	const accepted = projects.createCartridge('created');
	const failed = assert.rejects(projects.createCartridge('alpha'), { code: 'EEXIST' });
	const closing = projects.close();
	const late = assert.rejects(projects.createCartridge('late'), /closing/);
	await closing;
	const created = await accepted;
	await failed;
	await late;
	assert.equal(await readFile(join(f.root, created.entryPath), 'utf8'), source);
	await assert.rejects(access(join(f.root, 'carts/late')), { code: 'ENOENT' });
	const reopened = await f.open().resolveCartridge('created');
	assert.equal(reopened.cartridge.id, created.sourceContextId);
	assert.equal(reopened.cartridge.projectRoot, created.projectRoot);
});

test('an accepted target listing completes from its selection snapshot while the database closes', async t => {
	const f = await fixture(t);
	const projects = f.open();
	const listing = projects.targets();
	await projects.close();
	assert.deepEqual(await listing, ['alpha', 'beta']);
});
