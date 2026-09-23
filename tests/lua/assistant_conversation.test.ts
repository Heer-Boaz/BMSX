import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { AssistantAccount, AssistantCommand, AssistantConnection, AssistantEvent } from '../../hosts/common/assistant_protocol';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { AssistantConversation } from '../../ide/workbench/services/assistant/conversation';
import { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';

class Connection implements AssistantConnection {
	public readonly lifetime = new AbortController();
	public readonly signal = this.lifetime.signal;
	public readonly closed = Promise.resolve();
	public account: AssistantAccount = { connected: false, requiresLogin: false };
	public readonly commands: AssistantCommand[] = [];
	public pending: Promise<undefined> | undefined;
	public openedLogin = 0;
	public constructor(public readonly emit: (event: AssistantEvent) => void) {}
	public async send(command: AssistantCommand) { this.commands.push(command); return this.pending; }
	public openLoginPage(): void { this.openedLogin++; }
	public close(): void { this.lifetime.abort(); }
}
function fixture(t: TestContext) {
	const models = new EditorTextModelService();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return old\n')]);
	const storage = { getItem: () => null, setItem: () => assert.fail('not Save'), removeItem: () => assert.fail('not Delete') };
	const connections: Connection[] = [];
	const model = models.retain(sources.luaResources[0], 'lua', 'return old\n');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(createTestRuntime(createTestRuntimeRomPayload())));
	const diagnostics = new ResourceDiagnosticsService(models, tooling, new VirtualHeadlessClock());
	const conversation = new AssistantConversation(models, sources, storage, diagnostics, async (_signal, emit) => {
		const connection = new Connection(emit); connections.push(connection); return connection;
	});
	t.after(() => { conversation.dispose(); diagnostics.dispose(); models.clear(); });
	return { conversation, model, models, connections };
}
async function propose(f: ReturnType<typeof fixture>) {
	const connection = f.connections.at(-1)!;
	let id = 0;
	async function tool(name: string, args: unknown) {
		const requestId = String(++id);
		connection.emit({ type: 'tool-request', requestId, name, arguments: args });
		await setImmediate();
		const reply = connection.commands.at(-1)!;
		assert.ok(reply.type === 'tool-result' && reply.requestId === requestId && reply.success, JSON.stringify(reply));
		return JSON.parse(reply.text);
	}
	const catalog = await tool('studio_list_sources', {});
	const read = await tool('studio_read_source', { resource: catalog[0].resource });
	assert.match(read.source, /unsaved/);
	await tool('studio_propose_edits', { title: 'Ordinary review', files: [{ receipt: read.receipt,
		edits: [{ offset: read.source.indexOf('old'), deleteLength: 3, text: 'new', expectedText: 'old' }] }] });
	return f.conversation.entries.findLast(entry => entry.kind === 'proposal')!.proposal!;
}

for (const outcome of ['applied', 'discarded', 'stale', 'failed'] as const) {
	test(`the next explicit prompt reports the owner's ${outcome} outcome, not a new automatic turn`, async t => {
		const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
		const connection = f.connections[0], proposal = await propose(f);
		const reply = connection.commands.at(-1)!; assert.ok(reply.type === 'tool-result');
		const receipt = JSON.parse(reply.text).review;
		assert.equal(typeof receipt, 'string');
		connection.emit({ type: 'turn-completed', turnId: 't', status: 'completed' });
		const commands = connection.commands.length;
		if (outcome === 'applied') { proposal.apply(); f.model.undo(); }
		else if (outcome === 'discarded') proposal.dispose();
		else if (outcome === 'stale') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- user\n' }]);
		else {
			t.mock.method(f.models.history, 'applyEdits', () => { throw new Error('History failure'); });
			assert.throws(() => proposal.apply(), /History failure/);
		}
		assert.equal(connection.commands.length, commands, 'review settlement cannot start inference or send provider commands');
		await c.sendPrompt('Continue 🐉');
		assert.deepEqual(connection.commands.at(-1), { type: 'start', prompt: 'Continue 🐉', reviews: [{ review: receipt, state: outcome, reason: proposal.reason }] });
		connection.emit({ type: 'turn-completed', turnId: 'next', status: 'completed' });
		await c.sendPrompt('Another explicit prompt');
		assert.deepEqual(connection.commands.at(-1), { type: 'start', prompt: 'Another explicit prompt', reviews: [] }, 'acknowledged outcomes are not replayed');
	});
}

