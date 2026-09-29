import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationObserverEvent } from '../../hosts/common/conversation_observer';
import { CodexObserver } from '../../hosts/node/codex/observer';
import { createSharedCodexFixture } from '../helpers/codex_shared_server';
import { createCodexModelFixture, CODEX_FIXTURE_DONE, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { ObservedConversation } from '../../ide/workbench/services/assistant/observed_conversation';

test('native shared conversation: paged history, live updates, no fork/config/turn writes, independent disconnect', { timeout: 60000 }, async t => {
	let observer: CodexObserver;
	t.after(async () => { await observer?.close(); });
	const model = await createCodexModelFixture(t, [
		...Array.from({ length: 23 }, (_, index) => [{ type: 'message', id: `reply-${index}`, role: 'assistant', content: [{ type: 'output_text', text: `Native answer ${index}` }] }]),
		CODEX_FIXTURE_WAIT,
	]);
	const f = await createSharedCodexFixture(t, model.url);
	const start = await f.owner.request<any>('thread/start', { cwd: f.workspace, ephemeral: false, approvalPolicy: 'never', sandbox: 'read-only' });
	const id = start.thread.id;
	await f.owner.request('thread/name/set', { threadId: id, name: 'One central conversation' });
	for (let index = 0; index < 22; index++) {
		const { turn } = await f.owner.request<any>('turn/start', { threadId: id, input: [{ type: 'text', text: `Native question ${index}`, text_elements: [] }] });
		await f.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === turn.id);
	}
	const events: ConversationObserverEvent[] = [];
	const received = new EventTarget();
	observer = await CodexObserver.open(f.home, t.signal, event => { events.push(event); received.dispatchEvent(new Event('event')); });
	const page = (await observer.command({ type: 'history' }))!;
	assert.deepEqual(page.threads.map(thread => thread.id), [id]);
	await observer.command({ type: 'open', id });
	const snapshot = events.find(event => event.type === 'snapshot')!;
	assert.equal(snapshot.type, 'snapshot');
	assert.equal(snapshot.page.thread.id, id);
	assert.equal(snapshot.page.items.length, 40);
	assert.notEqual(snapshot.page.nextCursor, null);
	assert.equal(snapshot.page.configuration.model, 'mock-model');
	await observer.command({ type: 'older' });
	const older = events.find(event => event.type === 'prepend')!;
	assert.equal(older.type, 'prepend'); assert.equal(older.items.length, 4); assert.equal(older.nextCursor, null);
	assert.equal(new Set([...snapshot.page.items, ...older.items].map(item => item.id)).size, 44);
	assert.equal(model.requests.length, 22, 'viewing history must not call inference');
	await assert.rejects(observer.command({ type: 'start', prompt: 'Do not run' } as any));
	const joined = await f.owner.request<any>('thread/resume', { threadId: id, excludeTurns: true });
	assert.equal(joined.approvalPolicy, start.approvalPolicy); assert.deepEqual(joined.sandbox, start.sandbox);
	assert.equal(joined.thread.id, id);
	await f.owner.request('thread/settings/update', { threadId: id, effort: 'high', serviceTier: 'priority' });
	await f.owner.request('thread/name/set', { threadId: id, name: 'Still one conversation' });
	const next = await f.owner.request<any>('turn/start', { threadId: id, input: [{ type: 'text', text: 'Live question', text_elements: [] }] });
	await f.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === next.turn.id);
	await new Promise<void>(resolve => {
		const done = () => { if (events.some(event => event.type === 'item' && event.item.text === 'Native answer 22')) { received.removeEventListener('event', done); resolve(); } };
		received.addEventListener('event', done); done();
	});
	assert.ok(events.some(event => event.type === 'configuration' && event.configuration.effort === 'high' && event.configuration.serviceTier === 'priority'));
	assert.ok(events.some(event => event.type === 'title' && event.title === 'Still one conversation'));
	const pending = await f.owner.request<any>('turn/start', { threadId: id, input: [{ type: 'text', text: 'Continue while Studio closes', text_elements: [] }] });
	await f.wait(message => message.method === 'turn/started' && (message.params as any).turn.id === pending.turn.id);
	await observer.close();
	const active = await f.owner.request<any>('thread/read', { threadId: id, includeTurns: false });
	assert.equal(active.thread.status.type, 'active', 'closing the viewer cannot interrupt the CLI turn');
	await f.owner.request('turn/interrupt', { threadId: id, turnId: pending.turn.id });
	await f.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === pending.turn.id);
	const threads = await f.owner.request<any>('thread/list', { modelProviders: [] });
	assert.deepEqual(threads.data.map((thread: any) => thread.id), [id], 'the observer must not create or fork a thread');
	await f.owner.request('thread/unsubscribe', { threadId: id });
	await f.wait(message => message.method === 'thread/closed' && (message.params as any).threadId === id);
	const savedEvents: ConversationObserverEvent[] = [];
	observer = await CodexObserver.open(f.home, t.signal, event => savedEvents.push(event));
	await observer.command({ type: 'open', id });
	const saved = savedEvents.find(event => event.type === 'snapshot')!;
	assert.equal(saved.type, 'snapshot'); assert.equal(saved.page.mode, 'saved');
	assert.deepEqual((await f.owner.request<any>('thread/loaded/list', {})).data, [], 'saved-history browsing cannot resume another agent runtime');
});

