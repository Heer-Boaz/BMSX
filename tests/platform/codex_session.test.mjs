import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSession } from '../../hosts/node/codex/session.ts';
import { CodexProfile } from '../../hosts/node/codex/profile.ts';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';

const tools = [{ name: 'studio_read', description: 'Read the current Studio source context',
	inputSchema: { type: 'object', properties: { resource: { type: 'string' } }, required: ['resource'], additionalProperties: false } }];
const readCall = { type: 'function_call', call_id: 'source-read', name: 'studio_read', arguments: '{"resource":"cart.lua"}' };

async function fixture(t, steps, executeTool, prepare) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-session-'));
	const profileDirectory = join(root, 'studio');
	await mkdir(join(profileDirectory, 'account'), { recursive: true });
	if (prepare) await prepare(root, profileDirectory);
	const model = await createCodexModelFixture(t, steps);
	const events = [], waiters = [];
	const lifetime = new AbortController();
	const options = { profileDirectory, signal: lifetime.signal, provider: { name: 'Offline Studio fixture', model: 'mock-model', baseUrl: `${model.url}/v1` },
		tools, executeTool, onEvent(event) {
			events.push(event);
			for (let i = waiters.length - 1; i >= 0; --i) {
				if (waiters[i].predicate(event)) { waiters[i].resolve(event); waiters.splice(i, 1); }
			}
		} };
	let session;
	t.after(async () => {
		try {
			if (session) {
				const exit = await session.close();
				assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.forced, false);
			}
		} finally { await rm(root, { recursive: true }); }
	});
	return { root, profileDirectory, model, events, options, lifetime,
		async open() { session = await CodexSession.open(options); return session; },
		wait(predicate) {
			const existing = events.find(predicate);
			return existing ? Promise.resolve(existing) : new Promise(resolve => waiters.push({ predicate, resolve }));
		} };
}

test('owned process serves a live Studio receipt, has no builtin tool surface and joins its private lifetime', { timeout: 15000 }, async t => {
	let signal;
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE], async (call, turnSignal) => {
		signal = turnSignal;
		assert.deepEqual(call.arguments, { resource: 'cart.lua' });
		return { success: true, text: 'UNSAVED SOURCE RECEIPT' };
	});
	const session = await f.open();
	assert.equal((await session.readAccount()).account, null);
	const turnId = await session.startTurn('Read my Studio working copy', []);
	const completed = await f.wait(event => event.type === 'turn-completed');
	assert.equal(completed.turn.id, turnId); assert.equal(completed.turn.status, 'completed');
	assert.equal(signal.aborted, true, 'completed turns no longer carry source/tool rights');
	assert.deepEqual(f.model.requests[0].tools.map(tool => tool.name), ['studio_read']);
	assert.equal(f.model.requests[1].input.find(item => item.type === 'function_call_output').output, 'UNSAVED SOURCE RECEIPT');
	assert.equal(f.events.find(event => event.type === 'message').text, 'Contract fixture finished.');
	assert.equal((await stat(f.profileDirectory)).mode & 0o777, 0o700);
	assert.deepEqual(await readdir(join(f.profileDirectory, 'lease', 'workspace')), [], 'no filesystem copy of the source');
	const closed = session.close();
	assert.equal(session.close(), closed, 'one process join and profile release');
	await closed;
	await assert.rejects(access(join(f.profileDirectory, 'lease')), { code: 'ENOENT' });
	assert.equal(f.events.filter(event => event.type === 'closed').length, 1);
	await assert.rejects(session.startTurn('Late prompt', []), /closed/);
});

test('late tool results cannot answer an interrupted turn or acquire the next turn rights', { timeout: 15000 }, async t => {
	let resolveTool, called;
	const toolStarted = new Promise(resolve => { called = resolve; });
	let signal;
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE], async (_call, turnSignal) => {
		signal = turnSignal; called();
		return new Promise(resolve => { resolveTool = resolve; });
	});
	const session = await f.open();
	await session.startTurn('Wait at source read', []); await toolStarted;
	await assert.rejects(session.startTurn('Concurrent prompt', []), /already active/);
	await session.interrupt();
	assert.equal(signal.aborted, true);
	assert.equal((await f.wait(event => event.type === 'turn-completed')).turn.status, 'interrupted');
	const second = await session.startTurn('New turn, new rights', []);
	resolveTool({ success: true, text: 'FORBIDDEN LATE SOURCE' });
	await f.wait(event => event.type === 'turn-completed' && event.turn.id === second);
	assert.equal(f.model.requests.length, 2);
	assert.doesNotMatch(JSON.stringify(f.model.requests[1]), /FORBIDDEN LATE SOURCE/);
});

test('disconnect cancels an unanswered tool immediately and drains EOF without a model retry', { timeout: 15000 }, async t => {
	let resolveTool, called, signal;
	const toolStarted = new Promise(resolve => { called = resolve; });
	const f = await fixture(t, [[readCall]], (_call, turnSignal) => {
		signal = turnSignal; called();
		return new Promise(resolve => { resolveTool = resolve; });
	});
	const session = await f.open();
	await session.startTurn('Wait for source', []); await toolStarted;
	const closed = session.close();
	assert.equal(signal.aborted, true, 'retirement must not wait for the process');
	resolveTool({ success: true, text: 'LATE' });
	await closed;
	assert.equal(f.model.requests.length, 1);
});

