import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService, type ResolvedTextModelSource } from '../../ide/editor/model/model_service';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import type { RuntimeResource } from '../../ide/common/resource';

function resource(contextId = 'first-source-context'): RuntimeResource {
	return { contextLabel: 'Fixture project', sourceFilePath: 'res/cue.aem.yaml', location: { kind: 'workspace' as const, path: 'res/cue.aem.yaml' }, contextId, path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem', generated: false } };
}

test('asynchronous source admission coalesces by resource, not filename or editor input', async () => {
	const models = new EditorTextModelService();
	let resolveSource!: (source: ResolvedTextModelSource) => void;
	const source = new Promise<ResolvedTextModelSource>(resolve => { resolveSource = resolve; });
	let reads = 0;
	const read = () => { reads += 1; return source; };
	const left = resource(), right = resource('second-source-context');
	const first = models.resolve(left, 'aem', read);
	const second = models.resolve(left, 'aem', read);
	const other = models.resolve(right, 'aem', read);
	assert.equal(first, second);
	assert.equal(reads, 2);
	assert.equal([...models.models].length, 0, 'no empty working copy published while source is pending');
	resolveSource({ source: 'events: {}', persistedBaseline: 'events: {}' });
	const model = await first;
	assert.equal(await second, model);
	assert.notEqual(await other, model);
	assert.equal([...models.models].length, 2);
	model.pushEditOperations([{ offset: 8, deleteLength: 2, text: '{ altered: true }' }]);
	const replacement = resource();
	assert.equal(await models.resolve(replacement, 'aem', read), model);
	assert.equal(model.resource, replacement);
	assert.equal(model.buffer.getText(), 'events: { altered: true }');
	assert.equal(reads, 2, 'a retained working copy is never reread or overwritten');
	models.clear();
});

test('failed source reads stay failures and a later explicit request can load the file', async () => {
	const models = new EditorTextModelService();
	const error = new Error('transport refused');
	let reads = 0;
	const read = () => { reads += 1; return Promise.reject(error); };
	const first = models.resolve(resource(), 'aem', read);
	const second = models.resolve(resource(), 'aem', read);
	assert.equal(reads, 1);
	await assert.rejects(first, error);
	await assert.rejects(second, error);
	assert.equal([...models.models].length, 0);
	assert.equal((await models.resolve(resource(), 'aem', async () => ({ source: 'events: {}', persistedBaseline: 'events: {}' }))).buffer.getText(), 'events: {}');
	models.clear();
});

test('workspace teardown retires a pending source generation without retiring its successor', async () => {
	const models = new EditorTextModelService();
	let finishOld!: (value: ResolvedTextModelSource) => void, finishNew!: (value: ResolvedTextModelSource) => void;
	const old = models.resolve(resource(), 'aem', () => new Promise(resolve => { finishOld = resolve; }));
	models.clear();
	const current = models.resolve(resource(), 'aem', () => new Promise(resolve => { finishNew = resolve; }));
	finishOld({ source: 'old', persistedBaseline: 'old' });
	await assert.rejects(old, /cancelled by workspace teardown/);
	assert.equal([...models.models].length, 0);
	const repeated = models.resolve(resource(), 'aem', () => { throw new Error('second read'); });
	assert.equal(repeated, current, 'old completion cannot remove the new in-flight admission');
	finishNew({ source: 'new', persistedBaseline: 'new' });
	assert.equal((await current).buffer.getText(), 'new');
	models.clear();
});

test('model removal callbacks can admit a matching successor without the departing clear consuming it', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const address = resource(), departing = models.retain(address, 'aem', 'old');
	let current: ReturnType<EditorTextModelService['retain']> | undefined;
	const removed: typeof departing[] = [];
	models.onDidRemoveModel(model => {
		removed.push(model);
		if (model === departing) current = models.retain(address, 'aem', 'new');
	});
	models.clear();
	assert.ok(current !== undefined && models.get(address) === current);
	assert.deepEqual(removed, [departing]);
	assert.equal(current.buffer.getText(), 'new');
	current.pushEditOperations([{ offset: 0, deleteLength: 3, text: 'edited' }]);
	assert.ok(current.undo() !== null);
	assert.equal(current.buffer.getText(), 'new');
});

test('a two-phase model departure publishes fresh admission before callbacks and retires only its captured models', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const address = resource(), departing = models.retain(address, 'aem', 'old');
	let disposed = 0, freshClearNotifications = 0;
	departing.onWillDispose(() => { disposed++; retirement.dispose(); });
	const removed: typeof departing[] = [];
	models.onDidRemoveModel(model => { removed.push(model); });
	let current: typeof departing | undefined;
	const removeClear = models.onWillClear(() => {
		assert.equal(models.get(address), undefined);
		assert.equal(disposed, 0);
		current = models.retain(address, 'aem', 'new');
		t.after(models.onWillClear(() => { freshClearNotifications++; }));
	});
	t.after(removeClear);
	const retirement = models.replace([]);
	assert.equal(current, undefined, 'registration alone cannot notify departing source consumers');
	assert.equal(retirement.publish(), true);
	removeClear();
	assert.ok(current !== undefined && models.get(address) === current);
	assert.equal(disposed, 0);
	assert.equal(freshClearNotifications, 0, 'an old departure cannot notify source operations admitted by its callbacks');
	retirement.dispose(); retirement.dispose();
	assert.equal(disposed, 1);
	assert.deepEqual(removed, [departing]);
	assert.ok(models.get(address) === current);
});

