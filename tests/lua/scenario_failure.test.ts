import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { scenarioFailureFromError } from '../../ide/testing/scenario/failure';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const path = 'tests/carts/example/navigation_assert.lua';
const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(path, 1)]);

test('scenario diagnostics preserve the original host stack without assigning a Lua fault site', () => {
	const error = new TypeError('protocol registration failed');
	const originalStack = error.stack;
	const failure = scenarioFailureFromError(sources, 0, 'install', error);
	assert.equal(failure.message, error.message);
	assert.equal(failure.stackTrace, originalStack);
	assert.match(failure.stackTrace!, /scenario_failure.test.ts/);
	assert.equal(failure.phase, 'install');
	assert.equal(failure.location, undefined);
	assert.equal(error.stack, originalStack);
	assert.equal(scenarioFailureFromError(sources, 0, 'prepare', 'rejected').stackTrace, undefined);
});

test('scenario compilation diagnostics preserve the real authored source position', () => {
	const error = new LuaSyntaxError('unexpected end', path, 19, 4);
	const failure = scenarioFailureFromError(sources, 0, 'prepare', error);
	assert.deepEqual(failure.location, { resource: { domain: 0, path }, line: 19, column: 4 });
	assert.equal(failure.stackTrace, error.stack);
});