test('a prompt snapshots pending reviews; settlement during admission remains for the following explicit prompt', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
	const connection = f.connections[0], proposal = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 't', status: 'completed' });
	let release!: () => void;
	connection.pending = new Promise(resolve => { release = () => resolve(undefined); });
	const sending = c.sendPrompt('While pending');
	const command = connection.commands.at(-1)!; assert.ok(command.type === 'start');
	assert.equal(command.reviews[0].state, 'pending');
	proposal.dispose();
	assert.equal(command.reviews[0].state, 'pending', 'the submitted snapshot cannot mutate behind the transport');
	release(); await sending; connection.pending = undefined;
	connection.emit({ type: 'turn-completed', turnId: 'next', status: 'completed' });
	await c.sendPrompt('After Discard');
	const next = connection.commands.at(-1)!; assert.ok(next.type === 'start');
	assert.deepEqual(next.reviews, [{ review: command.reviews[0].review, state: 'discarded', reason: '' }]);
});

test('known prompt rejection retains outcome evidence without automatically retrying the prompt', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
	const connection = f.connections[0], proposal = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 't', status: 'completed' }); proposal.dispose();
	connection.pending = Promise.reject(new Error('Admission denied'));
	await c.sendPrompt('Rejected prompt');
	const rejected = connection.commands.at(-1)!; assert.ok(rejected.type === 'start');
	assert.equal(connection.commands.filter(command => command.type === 'start').length, 2);
	connection.pending = undefined; await c.sendPrompt('Different, explicit prompt');
	const admitted = connection.commands.at(-1)!; assert.ok(admitted.type === 'start');
	assert.equal(admitted.reviews.length, 1); assert.deepEqual(admitted.reviews, rejected.reviews);
});

test('source-change publication during Apply is not prematurely reported as a successful review', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
	const connection = f.connections[0], proposal = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 't', status: 'completed' });
	let submitted!: Promise<void>;
	const unbind = f.model.onDidChangeContent(() => { submitted = c.sendPrompt('Observe during history publication'); });
	proposal.apply(); unbind(); await submitted;
	const during = connection.commands.at(-1)!; assert.ok(during.type === 'start');
	assert.equal(during.reviews[0].state, 'applying');
	connection.emit({ type: 'turn-completed', turnId: 'next', status: 'completed' });
	await c.sendPrompt('Observe completed history');
	const after = connection.commands.at(-1)!; assert.ok(after.type === 'start');
	assert.deepEqual(after.reviews, [{ review: during.reviews[0].review, state: 'applied', reason: '' }]);
});

test('late admission acknowledgement cannot consume a replacement connection\'s outstanding review', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Old proposal');
	const connection = f.connections[0], old = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 'old', status: 'completed' }); old.dispose();
	let release!: () => void;
	connection.pending = new Promise(resolve => { release = () => resolve(undefined); });
	const oldPrompt = c.sendPrompt('Old outcome');
	c.disconnect(); await c.connect(); await c.sendPrompt('Replacement proposal');
	const current = await propose(f); current.dispose();
	f.connections[1].emit({ type: 'turn-completed', turnId: 'current', status: 'completed' });
	release(); await oldPrompt;
	await c.sendPrompt('Replacement outcome');
	const update = f.connections[1].commands.at(-1)!; assert.ok(update.type === 'start');
	assert.equal(update.reviews.length, 1); assert.equal(update.reviews[0].state, 'discarded');
	const previous = connection.commands.at(-1)!; assert.ok(previous.type === 'start');
	assert.notEqual(update.reviews[0].review, previous.reviews[0].review);
});

test('applying one outstanding proposal reports its success and the competing proposal\'s actual staleness', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('First proposal');
	const connection = f.connections[0], first = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 'first', status: 'completed' });
	await c.sendPrompt('Second proposal, leave the first pending');
	const second = await propose(f);
	connection.emit({ type: 'turn-completed', turnId: 'second', status: 'completed' });
	first.apply();
	assert.equal(second.state, 'stale');
	await c.sendPrompt('Both review outcomes');
	const command = connection.commands.at(-1)!; assert.ok(command.type === 'start');
	assert.deepEqual(command.reviews.map(review => [review.state, review.reason]), [['applied', ''], ['stale', second.reason]]);
	assert.notEqual(command.reviews[0].review, command.reviews[1].review);
});

for (const transition of ['disconnect', 'account'] as const) {
	test(`${transition} retires review feedback along with source authority`, async t => {
		const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
		const connection = f.connections[0], proposal = await propose(f);
		connection.emit({ type: 'turn-completed', turnId: 't', status: 'completed' });
		if (transition === 'disconnect') { c.disconnect(); await c.connect(); }
		else {
			connection.emit({ type: 'account-refreshing' });
			connection.emit({ type: 'account-changed', account: { connected: false, requiresLogin: false } });
		}
		assert.equal(proposal.state, 'stale');
		await c.sendPrompt('New authority');
		assert.deepEqual(f.connections.at(-1)!.commands.at(-1), { type: 'start', prompt: 'New authority', reviews: [] });
	});
}