for (const join of ['before-message', 'mid-message']) test(`real native streaming joined ${join} preserves complete text and message identity`, { timeout: 20000 }, async t => {
	const started = Promise.withResolvers<void>(), continueStream = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
	const before = 'Text before joining. ', after = 'Text after joining.';
	const model = await createCodexModelFixture(t, [CODEX_FIXTURE_DONE, { type: 'stream', run: async (emit: (event: unknown) => void) => {
		const item = { type: 'message', id: 'streamed-reply', role: 'assistant', content: [] };
		emit({ type: 'response.output_item.added', output_index: 0, item });
		emit({ type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } });
		emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: before }); started.resolve();
		await continueStream.promise;
		emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: after });
		await finish.promise;
		emit({ type: 'response.output_item.done', output_index: 0, item: { ...item, content: [{ type: 'output_text', text: before + after }] } });
	} }]);
	const f = await createSharedCodexFixture(t, model.url);
	const { thread } = await f.owner.request<any>('thread/start', { cwd: f.workspace, ephemeral: false, approvalPolicy: 'never' });
	await f.owner.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'First reply', text_elements: [] }] });
	await f.wait(message => message.method === 'turn/completed');
	let native: CodexObserver;
	const view = new ObservedConversation(async (signal, receive) => {
		native = await CodexObserver.open(f.home, signal, receive);
		return { signal: native.signal, send: command => native.command(command), close: () => { void native.close(); } };
	});
	t.after(async () => { continueStream.resolve(); finish.resolve(); view.dispose(); await native?.closed; });
	if (join === 'before-message') await view.select(thread.id);
	await f.owner.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Stream a reply', text_elements: [] }] });
	await started.promise;
	await f.wait(message => message.method === 'item/agentMessage/delta');
	if (join === 'mid-message') await view.select(thread.id);
	const changed = (predicate: () => boolean) => new Promise<void>(resolve => {
		const update = () => { if (predicate()) { unbind(); resolve(); } };
		const unbind = view.onDidChange(update); update();
	});
	if (join === 'before-message') await changed(() => view.entries.at(-1)!.text.getText() === before);
	else assert.equal(view.entries.filter(entry => entry.kind === 'assistant').length, 1, 'native history does not include an unfinished reply prefix');
	const response = view.entries.at(-1)!, previousActivity = view.activity;
	continueStream.resolve();
	await changed(() => join === 'before-message' ? response.text.getText() === before + after : view.activity !== previousActivity);
	if (join === 'mid-message') assert.equal(view.entries.filter(entry => entry.kind === 'assistant').length, 1, 'a suffix cannot masquerade as a complete response');
	const completed = changed(() => view.workStartedAt === undefined);
	finish.resolve(); await completed;
	if (join === 'before-message') assert.equal(view.entries.at(-1), response);
	assert.equal(view.entries.at(-1)!.text.getText(), before + after);
	assert.equal(view.entries.filter(entry => entry.kind === 'assistant').length, 2);
	assert.equal(model.requests.length, 2);
});

test('native tool requests remain with the interactive owner while Studio observes', { timeout: 20000 }, async t => {
	const model = await createCodexModelFixture(t, [CODEX_FIXTURE_DONE,
		[{ type: 'function_call', call_id: 'owner-call', name: 'owner_tool', arguments: '{}' }], CODEX_FIXTURE_DONE]);
	const f = await createSharedCodexFixture(t, model.url);
	const { thread } = await f.owner.request<any>('thread/start', { cwd: f.workspace, ephemeral: false, approvalPolicy: 'never',
		dynamicTools: [{ name: 'owner_tool', description: 'Executed only by the interactive owner', inputSchema: { type: 'object', properties: {} } }] });
	await f.owner.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'First reply', text_elements: [] }] });
	await f.wait(message => message.method === 'turn/completed');
	const observer = await CodexObserver.open(f.home, t.signal, () => {});
	t.after(() => observer.close());
	await observer.command({ type: 'open', id: thread.id });
	const { turn } = await f.owner.request<any>('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Call the owner tool', text_elements: [] }] });
	const request = await f.wait(message => message.method === 'item/tool/call');
	assert.equal((request.params as any).tool, 'owner_tool');
	f.owner.send({ id: request.id, result: { success: true, contentItems: [{ type: 'inputText', text: 'Result from the interactive owner' }] } });
	await f.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === turn.id);
	assert.equal(model.requests.length, 3);
	const result = model.requests[2].input.find((item: any) => item.type === 'function_call_output');
	assert.equal(result.output, 'Result from the interactive owner');
});
