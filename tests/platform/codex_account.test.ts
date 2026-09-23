import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProfile } from '../../hosts/node/codex/profile';
import { CodexPolicy } from '../../hosts/node/codex/policy';
import { CodexStdio } from '../../hosts/node/codex/stdio';
import { CodexSession } from '../../hosts/node/codex/session';
import type { CodexLogin, CodexSessionEvent } from '../../hosts/node/codex/protocol';

async function issuer(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-account-'));
	const requests: string[] = [];
	const server = createServer(async (request, response) => {
		for await (const _part of request) { /* Drain actual Codex JSON request. */ }
		requests.push(request.url!);
		if (request.url === '/api/accounts/deviceauth/usercode') response.writeHead(200, { 'Content-Type': 'application/json' })
			.end(JSON.stringify({ device_auth_id: 'fixture-auth-id', user_code: 'ABCD-EFGH', interval: '1' }));
		else if (request.url === '/api/accounts/deviceauth/token') response.writeHead(403).end();
		else { response.writeHead(500).end(); assert.fail(`Unexpected account request: ${request.url}`); }
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	return { root, requests, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

test('real pinned device-code contract polls and cancels without credentials or an OAuth callback listener', { timeout: 15000 }, async t => {
	const f = await issuer(t), profile = await CodexProfile.acquire(join(f.root, 'profile'));
	const policy = new CodexPolicy();
	const messages: string[] = [];
	// The issuer override exists only in this contract test; production profile.env does not admit it.
	assert.equal(profile.env.CODEX_APP_SERVER_LOGIN_ISSUER, undefined);
	const rpc = new CodexStdio('codex', policy.args, profile.cwd, { ...profile.env, CODEX_APP_SERVER_LOGIN_ISSUER: f.url }, message => messages.push(message.method!));
	t.after(async () => { const exit = await rpc.stop(); assert.equal(exit.forced, false); assert.equal(exit.code, 0); await profile.release(); await rm(f.root, { recursive: true }); });
	await rpc.request('initialize', { clientInfo: { name: 'bmsx_account_contract', version: '1' }, capabilities: { experimentalApi: true } });
	rpc.send({ method: 'initialized', params: {} });
	const login = await rpc.request<CodexLogin>('account/login/start', { type: 'chatgptDeviceCode' });
	assert.equal(login.type, 'chatgptDeviceCode'); assert.equal(login.userCode, 'ABCD-EFGH'); assert.equal(login.verificationUrl, `${f.url}/codex/device`);
	assert.deepEqual(await rpc.request('account/login/cancel', { loginId: login.loginId }), { status: 'canceled' });
	await rpc.request('account/logout', {});
	assert.deepEqual(await rpc.request('account/read', { refreshToken: false }), { account: null, requiresOpenaiAuth: true, workspaceRouting: null });
	assert.ok(f.requests.includes('/api/accounts/deviceauth/usercode'));
	assert.ok(messages.includes('account/login/completed'));
	await assert.rejects(access(join(profile.codexHome, 'auth.json')), { code: 'ENOENT' });
});

async function sessionFixture(t: TestContext, mode: string) {
	const f = await issuer(t), events: CodexSessionEvent[] = [];
	let changed!: () => void;
	const accountChanged = new Promise<void>(resolve => { changed = resolve; });
	const executable = join(f.root, 'relay'), trace = join(f.root, 'trace');
	await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve('tests/helpers/codex_account_relay.mjs'))} ${JSON.stringify(f.url)} ${JSON.stringify(mode)} ${JSON.stringify(trace)} "$@"\n`, { mode: 0o700 });
	const session = await CodexSession.open({ signal: t.signal, profileDirectory: join(f.root, 'profile'), executable, tools: [],
		executeTool: async () => assert.fail('No tools in account tests'), onEvent: event => { events.push(event); if (event.type === 'account-changed') changed(); } });
	t.after(async () => { const exit = await session.close(); assert.equal(exit.forced, false); await rm(f.root, { recursive: true }); });
	return { ...f, session, events, trace, accountChanged };
}

test('adapter exposes only the user code, cancels by process-owned login ID and reads the updated account snapshot', { timeout: 15000 }, async t => {
	const f = await sessionFixture(t, 'normal');
	await f.session.startLogin();
	assert.deepEqual(f.events.find(event => event.type === 'login-started'), { type: 'login-started', code: 'ABCD-EFGH' });
	await assert.rejects(f.session.startTurn('Not while authenticating'), /account operation/);
	await f.session.cancelLogin(); await f.session.signOut();
	await f.accountChanged; // Notification refresh is independent of command-response ordering.
	const commands = (await readFile(f.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.deepEqual(commands.find(command => command.method === 'account/login/start').params, { type: 'chatgptDeviceCode' });
	assert.equal(commands.filter(command => command.method === 'account/login/cancel').length, 1);
	assert.ok(f.events.some(event => event.type === 'account-changed' && event.account.account === null));
	const refreshing = f.events.findIndex(event => event.type === 'account-refreshing');
	assert.ok(refreshing >= 0 && refreshing < f.events.findIndex(event => event.type === 'account-changed'));
	assert.ok(!f.events.some(event => event.type === 'login-completed'), 'canceled completion cannot revive login state');
});

test('cancel while start is pending never publishes a code or restores a canceled attempt', { timeout: 15000 }, async t => {
	const f = await sessionFixture(t, 'normal');
	const started = f.session.startLogin(), canceled = f.session.cancelLogin();
	await started; await canceled;
	assert.ok(!f.events.some(event => event.type === 'login-started' || event.type === 'login-completed'));
});

test('early external completion is correlated after its start response in the same stdout chunk', { timeout: 15000 }, async t => {
	const f = await sessionFixture(t, 'early-completion');
	await f.session.startLogin();
	assert.deepEqual(f.events.find(event => event.type === 'login-completed'), { type: 'login-completed', success: false, error: 'Fixture polling failure' });
	assert.ok(!f.events.some(event => event.type === 'login-started'), 'completed attempt cannot expose an active code');
});

test('an unadmitted authorization URL retires the process instead of forwarding a login destination', { timeout: 15000 }, async t => {
	const f = await sessionFixture(t, 'unadmitted-url');
	await assert.rejects(f.session.startLogin(), /unadmitted account authorization URL/);
	assert.ok(!f.events.some(event => event.type === 'login-started'));
	assert.match((await f.session.closed).error!.message, /unadmitted/);
});