test('conversation hands off a source-backed proposal; completion preserves review and ordinary Undo', async t => {
	const f = fixture(t), c = f.conversation;
	assert.equal(f.connections.length, 0);
	await c.connect(); await c.sendPrompt('Make a reviewed edit');
	const proposal = await propose(f);
	f.connections[0].emit({ type: 'turn-completed', turnId: 'turn', status: 'completed' });
	assert.equal(c.state, 'ready'); assert.equal(proposal.state, 'pending');
	assert.equal(f.model.buffer.getText(), '-- unsaved\nreturn old\n');
	proposal.apply(); assert.equal(f.model.buffer.getText(), '-- unsaved\nreturn new\n');
	f.model.undo(); assert.equal(f.model.buffer.getText(), '-- unsaved\nreturn old\n');
	assert.equal(f.model.lastSavedSource, 'return old\n');
});

for (const outcome of ['applied', 'discarded', 'stale'] as const) {
	test(`conversation observes ${outcome} reviews without rereading transcript text or stealing selection`, async t => {
		const f = fixture(t), c = f.conversation;
		const input = new AssistantInput(c); t.after(() => input.dispose());
		await c.connect(); await c.sendPrompt('Review'); const proposal = await propose(f);
		f.connections[0].emit({ type: 'turn-completed', turnId: 'turn', status: 'completed' });
		// A settled old proposal must not rewrap the much larger, unchanged later transcript.
		c.entries.push({ kind: 'assistant', index: c.entries.length, text: new PieceTreeBuffer('later '.repeat(10000)), resetRevision: 0 });
		const font = {}, measure = (_text: string, start: number, end: number) => end - start;
		input.transcript.update(c.entries, 40, measure, font);
		const index = c.entries.findIndex(entry => entry.proposal === proposal);
		const heading = input.transcript.rows.findIndex(row => row.entry === index && row.heading);
		assert.equal(input.transcript.rows[heading].text, 'REVIEW: PENDING');
		const rows = input.transcript.rows.slice();
		for (const entry of c.entries) entry.text.getTextRange = () => assert.fail('settlement cannot read unchanged message text');
		input.selectedEntry = 0;
		const revision = c.revision;
		if (outcome === 'applied') proposal.apply();
		else if (outcome === 'discarded') proposal.dispose();
		else f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- user\n' }]);
		assert.equal(c.revision, revision + 1);
		assert.equal(input.selectedEntry, 0);
		input.transcript.update(c.entries, 40, () => assert.fail('no body text measurement'), font);
		assert.equal(input.transcript.rows[heading].text, `REVIEW: ${outcome.toUpperCase()}`);
		assert.ok(input.transcript.rows.every((row, index) => index === heading || row === rows[index]));
		for (let frame = 0; frame < 1000; frame++) assert.equal(input.transcript.update(c.entries, 40, measure, font), false);
		if (outcome === 'applied') { f.model.undo(); assert.equal(c.revision, revision + 1, 'Undo does not rearm a one-shot proposal'); }
	});
}

test('closing the transient input invalidates handed-off rights; reopening does not replay the conversation', async t => {
	const f = fixture(t), c = f.conversation;
	await c.connect(); await c.sendPrompt('Read'); const proposal = await propose(f);
	const view = new AssistantInput(c); view.dispose();
	assert.equal(c.state, 'disconnected'); assert.equal(proposal.state, 'stale');
	assert.equal(f.connections[0].signal.aborted, true);
	const reopened = new AssistantInput(c); t.after(() => reopened.dispose());
	assert.ok(c.entries.length > 0); assert.equal(f.connections.length, 1);
	await c.connect(); assert.equal(f.connections[1].commands.length, 0);
	assert.throws(() => proposal.apply(), /stale|closed/i);
});

test('workspace clear retires an active connection synchronously', async t => {
	const f = fixture(t); await f.conversation.connect(); await f.conversation.sendPrompt('Read');
	f.models.clear(); assert.equal(f.conversation.state, 'disconnected'); assert.equal(f.connections[0].signal.aborted, true);
	assert.equal(f.conversation.entries.length, 0, 'no transcript or source proposals cross workspace teardown');
});

