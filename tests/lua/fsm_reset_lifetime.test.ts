import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { runCompletionClosure } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) test(`FSM reset releases every previous data field and restores declared defaults (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local fsm<const> = require('cartlib/fsm/fsm')
local default_object<const> = { retained = true }
local definition<const> = fsm.state_definition.new('reset_lifetime', {
 data = { count = 7, enabled = false, object = default_object },
 initial = 'idle',
 states = { idle = { data = { status = 'idle' } } },
})
local machine<const> = fsm.state.new(definition, { id = 'reset_target' }, nil, nil, nil)
local child<const> = machine.states.idle
local weak<const> = setmetatable({}, { __mode = 'v' })
probe = { weak = weak, data = machine.data, child_data = child.data, default_object = default_object }
function probe.seed()
 machine.data.count = 99
 machine.data.enabled = true
 machine.data.object = nil
 child.data.status = 'changed'
 local next_ref = 1
 for index = 1, 16 do
  local key<const> = {}
  local value<const> = { buffer = { index, index + 1 } }
  weak[next_ref] = key
  weak[next_ref + 1] = value
  next_ref = next_ref + 2
  machine.data[key] = value
  machine.data['transient_' .. index] = value
  child.data['transient_' .. index] = value
 end
 weak[next_ref] = default_object
end
function probe.reset_local()
 machine:reset(false)
end
function probe.reset_tree()
 machine:reset()
end
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const seed = probe.getStringKey(cpu.stringPool.find('seed')!) as Closure;
	const resetLocal = probe.getStringKey(cpu.stringPool.find('reset_local')!) as Closure;
	const resetTree = probe.getStringKey(cpu.stringPool.find('reset_tree')!) as Closure;
	const weak = probe.getStringKey(cpu.stringPool.find('weak')!) as Table;
	const data = probe.getStringKey(cpu.stringPool.find('data')!) as Table;
	const childData = probe.getStringKey(cpu.stringPool.find('child_data')!) as Table;
	const defaultObject = probe.getStringKey(cpu.stringPool.find('default_object')!);
	for (let cycle = 0; cycle < 3; cycle++) {
		runCompletionClosure(cpu, seed, []);
		runCompletionClosure(cpu, resetLocal, []);
		let rootFields = 0;
		data.forEachStoredEntry(() => rootFields++);
		assert.equal(rootFields, 3, 'local reset must remove every undeclared field, including object keys');
		assert.equal(data.getStringKey(cpu.stringPool.find('count')!), 7);
		assert.equal(data.getStringKey(cpu.stringPool.find('enabled')!), false);
		assert.equal(data.getStringKey(cpu.stringPool.find('object')!), defaultObject);
		assert.notEqual(childData.getStringKey(cpu.stringPool.find('transient_16')!), null, 'local reset must preserve child data');
		runCompletionClosure(cpu, resetTree, []);
		let childFields = 0;
		childData.forEachStoredEntry(() => childFields++);
		assert.equal(childFields, 1, 'tree reset must remove every undeclared child field');
		assert.equal(cpu.stringPool.toString((childData.getStringKey(cpu.stringPool.find('status')!) as StringValue).id), 'idle');
		cpu.collectTrackedHeapBytes();
		for (let index = 1; index <= 32; index++) assert.equal(weak.getInteger(index), null, `stale data reference ${index} survived reset`);
		assert.notEqual(weak.getInteger(33), null, 'declared object defaults must retain their identity');
	}
});
