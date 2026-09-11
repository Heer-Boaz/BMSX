import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { ResourceDomain, RuntimeResource } from '../../ide/common/resource';

function resource(domain: ResourceDomain = 0): RuntimeResource {
	return { domain, path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem', generated: false } };
}

test('asynchronous source admission coalesces by resource, not filename or editor input', async () => {
	const models = new EditorTextModelService();
	let resolveSource!: (source: string) => void;
	const source = new Promise<string>(resolve => { resolveSource = resolve; });
	let reads = 0;
	const read = () => { reads += 1; return source; };
	const left = resource(), right = resource(1);
	const first = models.resolve(left, 'aem', read);
	const second = models.resolve(left, 'aem', read);
	const other = models.resolve(right, 'aem', read);
	assert.equal(first, second);
	assert.equal(reads, 2);
	assert.equal([...models.models].length, 0, 'no empty working copy published while source is pending');
	resolveSource('events: {}');
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
	assert.equal((await models.resolve(resource(), 'aem', async () => 'events: {}')).buffer.getText(), 'events: {}');
	models.clear();
});

test('workspace teardown retires a pending source generation without retiring its successor', async () => {
	const models = new EditorTextModelService();
	let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
	const old = models.resolve(resource(), 'aem', () => new Promise(resolve => { finishOld = resolve; }));
	models.clear();
	const current = models.resolve(resource(), 'aem', () => new Promise(resolve => { finishNew = resolve; }));
	finishOld('old');
	await assert.rejects(old, /cancelled by workspace teardown/);
	assert.equal([...models.models].length, 0);
	const repeated = models.resolve(resource(), 'aem', () => { throw new Error('second read'); });
	assert.equal(repeated, current, 'old completion cannot remove the new in-flight admission');
	finishNew('new');
	assert.equal((await current).buffer.getText(), 'new');
	models.clear();
});
