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

test('owned process serves a live Studio receipt, advertises the Studio tools and joins its private lifetime', { timeout: 15000 }, async t => {
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
	// Studio's own tools reach the model alongside the CLI's, which this policy now enables.
	assert.ok(f.model.requests[0].tools.map(tool => tool.name).includes('studio_read'));
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

test('native queue dispatch and direct steering preserve one thread and exact user message order', { timeout: 20000 }, async t => {
	let release, called;
	const requested = new Promise(resolve => { called = resolve; });
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE, CODEX_FIXTURE_DONE], () => {
		called(); return new Promise(resolve => { release = resolve; });
	});
	const session = await f.open();
	const turn = await session.startTurn('First message', []); await requested;
	await session.enqueue('Queued original', [{ review: 'observed-review', state: 'discarded', reason: '' }]);
	const queue = await f.wait(event => event.type === 'queue' && event.messages.length === 1);
	await session.updateQueued(queue.messages[0].id, 'Queued edited 🐉');
	await session.enqueue('Remove this message', []);
	const two = await f.wait(event => event.type === 'queue' && event.messages.length === 2);
	await session.deleteQueued(two.messages[1].id);
	assert.equal(await session.steer(turn, 'Direct correction', []), turn);
	release({ success: true, text: 'Fresh source result' });
	const next = await f.wait(event => event.type === 'turn-started' && event.turnId !== turn);
	await f.wait(event => event.type === 'turn-completed' && event.turn.id === next.turnId);
	assert.equal(f.model.requests.length, 3, 'only explicit first/direct/queued work reaches the model');
	assert.deepEqual(f.events.filter(event => event.type === 'user-message').map(event => event.text), ['First message', 'Direct correction', 'Queued edited 🐉']);
	assert.doesNotMatch(JSON.stringify(f.model.requests), /Remove this message|Queued original/);
	assert.match(JSON.stringify(f.model.requests[1].input), /Direct correction/);
	assert.match(JSON.stringify(f.model.requests[2].input), /observed-review/, 'editing queued text preserves its submitted review observations');
	await assert.rejects(session.updateQueued(queue.messages[0].id, 'Too late to edit'), /already been dispatched/);
	await assert.rejects(session.deleteQueued(queue.messages[0].id), /already been dispatched/);
	await assert.rejects(session.steer(turn, 'Too late', []), /no longer accepting/);
	const history = await session.listHistory();
	assert.equal(history.threads.length, 1);
	const opened = await session.selectThread(history.threads[0].id);
	assert.deepEqual(opened.entries.filter(entry => entry.kind === 'user').map(entry => entry.text), ['First message', 'Direct correction', 'Queued edited 🐉']);
	assert.equal(f.model.requests.length, 3, 'history is not inference');
});

test('Stop and process exit persist queued text; cold history browsing never starts it', { timeout: 20000 }, async t => {
	let called;
	const requested = new Promise(resolve => { called = resolve; });
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE], () => { called(); return new Promise(() => {}); });
	let session = await f.open();
	const turn = await session.startTurn('Persist this conversation', []); await requested;
	await session.enqueue('Keep this queued across reconnect', []);
	const queued = await f.wait(event => event.type === 'queue' && event.messages.length === 1);
	const stopping = session.interrupt();
	assert.equal(session.interrupt(), stopping, 'coalesce repeated Stop while admission is in flight');
	await stopping;
	await f.wait(event => event.type === 'turn-completed' && event.turn.id === turn);
	await session.close();
	session = await f.open();
	const first = await session.listHistory();
	assert.equal(first.threads.length, 1);
	assert.equal((await session.listHistory(undefined, 'Persist')).threads.length, 1);
	const page = await session.selectThread(first.threads[0].id);
	assert.ok(page.entries.some(entry => entry.kind === 'user' && entry.text === 'Persist this conversation'));
	assert.equal(f.events.filter(event => event.type === 'queue').at(-1).messages[0].id, queued.messages[0].id);
	assert.equal(f.model.requests.length, 1, 'metadata and queue inspection do not resume work');
	await session.enqueue('Add while cold and paused', []);
	const coldQueue = await f.wait(event => event.type === 'queue' && event.messages.length === 2);
	await session.updateQueued(coldQueue.messages[1].id, 'Edit while cold and paused');
	await f.wait(event => event.type === 'queue' && event.messages[1]?.text === 'Edit while cold and paused');
	await session.deleteQueued(coldQueue.messages[1].id);
	assert.equal(f.model.requests.length, 1, 'cold queue mutations still do not resume inference');
	const next = await session.startTurn('', [], true);
	await f.wait(event => event.type === 'turn-completed' && event.turn.id === next);
	assert.equal(f.model.requests.length, 2);
	assert.ok(f.model.requests[1].tools.map(tool => tool.name).includes('studio_read'), 'the real resumed thread retains its Studio tools');
	assert.match(JSON.stringify(f.model.requests[1].input), /Persist this conversation/);
	await session.selectThread();
	assert.equal((await session.listHistory()).threads.length, 1, 'New neither deletes nor synthesizes old history');
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
		// A held lease is refused and says how to recover, rather than surfacing a bare EEXIST.
		await assert.rejects(CodexProfile.acquire(root), /Another Studio owns the Codex account profile/);
	} finally { await profile.release(); }
	const next = await CodexProfile.acquire(root);
	// The owner releases its own lease even when it is signalled away, so a killed Studio
	// does not leave the next one permanently refused.
	assert.equal(process.listeners('exit').length, 1);
	await next.release();
	assert.equal(process.listeners('exit').length, 0);
	await assert.rejects(access(join(root, 'lease')), { code: 'ENOENT' });
});

