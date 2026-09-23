import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/** Offline issuer for the real pinned CLI. It never authorizes an account or produces credentials. */
export async function createCodexAccountFixture(t: TestContext, options: { relayMode?: string; attempts?: ('pending' | 'failure' | 'held-start')[] } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-account-'));
	const requests: string[] = [];
	const attempts = options.attempts ?? ['pending'];
	const heldStart = Promise.withResolvers<void>();
	let releaseStart!: () => void, started = 0;
	const code = (response: ServerResponse, id: number) => response.writeHead(200, { 'Content-Type': 'application/json' })
		.end(JSON.stringify({ device_auth_id: String(id), user_code: 'ABCD-EFGH', interval: '1' }));
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
		requests.push(request.url!);
		if (request.url === '/api/accounts/deviceauth/usercode') {
			const id = started++;
			assert.ok(id < attempts.length, 'every login attempt is explicit');
			if (attempts[id] === 'held-start') { releaseStart = () => { code(response, id); }; heldStart.resolve(); }
			else code(response, id);
		} else if (request.url === '/api/accounts/deviceauth/token') {
			response.writeHead(attempts[Number(body.device_auth_id)] === 'failure' ? 500 : 403).end();
		} else { response.writeHead(500).end(); assert.fail(`Unexpected account request: ${request.url}`); }
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const executable = join(root, 'relay'), trace = join(root, 'trace');
	await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve('tests/helpers/codex_account_relay.mjs'))} ${JSON.stringify(url)} ${JSON.stringify(options.relayMode ?? 'normal')} ${JSON.stringify(trace)} "$@"\n`, { mode: 0o700 });
	return { root, requests, url, executable, trace, heldStart: heldStart.promise, releaseStart: () => releaseStart() };
}
