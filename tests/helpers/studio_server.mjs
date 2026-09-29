import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Ordinary server/product, isolated project writes, and a canary against starting the embedded agent. */
export async function createStudioServer(t) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-studio-mcp-'));
	for (const path of ['carts/nemesis_s', 'cartlib', 'machine/bios', 'testlib', 'tests/carts/nemesis_s']) await cp(path, join(root, path), {
		recursive: true, filter: async path => (await stat(path)).isDirectory() || /\.(lua|yaml|yml)$/.test(path),
	});
	const bin = join(root, 'bin'), trace = join(root, 'embedded-codex-started');
	await mkdir(bin);
	await writeFile(join(bin, 'codex'), `#!/bin/sh\necho unexpected > ${JSON.stringify(trace)}\nexit 1\n`, { mode: 0o700 });
	const child = spawn(process.execPath, [resolve('scripts/serve-dist.mjs'), '--dir', resolve('dist'), '--port', '0'], {
		cwd: root, env: { ...process.env, NODE_OPTIONS: '', PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(root, 'state') },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exited = once(child, 'exit');
	t.after(async () => { child.kill(); await exited; await rm(root, { recursive: true }); });
	let output = '';
	const address = await new Promise((resolveAddress, reject) => {
		child.on('error', reject);
		child.on('exit', code => reject(new Error(`Studio server exited ${code}: ${output}`)));
		child.stderr.on('data', bytes => { output += bytes; });
		child.stdout.on('data', bytes => {
			output += bytes;
			const match = /http:\/\/localhost:\d+/.exec(output);
			if (match) resolveAddress(match[0].replace('localhost', '127.0.0.1'));
		});
	});
	const admission = await fetch(`${address}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } });
	const { workspaceToken } = await admission.json();
	return { root, address, trace, headers: { Authorization: `Bearer ${workspaceToken}` } };
}