test('unadvertised shell, patch, skills and permission attempts cannot bypass Studio tools', { timeout: 15000 }, async t => {
	const attempts = [
		{ type: 'function_call', call_id: 'shell', name: 'exec_command', arguments: '{"cmd":"touch CANARY"}' },
		{ type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: CANARY\n+bad\n*** End Patch' },
		{ type: 'function_call', call_id: 'skills', name: 'skills.read', arguments: '{"package":"/etc","resource":"passwd"}' },
		{ type: 'function_call', call_id: 'permission', name: 'request_permissions', arguments: '{}' },
		{ type: 'function_call', call_id: 'image', name: 'view_image', arguments: '{"path":"CANARY.png"}' },
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

test('disconnect during active work pauses the durable queue before joining; browsing never drains it', { timeout: 20000 }, async t => {
	let called;
	const toolStarted = new Promise(resolve => { called = resolve; });
	const f = await fixture(t, [[readCall]], () => { called(); return new Promise(() => {}); });
	let session = await f.open();
	await session.startTurn('Close while busy', []); await toolStarted;
	await session.enqueue('Must wait after disconnect', []);
	await session.close();
	session = await f.open();
	const history = await session.listHistory();
	await session.selectThread(history.threads[0].id);
	assert.deepEqual(f.events.filter(event => event.type === 'queue').at(-1).messages.map(message => message.text), ['Must wait after disconnect']);
	assert.equal(f.model.requests.length, 1);
});

test('Stop at the completed-to-queued boundary revokes next-turn tools and keeps waiting text', { timeout: 20000 }, async t => {
	let called, release;
	const toolStarted = new Promise(resolve => { called = resolve; });
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE, [readCall]], (_call, signal) => {
		signal.throwIfAborted(); called(); return new Promise(resolve => { release = resolve; });
	});
	let session, stopping;
	const emit = f.options.onEvent;
	f.options.onEvent = event => {
		emit(event);
		if (event.type === 'turn-completed' && event.turn.status === 'completed') stopping = session.interrupt();
	};
	session = await f.open();
	await session.startTurn('First boundary turn', []); await toolStarted;
	await session.enqueue('Waiting boundary turn', []);
	release({ success: true, text: 'Read complete' });
	await f.wait(event => event.type === 'turn-completed' && event.turn.status === 'completed'); await stopping;
	await session.close();
	session = await f.open();
	const history = await session.listHistory();
	const page = await session.selectThread(history.threads[0].id);
	const consumed = page.entries.some(entry => entry.kind === 'user' && entry.text === 'Waiting boundary turn');
	const queue = f.events.filter(event => event.type === 'queue').at(-1).messages;
	assert.equal(queue.length, consumed ? 0 : 1, 'native Stop may interrupt an already dispatched turn, never duplicate or lose unconsumed text');
	assert.ok(f.model.requests.length <= 3, 'no retry or browser/provider dequeue loop');
});

test('history loads older turn pages explicitly without extra inference or duplicate messages', { timeout: 30000 }, async t => {
	const f = await fixture(t, Array.from({ length: 22 }, () => CODEX_FIXTURE_DONE), () => assert.fail());
	const session = await f.open();
	for (let index = 0; index < 22; index++) {
		const turn = await session.startTurn(`Page turn ${index}`, []);
		await f.wait(event => event.type === 'turn-completed' && event.turn.id === turn);
	}
	const history = await session.listHistory();
	const current = await session.selectThread(history.threads[0].id);
	assert.notEqual(current.nextCursor, null);
	const older = await session.readOlder(current.nextCursor);
	assert.equal(older.nextCursor, null);
	assert.deepEqual([...older.entries, ...current.entries].filter(entry => entry.kind === 'user').map(entry => entry.text), Array.from({ length: 22 }, (_, index) => `Page turn ${index}`));
	assert.equal(f.model.requests.length, 22);
});
