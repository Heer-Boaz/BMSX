import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudioServer } from '../helpers/studio_server.mjs';

test('Studio creates an exclusive authored cartridge project without copying editor recovery', async t => {
	const server = await createStudioServer(t);
	await cp('carts/emptycart', join(server.root, 'carts/emptycart'), { recursive: true });
	const url = `${server.address}/__bmsx__/projects/fresh_cart`;
	assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
	const response = await fetch(url, { method: 'PUT', headers: server.headers });
	assert.equal(response.status, 201);
	const project = await response.json();
	assert.equal(project.projectRoot, 'carts/fresh_cart');
	const entry = await readFile(join(server.root, project.entryPath), 'utf8');
	assert.equal(entry, await readFile('carts/emptycart/entry.lua', 'utf8'));
	assert.deepEqual((await readdir(join(server.root, project.projectRoot))).sort(), ['entry.lua', 'res']);
	assert.equal((await fetch(url, { method: 'PUT', headers: server.headers })).status, 409);
	assert.equal(await readFile(join(server.root, project.entryPath), 'utf8'), entry);
	const targets = await (await fetch(`${server.address}/__bmsx__/builds/targets`, { headers: server.headers })).json();
	assert.ok(targets.includes(project.target));
	assert.equal((await fetch(`${server.address}/__bmsx__/projects/not%2Fa%2Ftarget`, { method: 'PUT', headers: server.headers })).status, 400);
});