test('interrupt during turn admission cannot race into a later model request', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail());
	const session = await f.open();
	const starting = assert.rejects(session.startTurn('Cancel before admission completes', []), /interrupted/);
	await session.interrupt();
	await starting;
	assert.equal(f.model.requests.length, 0);
	assert.equal(f.events.filter(event => event.type === 'turn-started').length, 0);
});

test('unowned profile MCP is rejected before thread creation; empty-map merge is not authority', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail('No tools may be admitted'), async (root, profile) => {
		const program = join(root, 'ambient.mjs');
		await writeFile(program, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root, 'started'))},'unsafe');`);
		await writeFile(join(profile, 'account', 'config.toml'), `[mcp_servers.ambient]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(program)}]\nrequired=true\n`);
	});
	await assert.rejects(f.open(), /Unowned Codex configuration layer: user/);
	await assert.rejects(access(join(f.root, 'started')), { code: 'ENOENT' });
	await assert.rejects(access(join(f.profileDirectory, 'lease')), { code: 'ENOENT' });
	assert.equal(f.model.requests.length, 0);
	assert.match(await readFile(join(f.profileDirectory, 'account', 'config.toml'), 'utf8'), /mcp_servers/, 'admission must not repair user configuration');
});

test('even harmless profile overrides are not silently merged into the owned policy', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail(), async (_root, profile) => {
		await writeFile(join(profile, 'account', 'config.toml'), 'model_reasoning_effort="low"\n');
	});
	await assert.rejects(f.open(), /Unowned Codex configuration layer/);
	assert.equal(f.model.requests.length, 0);
});

test('configuration changed after connection is readmitted before a turn, without a model request', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail());
	const session = await f.open();
	await writeFile(join(f.profileDirectory, 'account', 'config.toml'), 'developer_instructions="Unowned context"\n');
	await assert.rejects(session.startTurn('Do not admit this', []), /Unowned Codex configuration layer/);
	assert.equal(f.model.requests.length, 0);
});

test('lease cancellation closes an admitted process and a cancelled open never acquires a profile', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail());
	await f.open();
	f.lifetime.abort(new Error('Workspace disconnected'));
	assert.match((await f.wait(event => event.type === 'closed')).error.message, /Workspace disconnected/);
	await assert.rejects(f.open(), /Workspace disconnected/);
	await assert.rejects(access(join(f.profileDirectory, 'lease')), { code: 'ENOENT' });
});

test('a different CLI version is rejected before launching App Server and releases its lease', { timeout: 15000 }, async t => {
	const f = await fixture(t, [], () => assert.fail());
	const executable = join(f.root, 'wrong-codex');
	await writeFile(executable, '#!/bin/sh\necho "codex-cli 0.0.0"\n', { mode: 0o700 });
	f.options.executable = executable;
	await assert.rejects(f.open(), /requires codex-cli 0.156.1/);
	await assert.rejects(access(join(f.profileDirectory, 'lease')), { code: 'ENOENT' });
	assert.equal(f.model.requests.length, 0);
});

test('profile lease excludes concurrent processes and filters ambient environment without copying credentials', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-profile-'));
	t.after(() => rm(root, { recursive: true }));
	const profile = await CodexProfile.acquire(root);
	try {
		assert.equal(profile.env.CODEX_HOME, join(root, 'account'));
		assert.equal(profile.env.HOME, join(root, 'lease', 'home'));
		assert.deepEqual(Object.keys(profile.env).sort(),
			['CODEX_HOME', 'HOME', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].sort());
		assert.deepEqual(await readdir(profile.codexHome), []);
		await assert.rejects(CodexProfile.acquire(root), { code: 'EEXIST' });
	} finally { await profile.release(); }
	const next = await CodexProfile.acquire(root);
	await next.release();
});

test('unadvertised shell, patch, skills and permission attempts cannot bypass Studio tools', { timeout: 15000 }, async t => {
	const attempts = [
		{ type: 'function_call', call_id: 'shell', name: 'exec_command', arguments: '{"cmd":"touch CANARY"}' },
		{ type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: CANARY\n+bad\n*** End Patch' },
		{ type: 'function_call', call_id: 'skills', name: 'skills.read', arguments: '{"package":"/etc","resource":"passwd"}' },
		{ type: 'function_call', call_id: 'permission', name: 'request_permissions', arguments: '{}' },
	];
	const f = await fixture(t, [attempts, CODEX_FIXTURE_DONE], () => assert.fail('These are not Studio tools'));
	const session = await f.open();
	await session.startTurn('Adversarial fixture', []);
	await f.wait(event => event.type === 'turn-completed');
	const outputs = f.model.requests[1].input.filter(item => item.type.endsWith('call_output'));
	assert.equal(outputs.length, attempts.length);
	for (const output of outputs) assert.match(output.output, /unsupported|unknown|not found/i);
	await assert.rejects(access(join(f.profileDirectory, 'lease', 'workspace', 'CANARY')), { code: 'ENOENT' });
});
