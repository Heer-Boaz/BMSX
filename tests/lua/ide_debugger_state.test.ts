import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeSourceState } from '../../ide/runtime/sources';

test('runtime breakpoint state is owned by each IDE session', () => {
	const runtime = {} as Runtime;
	const sources = {} as RuntimeSourceState;
	const first = createRuntimeDebuggerState(runtime, sources);
	const second = createRuntimeDebuggerState(runtime, sources);

	first.breakpoints[1].set('main.lua', new Set([2]));

	assert.deepEqual(first.breakpoints[1].get('main.lua'), new Set([2]));
	assert.deepEqual(second.breakpoints.map(breakpoints => breakpoints.size), [0, 0, 0]);
});
