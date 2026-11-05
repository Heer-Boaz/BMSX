import assert from 'node:assert/strict';
import test from 'node:test';
import { queryObjects } from 'node:v8';
import { afterTest } from '../helpers/test_cleanup';

test('completed test hooks release synchronous and asynchronous fixture captures', async t => {
	class Resource { disposed = false; }
	const baseline = queryObjects(Resource);
	let disposed = 0;
	for (const asynchronous of [false, true]) {
		await t.test(asynchronous ? 'asynchronous disposal' : 'synchronous disposal', child => {
			const resource = new Resource();
			const dispose = () => { resource.disposed = true; disposed++; };
			afterTest(child, asynchronous ? async () => { await Promise.resolve(); dispose(); } : dispose);
		});
		assert.equal(queryObjects(Resource), baseline, 'reporting retains the hook, not the disposed fixture');
	}
	assert.equal(disposed, 2);
});
