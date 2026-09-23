import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexProfile } from '../../hosts/node/codex/profile';
import { CodexPolicy } from '../../hosts/node/codex/policy';
import { CodexStdio } from '../../hosts/node/codex/stdio';
import { CodexSession } from '../../hosts/node/codex/session';
import type { CodexLogin, CodexSessionEvent } from '../../hosts/node/codex/protocol';

import { createCodexAccountFixture } from '../helpers/codex_account_fixture';
import { CODEX_ACCOUNT_FIXTURE, createCodexAccountProxy } from '../helpers/codex_account_proxy';

test('real pinned device-code contract polls and cancels without credentials or an OAuth callback listener', { timeout: 15000 }, async t => {
	const f = await createCodexAccountFixture(t), profile = await CodexProfile.acquire(join(f.root, 'profile'));
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
	const f = await createCodexAccountFixture(t, { relayMode: mode }), events: CodexSessionEvent[] = [];
	let changed!: () => void;
	const accountChanged = new Promise<void>(resolve => { changed = resolve; });
	const session = await CodexSession.open({ signal: t.signal, profileDirectory: join(f.root, 'profile'), executable: f.executable, tools: [],
		executeTool: async () => assert.fail('No tools in account tests'), onEvent: event => { events.push(event); if (event.type === 'account-changed') changed(); } });
	t.after(async () => { const exit = await session.close(); assert.equal(exit.forced, false); await rm(f.root, { recursive: true }); });
	return { ...f, session, events, accountChanged };
}

test('adapter exposes only the user code, cancels by process-owned login ID and reads the updated account snapshot', { timeout: 15000 }, async t => {
	const f = await sessionFixture(t, 'normal');
	await f.session.startLogin();
	assert.deepEqual(f.events.find(event => event.type === 'login-started'), { type: 'login-started', code: 'ABCD-EFGH' });
	await assert.rejects(f.session.startTurn('Not while authenticating', []), /account operation/);
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

test('successful real device-code exchange persists only the private profile and logout revokes it through unchanged TLS URLs', { timeout: 30000 }, async t => {
	let session: CodexSession | undefined;
	t.after(async () => { if (session) assert.equal((await session.close()).forced, false); });
	const f = await createCodexAccountProxy(t), events: CodexSessionEvent[] = [];
	const changed = Promise.withResolvers<void>();
	session = await CodexSession.open({ signal: t.signal, executable: f.executable, profileDirectory: join(f.root, 'profile'), tools: [],
		executeTool: async () => assert.fail('No source tools while authenticating'),
		onEvent: event => { events.push(event); if (event.type === 'account-changed') changed.resolve(); } });
	assert.equal((await session.readAccount()).account, null);
	await session.startLogin();
	assert.deepEqual(events.at(-1), { type: 'login-started', code: 'TEST-CODE' });
	f.authorize(); await changed.promise;
	assert.ok(events.some(event => event.type === 'login-completed' && event.success));
	const account = await session.readAccount();
	assert.deepEqual(account.account, { type: 'chatgpt', email: CODEX_ACCOUNT_FIXTURE.email, planType: CODEX_ACCOUNT_FIXTURE.planType });
	assert.equal(account.requiresOpenaiAuth, true);
	const path = join(f.root, 'profile/account/auth.json');
	const saved = JSON.parse(await readFile(path, 'utf8'));
	assert.equal(saved.tokens.access_token, CODEX_ACCOUNT_FIXTURE.accessToken);
	assert.equal(saved.tokens.refresh_token, CODEX_ACCOUNT_FIXTURE.refreshToken);
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.equal((await session.close()).forced, false);
	session = await CodexSession.open({ signal: t.signal, executable: f.executable, profileDirectory: join(f.root, 'profile'), tools: [],
		executeTool: async () => assert.fail('No source tools while authenticating'), onEvent: event => events.push(event) });
	assert.deepEqual((await session.readAccount()).account, account.account, 'an explicit new process uses only the persisted Studio profile');
	await session.signOut();
	assert.equal((await session.readAccount()).account, null);
	await assert.rejects(access(path), { code: 'ENOENT' });
	assert.equal(f.requests.filter(request => request.path === '/oauth/token').length, 1);
	assert.equal(f.requests.filter(request => request.path === '/oauth/revoke').length, 1);
	assert.ok(f.tunnels.includes('auth.openai.com:443') && f.tunnels.includes('chatgpt.com:443'));
	assert.ok(!JSON.stringify(events).includes(CODEX_ACCOUNT_FIXTURE.accessToken));
	assert.ok(!JSON.stringify(events).includes(CODEX_ACCOUNT_FIXTURE.refreshToken));
});

for (const operation of ['startTurn', 'startLogin', 'signOut'] as const) {
	test(`account refresh rejects ${operation} before publishing the pending account transition`, { timeout: 30000 }, async t => {
		let session: CodexSession | undefined, checked = false;
		t.after(async () => { if (session) assert.equal((await session.close()).forced, false); });
		const f = await createCodexAccountProxy(t), admission = Promise.withResolvers<void>(), changed = Promise.withResolvers<void>();
		const message = operation === 'startTurn' ? /Finish the current conversation\/account operation/ : operation === 'startLogin'
			? /Finish the current account\/conversation/ : /Finish or cancel the current operation/;
		session = await CodexSession.open({ signal: t.signal, executable: f.executable, profileDirectory: join(f.root, 'profile'), tools: [],
			executeTool: async () => assert.fail('No source tools while authenticating'), onEvent: event => {
				if (event.type === 'account-changed') changed.resolve();
				if (event.type !== 'account-refreshing' || checked) return;
				checked = true;
				// A command can arrive before the browser receives this notification.
				admission.resolve(assert.rejects(operation === 'startTurn' ? session!.startTurn('Do not submit during an account transition', [])
					: session![operation](), message));
			} });
		await session.startLogin(); f.authorize();
		await admission.promise; await changed.promise;
		assert.ok((await session.readAccount()).account, 'the rejected operation leaves the successful account transition intact');
		await session.signOut();
		assert.equal((await session.readAccount()).account, null, 'the current account snapshot releases operation admission');
		assert.equal(f.requests.filter(request => request.path === '/api/accounts/deviceauth/usercode').length, 1);
		assert.equal(f.requests.filter(request => request.path === '/oauth/revoke').length, 1);
	});
}
