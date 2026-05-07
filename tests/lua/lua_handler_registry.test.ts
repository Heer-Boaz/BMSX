import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LuaFunctionRedirectCache } from '../../src/bmsx/machine/firmware/handler_registry';
import type { LuaFunctionValue, LuaValue } from '../../src/bmsx/lua/value';

function handler(name: string, value: LuaValue): LuaFunctionValue {
	return {
		name,
		call: () => [value],
	};
}

test('LuaFunctionRedirectCache preserves redirect identity while rebinding current function', () => {
	const cache = new LuaFunctionRedirectCache();
	const first = handler('first', 1);
	const redirect = cache.getOrCreate('main', ['handlers', 'tick'], first);
	assert.deepEqual(redirect.call([]), [1]);

	const second = handler('second', 2);
	const rebound = cache.getOrCreate('main', ['handlers', 'tick'], second);
	assert.equal(rebound, redirect);
	assert.deepEqual(redirect.call([]), [2]);
});

test('LuaFunctionRedirectCache keys redirects by module and handler path', () => {
	const cache = new LuaFunctionRedirectCache();
	const left = cache.getOrCreate('main', ['handlers', 'tick'], handler('left', 'left'));
	const right = cache.getOrCreate('main', ['handlers', 'draw'], handler('right', 'right'));
	const otherModule = cache.getOrCreate('other', ['handlers', 'tick'], handler('other', 'other'));

	assert.notEqual(left, right);
	assert.notEqual(left, otherModule);
	assert.deepEqual(left.call([]), ['left']);
	assert.deepEqual(right.call([]), ['right']);
	assert.deepEqual(otherModule.call([]), ['other']);
});

test('LuaFunctionRedirectCache clear drops redirect ownership', () => {
	const cache = new LuaFunctionRedirectCache();
	const before = cache.getOrCreate('main', ['handlers', 'tick'], handler('before', 1));
	cache.clear();
	const after = cache.getOrCreate('main', ['handlers', 'tick'], handler('after', 2));

	assert.notEqual(after, before);
	assert.deepEqual(before.call([]), [1]);
	assert.deepEqual(after.call([]), [2]);
});
