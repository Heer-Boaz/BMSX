import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';

test('runtime breakpoint state is owned by each IDE session', () => {
	const first = createRuntimeDebuggerState();
	const second = createRuntimeDebuggerState();

	first.breakpoints.set('main.lua', new Set([2]));

	assert.deepEqual(first.breakpoints.get('main.lua'), new Set([2]));
	assert.equal(second.breakpoints.size, 0);
});
