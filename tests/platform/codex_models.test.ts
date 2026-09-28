import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexModels } from '../../hosts/node/codex/models';
import type { Json } from '../../hosts/node/codex/protocol';

const nativeModel = { model: 'catalog-model', displayName: 'Catalog Model', description: 'From the native catalog', hidden: false, isDefault: true,
	supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'high', description: 'More reasoning' }],
	defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Increased usage' }] };

test('unset native configuration resolves catalog defaults without inventing historical or custom-provider settings', async () => {
	let calls = 0;
	const catalog = new CodexModels({ async request<T>(): Promise<T> {
		calls++;
		return { data: [nativeModel, { ...nativeModel, model: 'other', isDefault: false, defaultReasoningEffort: 'high' }], nextCursor: null } as T;
	} });
	await catalog.list();
	const unset = { agent: 'Codex', model: null, effort: null, provider: 'openai', serviceTier: null };
	assert.deepEqual(catalog.resolve(unset, true), { ...unset, model: nativeModel.model, effort: nativeModel.defaultReasoningEffort });
	assert.equal(catalog.resolve(unset), unset, 'missing historical metadata is not the current catalog default');
	assert.equal(catalog.resolve({ ...unset, model: 'other' }).effort, 'high');
	const explicit = { ...unset, model: 'other', effort: 'medium' };
	assert.equal(catalog.resolve(explicit), explicit, 'an explicit effort is not overwritten by the default');
	const custom = { ...unset, model: 'custom-provider-model' };
	assert.equal(catalog.resolve(custom), custom, 'an unlisted provider model does not borrow another model’s effort');
	assert.equal(calls, 1, 'projection uses the same retained catalog as the pickers');
});

test('model catalog projects all native pages once, retaining supported effort and tier data', async () => {
	const calls: Json[] = [];
	const catalog = new CodexModels({ async request<T>(method: string, params: Json): Promise<T> {
		assert.equal(method, 'model/list'); calls.push(params);
		return (calls.length === 1 ? { data: [nativeModel], nextCursor: 'page-two' }
			: { data: [{ ...nativeModel, model: 'hidden', hidden: true }, { ...nativeModel, model: 'other' }], nextCursor: null }) as T;
	} });
	const read = catalog.list(); assert.equal(catalog.list(), read);
	const { models } = await read;
	assert.deepEqual(models.map(model => model.id), ['catalog-model', 'other']);
	assert.deepEqual(models[0].efforts, [{ id: 'medium', description: 'Balanced' }, { id: 'high', description: 'More reasoning' }]);
	assert.equal(models[0].serviceTiers, nativeModel.serviceTiers);
	await catalog.admit({ model: models[0].id, effort: 'high', serviceTier: 'priority' });
	assert.deepEqual(calls, [{ cursor: null, limit: 100, includeHidden: false }, { cursor: 'page-two', limit: 100, includeHidden: false }]);
});

test('an account change retires the cached catalog even when the previous read is still pending', async () => {
	const readers: ((value: unknown) => void)[] = [];
	const catalog = new CodexModels({ request: <T>() => new Promise<T>(resolve => readers.push(value => resolve(value as T))) });
	const old = catalog.list(); catalog.clear(); const current = catalog.list();
	readers[1]({ data: [{ ...nativeModel, model: 'current' }], nextCursor: null });
	assert.equal((await current).models[0].id, 'current');
	readers[0]({ data: [nativeModel], nextCursor: null }); await old;
	assert.equal(catalog.list(), current); assert.equal(readers.length, 2);
	assert.equal(catalog.resolve({ agent: 'Codex', model: null, provider: 'openai', effort: null, serviceTier: null }, true).model, 'current');
});

test('a failed catalog read does not poll or retry itself; the next explicit request may retry', async () => {
	let calls = 0;
	const catalog = new CodexModels({ async request<T>(): Promise<T> {
		if (++calls === 1) throw new Error('Catalog unavailable');
		return { data: [nativeModel], nextCursor: null } as T;
	} });
	await assert.rejects(catalog.list(), /Catalog unavailable/); assert.equal(calls, 1);
	assert.equal((await catalog.list()).models.length, 1); assert.equal(calls, 2);
});
