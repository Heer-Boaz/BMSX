import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCartlibCaseRom } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { valueBool, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';

test('one case ROM reports completion and restores CPU and RAM after every outcome', () => {
	const rom = createCartlibCaseRom(`
fixture_count = 42
local probe<const> = require -- literal import with trivia
	('fixture/probe')
`, {
		modules: [
			{ path: 'fixture/probe', source: 'return { value = require("fixture/value").value }' },
			{ path: 'fixture/value', source: 'return { value = 17 }' },
		],
	});
	const clean = rom.add('assert(fixture_count == 42 and probe.value == 17); fixture_count = 3');
	const fault = rom.add('fixture_count = 11; assert(false, "fixture failure")');
	const stopped = rom.add('fixture_count = 7; halt_until_irq');
	const values = rom.add('return false, nil, probe.value');
	rom.run(clean);
	assert.throws(() => rom.run(fault), /without a Lua fault/);
	rom.run(clean);
	assert.throws(() => rom.run(stopped), /guest case returned to its runner/);
	assert.deepEqual(materializeCpuCompletionValues(rom.run(values)), [valueBool(false), valueNil(), valueInteger(17)]);
	rom.run(clean);
});
