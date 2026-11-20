import assert from 'node:assert/strict';
import test from 'node:test';
import { DisposableStore } from '../../ide/common/lifecycle';

test('resource retirement removes ownership before a disposer reenters the store', () => {
	const owner = new DisposableStore(), retired: number[] = [];
	owner.add({ dispose() { retired.push(1); owner.dispose(); } });
	owner.add({ dispose() { retired.push(2); } });
	owner.dispose();
	assert.deepEqual(retired, [1, 2]);
	assert.equal(owner.isDisposed, true);
	owner.dispose();
	assert.deepEqual(retired, [1, 2], 'reentrant and repeated retirement dispose each resource once');
});
