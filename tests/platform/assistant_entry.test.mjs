import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-assistant-entry-'));
	t.after(() => rm(root, { recursive: true }));
	const dist = join(root, 'dist'), bin = join(root, 'bin'), state = join(root, 'state');
	await mkdir(dist); await mkdir(bin);
	await writeFile(join(dist, 'index.html'), '<!doctype html><p>Studio entry fixture</p>');
	// Exercise the actual production entry without touching an account or opening a model connection.
	await writeFile(join(bin, 'codex'), '#!/bin/sh\n[ "$1" = "--version" ] || exit 4\necho codex-cli 0.0.0\n', { mode: 0o700 });
	return { state, args: ['--import', 'tsx', resolve('scripts/serve-dist.mjs'), '--dir', dist, '--port', '0', '--assistant'],
		env: { ...process.env, XDG_STATE_HOME: state, PATH: `${bin}:${process.env.PATH}` } };
}

test('the actual assistant entry refuses LAN binding before profile or executable access', { timeout: 15000 }, async t => {
	const f = await fixture(t);
	await assert.rejects(promisify(execFile)(process.execPath, [...f.args, '--host', '0.0.0.0'], { env: f.env, timeout: 10000 }), /requires a loopback-bound server/);
	await assert.rejects(access(f.state), { code: 'ENOENT' });
});

test('the actual assistant entry authorizes first, uses application-owned state and joins shutdown after failed admission', { timeout: 15000 }, async t => {
	const f = await fixture(t);
	const child = spawn(process.execPath, f.args, { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
	const exited = once(child, 'exit');
	t.after(async () => { child.kill(); await exited; });
	let output = '';
	const address = await new Promise((resolveAddress, reject) => {
		child.on('error', reject);
		child.on('exit', code => reject(new Error(`Studio entry exited ${code}: ${output}`)));
		child.stderr.on('data', bytes => { output += bytes; });
		child.stdout.on('data', bytes => {
			output += bytes;
			const match = /http:\/\/localhost:(\d+)/.exec(output);
			if (match) resolveAddress(`http://127.0.0.1:${match[1]}`);
		});
	});
	const endpoint = `${address}/__bmsx__/assistant/connect`;
	assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
	await assert.rejects(access(f.state), { code: 'ENOENT' });
	const admission = await fetch(`${address}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } });
	const { workspaceToken } = await admission.json();
	const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${workspaceToken}` } });
	assert.equal(response.status, 503);
	assert.match(await response.text(), /requires codex-cli 0.156.1/);
	await access(join(f.state, 'bmsx', 'studio-codex', 'account'));
	await assert.rejects(access(join(f.state, 'bmsx', 'studio-codex', 'lease')), { code: 'ENOENT' });
	child.kill();
	assert.deepEqual(await exited, [0, null], 'the entry completes its joined shutdown instead of default signal termination');
});
