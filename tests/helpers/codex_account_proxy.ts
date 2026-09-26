import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { Socket } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CODEX_ACCOUNT_FIXTURE = {
	email: 'studio-fixture@example.invalid', planType: 'pro', accountId: 'studio-fixture-account',
	accessToken: 'bmsx-offline-access-token', refreshToken: 'bmsx-offline-refresh-token',
};

/**
 * A non-forwarding TLS proxy for the pinned CLI's real, unchanged account URLs.
 * Only this test executable trusts its temporary CA. No host trust store, Codex
 * configuration or RPC response is changed, and no remote connection is made.
 */
export async function createCodexAccountProxy(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-account-tls-'));
	const run = promisify(execFile), ca = join(root, 'ca.pem');
	await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
		'-keyout', join(root, 'ca.key'), '-out', ca, '-subj', '/CN=BMSX offline test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
	await run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=BMSX offline account',
		'-keyout', join(root, 'server.key'), '-out', join(root, 'server.csr')]);
	await writeFile(join(root, 'server.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:auth.openai.com,DNS:chatgpt.com\n');
	await run('openssl', ['x509', '-req', '-in', join(root, 'server.csr'), '-CA', ca, '-CAkey', join(root, 'ca.key'),
		'-set_serial', '1', '-days', '1', '-sha256', '-extfile', join(root, 'server.ext'), '-out', join(root, 'server.pem')]);
	// Matches the pinned upstream auth fixture: synthetic claims, never a real bearer credential.
	const idToken = [JSON.stringify({ alg: 'none', typ: 'JWT' }), JSON.stringify({ email: CODEX_ACCOUNT_FIXTURE.email,
		'https://api.openai.com/auth': { chatgpt_plan_type: CODEX_ACCOUNT_FIXTURE.planType,
			chatgpt_account_id: CODEX_ACCOUNT_FIXTURE.accountId, chatgpt_user_id: 'studio-fixture-user' } }), 'signature']
		.map(part => Buffer.from(part).toString('base64url')).join('.');
	const requests: { host: string; path: string; method: string; body: string }[] = [];
	const tunnels: string[] = [];
	let authorized = false;
	const server = createSecureServer({ key: await readFile(join(root, 'server.key')), cert: await readFile(join(root, 'server.pem')) }, async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const body = Buffer.concat(parts).toString('utf8'), host = request.headers.host!, path = new URL(request.url!, `https://${host}`).pathname;
		requests.push({ host, path, method: request.method!, body });
		let result: object;
		if (host === 'auth.openai.com') {
			assert.equal(request.method, 'POST', `Offline auth fixture serves token exchanges only: ${path}`);
			switch (path) {
				case '/api/accounts/deviceauth/usercode':
					authorized = false;
					result = { device_auth_id: 'fixture-auth', user_code: 'TEST-CODE', interval: '1' }; break;
				case '/api/accounts/deviceauth/token':
					assert.deepEqual(JSON.parse(body), { device_auth_id: 'fixture-auth', user_code: 'TEST-CODE' });
					if (!authorized) { response.writeHead(403).end(); return; }
					result = { authorization_code: 'fixture-code', code_challenge: 'fixture-challenge', code_verifier: 'fixture-verifier' }; break;
				case '/oauth/token': {
					const form = new URLSearchParams(body);
					// Loopback sign-in exchanges its grant, then trades the ID token for an API key.
					if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:token-exchange') {
						assert.equal(form.get('subject_token'), idToken);
						result = { access_token: 'bmsx-offline-exchanged-key' }; break;
					}
					assert.equal(form.get('grant_type'), 'authorization_code');
					assert.equal(form.get('code'), 'fixture-code');
					const redirect = new URL(form.get('redirect_uri')!);
					if (redirect.protocol === 'http:') {
						// Loopback authorization: the CLI owns the PKCE pair, so only its binding is checked.
						assert.equal(redirect.pathname, '/auth/callback');
						assert.ok(['localhost', '127.0.0.1'].includes(redirect.hostname));
						assert.ok((form.get('code_verifier') ?? '').length > 0, 'a loopback exchange proves possession of its verifier');
					} else {
						assert.equal(form.get('code_verifier'), 'fixture-verifier');
						assert.equal(form.get('redirect_uri'), 'https://auth.openai.com/deviceauth/callback');
					}
					result = { id_token: idToken, access_token: CODEX_ACCOUNT_FIXTURE.accessToken, refresh_token: CODEX_ACCOUNT_FIXTURE.refreshToken }; break;
				}
				case '/oauth/revoke':
					assert.equal(JSON.parse(body).token, CODEX_ACCOUNT_FIXTURE.refreshToken);
					assert.equal(JSON.parse(body).token_type_hint, 'refresh_token');
					result = {}; break;
				default: assert.fail(`Unexpected offline auth request: ${path}`);
			}
		} else {
			assert.equal(host, 'chatgpt.com'); assert.equal(request.method, 'GET');
			// Account-scoped reads must carry the account token. The plugin catalogue is public,
			// so it is served empty rather than asserted against a token it never carries.
			if (path.startsWith('/backend-api/plugins/')) { response.writeHead(200,
				{ 'Content-Type': 'application/json' }).end(JSON.stringify({ plugins: [], items: [] })); return; }
			assert.equal(request.headers.authorization, `Bearer ${CODEX_ACCOUNT_FIXTURE.accessToken}`,
				`account request without the account token: ${path}`);
			// Account-scoped plugin state: authorized like any account read, and empty in this fixture.
			if (path.startsWith('/backend-api/ps/plugins/')) { response.writeHead(200,
				{ 'Content-Type': 'application/json' }).end(JSON.stringify({ plugins: [] })); return; }
			switch (path) {
				case '/backend-api/codex/models': result = { models: [] }; break; // Account-only fixture advertises no models.
				case '/backend-api/wham/config/bundle': result = {}; break;
				case '/backend-api/wham/settings/user': result = { commit_attribution_enabled: false }; break;
				case '/backend-api/wham/accounts/check': result = { accounts: [{ id: CODEX_ACCOUNT_FIXTURE.accountId,
					workspace_backend_origin: 'https://chatgpt.com', account_routing_override: 'NO_CONSTRAINT' }] }; break;
				default: assert.fail(`Unexpected offline account request: ${path}`);
			}
		}
		response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
	});
	const sockets = new Set<Socket>();
	const proxy = createServer((_request, response) => { response.writeHead(403).end(); assert.fail('Offline account proxy accepts TLS CONNECT only'); });
	proxy.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
	proxy.on('connect', (request, socket, head) => {
		tunnels.push(request.url!);
		// Anything outside the pinned account hosts is refused, not forwarded: a plugin catalogue
		// or update probe may be attempted, but nothing leaves this fixture.
		if (!['auth.openai.com:443', 'chatgpt.com:443'].includes(request.url!)) {
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
		}
		socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
		if (head.length > 0) socket.unshift(head);
		server.emit('connection', socket);
	});
	proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>(resolve => proxy.close(() => resolve()));
		await rm(root, { recursive: true });
	});
	const executable = join(root, 'codex-offline-account');
	const url = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
	await writeFile(executable, `#!/bin/sh\nexport HTTPS_PROXY=${JSON.stringify(url)}\nexport HTTP_PROXY=${JSON.stringify(url)}\nexport CODEX_CA_CERTIFICATE=${JSON.stringify(ca)}\nexec codex "$@"\n`, { mode: 0o700 });
	return { root, executable, requests, tunnels, authorize: () => { authorized = true; } };
}