test('workspace clear resets detached projection identity before a same-sized replacement transcript', async t => {
	const f = fixture(t), c = f.conversation;
	const input = new AssistantInput(c); t.after(() => input.dispose());
	await c.connect(); await c.sendPrompt('Old workspace '.repeat(100)); await propose(f);
	f.connections[0].emit({ type: 'turn-completed', turnId: 'old', status: 'completed' });
	const font = {}, measure = (_text: string, start: number, end: number) => end - start;
	input.transcript.update(c.entries, 40, measure, font);
	f.models.clear(); // No intervening view frame before new entries occupy the same indices.
	await c.connect(); await c.sendPrompt('New');
	f.connections[1].emit({ type: 'message', turnId: 'new', itemId: 'new', text: 'New reply' });
	f.connections[1].emit({ type: 'turn-completed', turnId: 'new', status: 'completed' });
	input.transcript.update(c.entries, 40, measure, font);
	assert.deepEqual(input.transcript.rows.map(row => row.text), ['USER', 'New', 'ASSISTANT', 'New reply', 'STATUS', 'Turn completed.']);
	assert.equal(input.selectedEntry, -1);
});

test('old stream and delayed prompt failure cannot mutate a replacement conversation', async t => {
	const f = fixture(t), c = f.conversation; await c.connect();
	let fail!: (error: Error) => void;
	f.connections[0].pending = new Promise((_resolve, reject) => { fail = reject; });
	const sent = c.sendPrompt('Old'); c.disconnect(); await c.connect(); await c.sendPrompt('Current');
	fail(new Error('old failure')); await sent;
	f.connections[0].emit({ type: 'closed', error: 'old stream' });
	assert.equal(c.state, 'running'); assert.equal(c.entries.filter(entry => entry.kind === 'user').length, 2);
	assert.ok(!c.entries.some(entry => entry.text.getText().includes('old failure')));
});

test('login cancellation suppresses a late code; old sign-out completion cannot disconnect a replacement', async t => {
	const f = fixture(t), c = f.conversation; await c.connect();
	f.connections[0].account.requiresLogin = true;
	let release!: () => void;
	f.connections[0].pending = new Promise(resolve => { release = () => resolve(undefined); });
	const login = c.startLogin(); const cancel = c.cancelLogin();
	f.connections[0].emit({ type: 'login-started', code: 'LATE' });
	assert.equal(c.loginCode, undefined); c.openLoginPage(); assert.equal(f.connections[0].openedLogin, 0);
	release(); await login; await cancel; assert.equal(c.state, 'ready');
	f.connections[0].account.connected = true;
	f.connections[0].pending = new Promise(resolve => { release = () => resolve(undefined); });
	const logout = c.signOut(); c.disconnect(); await c.connect();
	release(); await logout; assert.equal(c.state, 'ready'); assert.equal(f.connections[1].signal.aborted, false);
});

test('message items retain identity, accept Unicode deltas and use the authoritative completed text', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Hello');
	const emit = f.connections[0].emit;
	emit({ type: 'text-delta', turnId: 't', itemId: 'a', text: 'Hi 🐉' });
	const entry = c.entries[1];
	emit({ type: 'text-delta', turnId: 't', itemId: 'a', text: '\nnext' });
	emit({ type: 'message', turnId: 't', itemId: 'a', text: 'Hi 🐉\nnext' });
	assert.equal(entry.resetRevision, 0);
	emit({ type: 'message', turnId: 't', itemId: 'a', text: 'Final' });
	assert.equal(c.entries[1], entry); assert.equal(entry.text.getText(), 'Final'); assert.equal(entry.resetRevision, 1);
	emit({ type: 'text-delta', turnId: 't', itemId: 'b', text: 'Another' }); assert.equal(c.entries.length, 3);
});


test('the prompt captures source authority before asynchronous admission; a later edit is not silently included', async t => {
	const f = fixture(t); await f.conversation.connect();
	await f.conversation.sendPrompt('Use this working copy');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later\n' }]);
	f.connections[0].emit({ type: 'tool-request', requestId: 'late', name: 'studio_list_sources', arguments: {} });
	await setImmediate();
	const reply = f.connections[0].commands.at(-1)!;
	assert.ok(reply.type === 'tool-result' && !reply.success);
	assert.match(reply.text, /changed|stale/i);
});


test('account transition retires pending reviews before the new account snapshot arrives', async t => {
	const f = fixture(t), c = f.conversation; await c.connect(); await c.sendPrompt('Propose');
	const proposal = await propose(f);
	f.connections[0].emit({ type: 'turn-completed', turnId: 'turn', status: 'completed' });
	f.connections[0].emit({ type: 'account-refreshing' });
	assert.equal(proposal.state, 'stale'); assert.equal(c.canSend, false);
	f.connections[0].emit({ type: 'account-refreshing' }); // Another notification while the read is pending.
	f.connections[0].emit({ type: 'account-changed', account: { connected: false, requiresLogin: true } });
	assert.equal(c.accountRefreshing, false); assert.equal(c.canSend, false);
});
