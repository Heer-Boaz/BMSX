import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { AssistantAccount, AssistantCommand, AssistantConnection, AssistantEvent } from '../../hosts/common/assistant_protocol';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { AssistantConversation } from '../../ide/workbench/services/assistant/conversation';
import { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

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
	const conversation = new AssistantConversation(models, sources, storage, async (_signal, emit) => {
		const connection = new Connection(emit); connections.push(connection); return connection;
	});
	t.after(() => { conversation.dispose(); models.clear(); });
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
	return f.conversation.entries.find(entry => entry.kind === 'proposal')!.proposal!;
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
