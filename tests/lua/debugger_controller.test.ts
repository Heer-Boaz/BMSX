import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LuaDebuggerController } from '../../src/bmsx/lua/debugger';
import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/value';

function pauseSignal(reason: LuaDebuggerPauseSignal['reason'], line = 1, depth = 1): LuaDebuggerPauseSignal {
	return {
		kind: 'pause',
		reason,
		location: { path: 'main.lua', line, column: 1 },
		callStack: new Array(depth).fill(null).map((_, index) => ({
			functionName: `frame${index}`,
			source: 'main.lua',
			line,
			column: 1,
		})),
		resume: () => ({ kind: 'normal' }),
	};
}

test('LuaDebuggerController resolves breakpoints at statement boundaries', () => {
	const controller = new LuaDebuggerController();
	controller.setBreakpoints(new Map([['main.lua', new Set([2])]]));

	assert.equal(controller.shouldPause('main.lua', 1, 0), null);
	assert.equal(controller.shouldPause('main.lua', 2, 0), 'breakpoint');
	assert.equal(controller.shouldPause('other.lua', 2, 0), null);
});

test('LuaDebuggerController step requests consume their origin before pausing', () => {
	const controller = new LuaDebuggerController();
	controller.requestStepInto({ path: 'main.lua', line: 4, depth: 2 });

	assert.equal(controller.shouldPause('main.lua', 4, 2), null);
	assert.equal(controller.shouldPause('main.lua', 5, 2), 'step');

	controller.handlePause(pauseSignal('step', 5, 2));
	assert.equal(controller.shouldPause('main.lua', 6, 2), null);
});

test('LuaDebuggerController step-over uses the supported step-into boundary model', () => {
	const controller = new LuaDebuggerController();
	controller.handlePause(pauseSignal('breakpoint', 3, 2));
	controller.requestStepOver(2);

	assert.equal(controller.shouldPause('main.lua', 3, 2), null);
	assert.equal(controller.shouldPause('main.lua', 4, 3), 'step');
});

test('LuaDebuggerController step-out waits until call depth returns to the target', () => {
	const controller = new LuaDebuggerController();
	controller.requestStepOut(3, { path: 'main.lua', line: 6, depth: 3 });

	assert.equal(controller.shouldPause('main.lua', 6, 3), null);
	assert.equal(controller.shouldPause('main.lua', 7, 3), null);
	assert.equal(controller.shouldPause('main.lua', 8, 2), 'step');
});

test('LuaDebuggerController metrics record pauses and skipped exceptions', () => {
	const controller = new LuaDebuggerController();
	controller.handlePause(pauseSignal('breakpoint', 2));
	controller.handlePause(pauseSignal('exception', 3));
	controller.markSkippedException();

	const metrics = controller.getSessionMetrics();
	assert.equal(metrics.pauseCount, 2);
	assert.equal(metrics.breakpointCount, 1);
	assert.equal(metrics.exceptionCount, 1);
	assert.equal(metrics.skippedExceptionCount, 1);
	assert.deepEqual(metrics.lastExceptionLocation, { path: 'main.lua', line: 3, column: 1 });
});