test('a nested departure owns its source notifications without continuing the superseded clear', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const notifications: string[] = [];
	const removeFirst = models.onWillClear(() => {
		notifications.push('first departure');
		removeFirst();
		models.clear();
	});
	const removeSecond = models.onWillClear(() => { notifications.push('latest departure'); });
	t.after(removeFirst); t.after(removeSecond);
	models.clear();
	assert.deepEqual(notifications, ['first departure', 'latest departure']);
});

test('a source reader retiring its own admission cannot replace a newer pending resolution', async t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const oldSource = Promise.withResolvers<ResolvedTextModelSource>(), currentSource = Promise.withResolvers<ResolvedTextModelSource>();
	let current: Promise<ReturnType<EditorTextModelService['retain']>> | undefined;
	const old = models.resolve(resource(), 'aem', () => {
		models.clear();
		current = models.resolve(resource(), 'aem', () => currentSource.promise);
		return oldSource.promise;
	});
	const repeated = models.resolve(resource(), 'aem', () => assert.fail('the current source read is already admitted'));
	assert.ok(repeated === current);
	oldSource.resolve({ source: 'old', persistedBaseline: 'old' });
	await assert.rejects(old, /cancelled by workspace teardown/);
	currentSource.resolve({ source: 'new', persistedBaseline: 'new' });
	const model = await current!;
	assert.ok(models.get(resource()) === model);
	assert.equal(model.buffer.getText(), 'new');
});

test('complete replacement transfers retained working copies without disposing or wiring them twice', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const retained = models.retain(resource(), 'aem', 'retained'), old = models.retain(resource('other-context'), 'aem', 'old');
	retained.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'dirty ' }]);
	const next = new EditorTextModel(old.resource, 'aem', 'new', models.history);
	let retainedDisposals = 0, contentChanges = 0;
	retained.onWillDispose(() => { retainedDisposals++; });
	const added: EditorTextModel[] = [], removed: EditorTextModel[] = [];
	t.after(models.onDidAddModel(model => { added.push(model); }));
	t.after(models.onDidRemoveModel(model => { removed.push(model); }));
	t.after(models.onDidChangeContent(model => { if (model === retained) contentChanges++; }));
	const replacement = models.replace([retained, next]);
	assert.equal(replacement.publish(), true);
	replacement.dispose();
	assert.equal(replacement.isCurrent(), true);
	assert.ok(models.get(retained.identity) === retained && models.get(next.identity) === next);
	assert.equal(retainedDisposals, 0);
	assert.equal(retained.dirty, true); assert.equal(retained.buffer.getText(), 'dirty retained');
	assert.deepEqual(added, [next]); assert.deepEqual(removed, [old]);
	assert.ok(retained.undo() !== null);
	assert.equal(retained.buffer.getText(), 'retained');
	assert.equal(contentChanges, 1);
});

test('replacement publishes complete canonical membership before its explicit one-shot added notification phase', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const old = models.retain(resource(), 'aem', 'old'), next = new EditorTextModel(old.resource, 'aem', 'new', models.history);
	let oldDisposals = 0, cleared = 0, added = 0, reentrantAdded = 0;
	let sourceAtClear: EditorTextModel | undefined, addedAtClear = -1;
	old.onWillDispose(() => { oldDisposals++; });
	t.after(models.onWillClear(() => {
		cleared++;
		sourceAtClear = models.get(next.identity); addedAtClear = added;
	}));
	t.after(models.onDidAddModel(model => { if (model === next) added++; }));
	const replacement = models.replace([next]);
	assert.ok(models.get(next.identity) === next);
	assert.equal(cleared, 0, 'canonical registration cannot invoke source-reset callbacks before routes and admission are published');
	assert.equal(added, 0, 'canonical admission does not publish new view consumers before their routes are prepared');
	assert.equal(oldDisposals, 0);
	t.after(models.onDidAddModel(model => {
		if (model !== next) return;
		reentrantAdded++;
		assert.equal(replacement.publish(), true);
	}));
	assert.equal(replacement.publish(), true);
	assert.equal(replacement.publish(), true);
	assert.equal(cleared, 1); assert.equal(added, 1); assert.equal(reentrantAdded, 1);
	assert.ok(sourceAtClear === next, 'source-reset observers consume the complete replacement membership');
	assert.equal(addedAtClear, 0, 'source caches reset before new view consumers are published');
	assert.equal(oldDisposals, 0, 'added notification and departing model disposal are separate owned phases');
	replacement.dispose();
	assert.equal(oldDisposals, 1);
});
